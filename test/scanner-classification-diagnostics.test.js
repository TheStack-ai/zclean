'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree } = require('../src/process-tree');
const { scan } = require('../src/scanner');
const { classifyRuntimeCandidate } = require('../src/runtime-classifier');

// Helper: build a tree from process list and monkey-patch ProcessTree.build
function withMockedTree(procs, fn, diagnostics = {}) {
  const original = ProcessTree.build;
  ProcessTree.build = () => {
    const tree = new ProcessTree(
      procs.map((p) => ({
        pid: p.pid,
        ppid: p.ppid,
        cmd: p.cmd || '',
        mem: p.mem || 0,
        age: p.age || 0,
        startTime: p.startTime || null,
      }))
    );
    tree.warnings = diagnostics.warnings || [];
    tree.errors = diagnostics.errors || [];
    return tree;
  };
  try {
    return fn();
  } finally {
    ProcessTree.build = original;
  }
}

const baseConfig = {
  whitelist: [],
  maxAge: '24h',
  memoryThreshold: '500MB',
  maxKillBatch: 20,
  customAiDirs: [],
  customPatterns: [],
};

describe('scan()', () => {
  it('claude --print orphan → detected as claude-subagent', () => {
    const procs = [
      { pid: 3000, ppid: 1, cmd: 'claude --print "do something"', age: 60000, mem: 2048 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'claude-subagent');
    assert.equal(result[0].classification, 'suspected');
    assert.equal(result[0].cleanupEligible, false);
    assert.ok(result[0].blockedReasons.includes('age-grace-not-met'));
  });

  it('returns empty array when no zombies found', () => {
    const procs = [
      { pid: 50, ppid: 1, cmd: 'bash' },
      { pid: 100, ppid: 50, cmd: 'vim file.txt', age: 1000, mem: 512 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 0);
  });

  it('sessionPid limits results to processes with proven session ancestry', () => {
    const procs = [
      { pid: 500, ppid: 50, cmd: 'claude' },
      { pid: 501, ppid: 500, cmd: 'bash' },
      { pid: 3001, ppid: 501, cmd: 'claude --print "session child"', age: 60000, mem: 2048 },
      { pid: 3002, ppid: 1, cmd: 'claude --print "unrelated orphan"', age: 60000, mem: 2048 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig, { sessionPid: 500 }));
    assert.equal(result.length, 0);
    assert.equal(result.session.pid, 500);
    assert.equal(result.session.matched, 0);
    assert.equal(result.session.excluded, 1);
    assert.equal(result.session.unattributed, 1);
    assert.ok(result.warnings.some((warning) => warning.code === 'session-attribution-gap'));
  });

  it('uses stronger provider and age gates for generic and custom runtimes', () => {
    const startTime = '2024-01-01T00:00:00.000Z';
    const genericEarly = classifyRuntimeCandidate({
      pattern: 'tsx',
      command: 'tsx .claude/tools/server.ts',
      orphan: true,
      orphanReason: 'parent-gone',
      age: 23 * 60 * 60 * 1000,
      startTime,
    });
    const genericReady = classifyRuntimeCandidate({
      pattern: 'tsx',
      command: 'tsx .claude/tools/server.ts',
      orphan: true,
      orphanReason: 'parent-gone',
      age: 25 * 60 * 60 * 1000,
      startTime,
    });
    const customUnattributed = classifyRuntimeCandidate({
      pattern: 'custom:my-agent-worker',
      command: 'node my-agent-worker.js',
      orphan: true,
      orphanReason: 'parent-gone',
      age: 25 * 60 * 60 * 1000,
      startTime,
    });

    assert.equal(genericEarly.cleanupEligible, false);
    assert.ok(genericEarly.blockedReasons.includes('age-grace-not-met'));
    assert.equal(genericReady.provider, 'claude');
    assert.equal(genericReady.classification, 'confirmed-stale');
    assert.equal(genericReady.cleanupEligible, true);
    assert.equal(customUnattributed.classification, 'unattributed');
    assert.equal(customUnattributed.cleanupEligible, false);
  });

  it('does not treat a custom directory fragment as provider evidence', () => {
    const result = classifyRuntimeCandidate({
      pattern: 'tsx',
      command: 'tsx /home/user/main/server.ts',
      customAiDirs: ['ain'],
      orphan: true,
      orphanReason: 'parent-gone',
      age: 48 * 60 * 60 * 1000,
      startTime: '2026-07-14T00:00:00.000Z',
    });

    assert.equal(result.provider, 'unknown');
    assert.equal(result.classification, 'unattributed');
    assert.equal(result.cleanupEligible, false);
    assert.ok(result.blockedReasons.includes('provider-pattern-not-strong'));
  });

  it('propagates process enumeration failures as scan diagnostics', () => {
    const errors = [
      {
        code: 'process-enumeration-failed',
        platform: 'win32',
        providers: ['cim', 'wmic'],
        message: 'Unable to enumerate processes',
      },
    ];
    const result = withMockedTree([], () => scan(baseConfig), { errors });
    assert.equal(result.length, 0);
    assert.equal(result.enumerationFailed, true);
    assert.deepEqual(result.errors, errors);
  });
});

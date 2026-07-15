'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree } = require('../src/process-tree');
const { scan } = require('../src/scanner');

function withMockedTree(procs, fn, diagnostics = {}) {
  const tree = new ProcessTree(procs.map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    cmd: p.cmd || '',
    mem: p.mem || 0,
    age: p.age || 0,
    startTime: p.startTime || null,
  })));
  tree.warnings = diagnostics.warnings || [];
  tree.errors = diagnostics.errors || [];
  return fn(tree);
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
  it('detects an orphan that matches a configured custom literal', () => {
    const procs = [
      { pid: 2150, ppid: 1, cmd: 'node my-agent-worker.js', age: 25 * 60 * 60 * 1000, mem: 1024 },
    ];
    const result = withMockedTree(procs, (tree) => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }, { tree }));

    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'custom:my-agent-worker');
    assert.match(result[0].reason, /orphan/);
    assert.match(result[0].reason, /age-exceeded/);
    assert.equal(result[0].provider, 'custom');
    assert.equal(result[0].classification, 'unattributed');
    assert.equal(result[0].cleanupEligible, false);
    assert.ok(result[0].blockedReasons.includes('provider-pattern-not-strong'));
  });

  it('waits for maxAge before flagging a custom orphan', () => {
    const procs = [
      { pid: 2149, ppid: 1, cmd: 'node my-agent-worker.js', age: 60000, mem: 1024 },
    ];
    const result = withMockedTree(procs, (tree) => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }, { tree }));

    assert.equal(result.length, 0);
  });

  it('fails closed to the default age gate when maxAge is invalid or zero', () => {
    const procs = [
      { pid: 2148, ppid: 1, cmd: 'node my-agent-worker.js', age: 1, mem: 1024 },
    ];

    for (const maxAge of ['invalid', '0h']) {
      const result = withMockedTree(procs, (tree) => scan({
        ...baseConfig,
        maxAge,
        customPatterns: ['my-agent-worker'],
      }, { tree }));
      assert.equal(result.length, 0, `maxAge=${maxAge}`);
    }
  });

  it('protects a non-orphan process that matches a configured custom literal', () => {
    const procs = [
      { pid: 50, ppid: 1, cmd: 'bash' },
      { pid: 2151, ppid: 50, cmd: 'node my-agent-worker.js', age: 60000, mem: 1024 },
    ];
    const result = withMockedTree(procs, (tree) => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }, { tree }));

    assert.equal(result.length, 0);
  });

  it('keeps session descendants protected unless a custom match is orphaned', () => {
    const procs = [
      { pid: 500, ppid: 50, cmd: 'claude' },
      { pid: 2152, ppid: 500, cmd: 'node my-agent-worker.js', age: 60000, mem: 1024 },
    ];
    const result = withMockedTree(procs, (tree) => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }, { sessionPid: 500, tree }));

    assert.equal(result.length, 0);
  });

  it('uses config maxAge for AI-path age-gated patterns', () => {
    const procs = [
      { pid: 2200, ppid: 1, cmd: 'tsx .claude/tools/server.ts', age: 2 * 60 * 60 * 1000, mem: 1024 },
    ];
    const result = withMockedTree(
      procs,
      (tree) => scan({ ...baseConfig, maxAge: '1h' }, { tree })
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'tsx');
    assert.match(result[0].reason, /age-exceeded/);
  });

  it('uses config memoryThreshold for AI-path memory-gated patterns', () => {
    const procs = [
      {
        pid: 2300,
        ppid: 1,
        cmd: 'node /tmp/.claude/mcp/server/index.js',
        age: 10 * 60 * 1000,
        mem: 2 * 1024 * 1024,
      },
    ];
    const result = withMockedTree(
      procs,
      (tree) => scan({ ...baseConfig, memoryThreshold: '1MB' }, { tree })
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'node-ai-path');
    assert.match(result[0].reason, /memory-exceeded/);
  });

});

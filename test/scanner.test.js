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
  it('uses ProcessTree.build() for process data', () => {
    let buildCalled = false;
    const original = ProcessTree.build;
    ProcessTree.build = () => {
      buildCalled = true;
      return new ProcessTree([]);
    };
    try {
      scan(baseConfig);
      assert.ok(buildCalled, 'scan must call ProcessTree.build()');
    } finally {
      ProcessTree.build = original;
    }
  });

  it('detects orphaned MCP server', () => {
    const procs = [
      {
        pid: 1000,
        ppid: 1,
        cmd: 'node /path/to/mcp-server/index.js',
        age: 7200000,
        mem: 1024,
        startTime: '2024-01-01T00:00:00.000Z',
      },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'mcp-server');
    assert.ok(result[0].reason.includes('orphan'));
    assert.equal(result[0].provider, 'mcp');
    assert.equal(result[0].classification, 'confirmed-stale');
    assert.deepEqual(result[0].confidence, { score: 100, level: 'high' });
    assert.ok(result[0].evidence.includes('start-time:verified'));
    assert.equal(result[0].cleanupEligible, true);
    assert.deepEqual(result[0].blockedReasons, []);
  });

  it('skips non-orphan process for orphanOnly pattern', () => {
    const procs = [
      { pid: 50, ppid: 1, cmd: 'bash' },
      { pid: 1000, ppid: 50, cmd: 'node /path/to/mcp-server/index.js', age: 7200000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 0);
  });

  it('orphan + tmux: skips tmux check for orphan (PPID=1)', () => {
    // Orphan process should NOT be protected by tmux ancestor
    // because orphans are already detached from any tmux session
    const procs = [
      { pid: 10, ppid: 1, cmd: 'tmux' },
      // This process has PPID=1 (orphaned), so tmux check is irrelevant
      { pid: 1000, ppid: 1, cmd: 'node mcp-server/run.js', age: 7200000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    // Should still be detected as zombie (orphan overrides tmux protection)
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 1000);
  });

  it('non-orphan under tmux is protected', () => {
    const procs = [
      { pid: 10, ppid: 1, cmd: '/usr/bin/tmux' },
      { pid: 20, ppid: 10, cmd: 'bash' },
      { pid: 1000, ppid: 20, cmd: 'node mcp-server/run.js', age: 7200000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 0);
  });

  it('aiPathRequired: tsx without AI dir path → not flagged', () => {
    const procs = [
      { pid: 2000, ppid: 1, cmd: 'tsx watch src/index.ts', age: 100000000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 0);
  });

  it('aiPathRequired: tsx with .claude/ path → flagged', () => {
    const procs = [
      { pid: 2000, ppid: 1, cmd: 'tsx .claude/tools/server.ts', age: 100000000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'tsx');
  });

  it('honors customAiDirs from config', () => {
    const procs = [
      { pid: 2100, ppid: 1, cmd: 'tsx .myagent/tools/server.ts', age: 100000000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan({ ...baseConfig, customAiDirs: ['.myagent'] }));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'tsx');
  });

  it('detects an orphan that matches a configured custom literal', () => {
    const procs = [
      { pid: 2150, ppid: 1, cmd: 'node my-agent-worker.js', age: 25 * 60 * 60 * 1000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }));

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
    const result = withMockedTree(procs, () => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }));

    assert.equal(result.length, 0);
  });

  it('fails closed to the default age gate when maxAge is invalid or zero', () => {
    const procs = [
      { pid: 2148, ppid: 1, cmd: 'node my-agent-worker.js', age: 1, mem: 1024 },
    ];

    for (const maxAge of ['invalid', '0h']) {
      const result = withMockedTree(procs, () => scan({
        ...baseConfig,
        maxAge,
        customPatterns: ['my-agent-worker'],
      }));
      assert.equal(result.length, 0, `maxAge=${maxAge}`);
    }
  });

  it('protects a non-orphan process that matches a configured custom literal', () => {
    const procs = [
      { pid: 50, ppid: 1, cmd: 'bash' },
      { pid: 2151, ppid: 50, cmd: 'node my-agent-worker.js', age: 60000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }));

    assert.equal(result.length, 0);
  });

  it('keeps session descendants protected unless a custom match is orphaned', () => {
    const procs = [
      { pid: 500, ppid: 50, cmd: 'claude' },
      { pid: 2152, ppid: 500, cmd: 'node my-agent-worker.js', age: 60000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan({
      ...baseConfig,
      customPatterns: ['my-agent-worker'],
    }, { sessionPid: 500 }));

    assert.equal(result.length, 0);
  });

  it('uses config maxAge for AI-path age-gated patterns', () => {
    const procs = [
      { pid: 2200, ppid: 1, cmd: 'tsx .claude/tools/server.ts', age: 2 * 60 * 60 * 1000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan({ ...baseConfig, maxAge: '1h' }));
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
    const result = withMockedTree(procs, () => scan({ ...baseConfig, memoryThreshold: '1MB' }));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'node-ai-path');
    assert.match(result[0].reason, /memory-exceeded/);
  });

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

  it('sessionPid never turns a live session descendant into a candidate', () => {
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

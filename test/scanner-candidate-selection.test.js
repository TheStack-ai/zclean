'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree } = require('../src/process-tree');
const { scan } = require('../src/scanner');

function withMockedTree(procs, fn, diagnostics = {}) {
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
  it('surfaces diagnostics from an injected process snapshot', () => {
    const error = { code: 'process-enumeration-failed', message: 'provider failed' };
    const result = withMockedTree([], (tree) => scan(baseConfig, { tree }), { errors: [error] });

    assert.deepEqual(result.errors, [error]);
    assert.equal(result.enumerationFailed, true);
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
    const result = withMockedTree(procs, (tree) => scan(baseConfig, { tree }));
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
    const result = withMockedTree(procs, (tree) => scan(baseConfig, { tree }));
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
    const result = withMockedTree(procs, (tree) => scan(baseConfig, { tree }));
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
    const result = withMockedTree(procs, (tree) => scan(baseConfig, { tree }));
    assert.equal(result.length, 0);
  });

  it('aiPathRequired: tsx without AI dir path → not flagged', () => {
    const procs = [
      { pid: 2000, ppid: 1, cmd: 'tsx watch src/index.ts', age: 100000000, mem: 1024 },
    ];
    const result = withMockedTree(procs, (tree) => scan(baseConfig, { tree }));
    assert.equal(result.length, 0);
  });

  it('aiPathRequired: tsx with .claude/ path → flagged', () => {
    const procs = [
      { pid: 2000, ppid: 1, cmd: 'tsx .claude/tools/server.ts', age: 100000000, mem: 1024 },
    ];
    const result = withMockedTree(procs, (tree) => scan(baseConfig, { tree }));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'tsx');
  });

  it('honors customAiDirs from config', () => {
    const procs = [
      { pid: 2100, ppid: 1, cmd: 'tsx .myagent/tools/server.ts', age: 100000000, mem: 1024 },
    ];
    const result = withMockedTree(
      procs,
      (tree) => scan({ ...baseConfig, customAiDirs: ['.myagent'] }, { tree })
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'tsx');
  });

});

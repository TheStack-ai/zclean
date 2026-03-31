'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree } = require('../src/process-tree');
const { scan } = require('../src/scanner');

// Helper: build a tree from process list and monkey-patch ProcessTree.build
function withMockedTree(procs, fn) {
  const original = ProcessTree.build;
  ProcessTree.build = () =>
    new ProcessTree(
      procs.map((p) => ({
        pid: p.pid,
        ppid: p.ppid,
        cmd: p.cmd || '',
        mem: p.mem || 0,
        age: p.age || 0,
        startTime: p.startTime || null,
      }))
    );
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
      { pid: 1000, ppid: 1, cmd: 'node /path/to/mcp-server/index.js', age: 7200000, mem: 1024 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'mcp-server');
    assert.ok(result[0].reason.includes('orphan'));
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

  it('claude --print orphan → detected as claude-subagent', () => {
    const procs = [
      { pid: 3000, ppid: 1, cmd: 'claude --print "do something"', age: 60000, mem: 2048 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'claude-subagent');
  });

  it('returns empty array when no zombies found', () => {
    const procs = [
      { pid: 50, ppid: 1, cmd: 'bash' },
      { pid: 100, ppid: 50, cmd: 'vim file.txt', age: 1000, mem: 512 },
    ];
    const result = withMockedTree(procs, () => scan(baseConfig));
    assert.equal(result.length, 0);
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree } = require('../src/process-tree');

// Helper: build a tree from an array of {pid, ppid, cmd} objects
function makeTree(procs) {
  return new ProcessTree(
    procs.map((p) => ({
      pid: p.pid,
      ppid: p.ppid,
      cmd: p.cmd || '',
      mem: p.mem || 0,
      age: p.age || 0,
      startTime: p.startTime || null,
    }))
  );
}

describe('ProcessTree', () => {
  // ── get(pid) ────────────────────────────────────────────────────
  describe('get', () => {
    it('returns process info for existing PID', () => {
      const tree = makeTree([{ pid: 100, ppid: 1, cmd: 'node server.js' }]);
      const proc = tree.get(100);
      assert.ok(proc);
      assert.equal(proc.pid, 100);
      assert.equal(proc.cmd, 'node server.js');
    });

    it('returns null for non-existing PID', () => {
      const tree = makeTree([{ pid: 100, ppid: 1, cmd: 'node' }]);
      assert.equal(tree.get(999), null);
    });
  });

  // ── isOrphan ────────────────────────────────────────────────────
  describe('isOrphan', () => {
    it('PPID=1 → orphan (reparented to launchd/init)', () => {
      const tree = makeTree([{ pid: 200, ppid: 1, cmd: 'zombie' }]);
      const result = tree.isOrphan(200);
      assert.equal(result.isOrphan, true);
      assert.equal(result.ppid, 1);
    });

    it('PPID=existing parent → not orphan', () => {
      const tree = makeTree([
        { pid: 50, ppid: 1, cmd: 'bash' },
        { pid: 200, ppid: 50, cmd: 'node app.js' },
      ]);
      const result = tree.isOrphan(200);
      assert.equal(result.isOrphan, false);
      assert.equal(result.reason, 'has-parent');
    });

    it('PPID=non-existing parent (not 1) → orphan (parent-gone)', () => {
      const tree = makeTree([{ pid: 300, ppid: 9999, cmd: 'orphan' }]);
      const result = tree.isOrphan(300);
      assert.equal(result.isOrphan, true);
      assert.equal(result.reason, 'parent-gone');
    });

    it('PID not in tree → not orphan, reason not-in-tree', () => {
      const tree = makeTree([]);
      const result = tree.isOrphan(123);
      assert.equal(result.isOrphan, false);
      assert.equal(result.reason, 'not-in-tree');
    });
  });

  // ── hasAncestorMatching ─────────────────────────────────────────
  describe('hasAncestorMatching', () => {
    it('returns true when ancestor matches', () => {
      const tree = makeTree([
        { pid: 10, ppid: 1, cmd: 'tmux' },
        { pid: 20, ppid: 10, cmd: 'bash' },
        { pid: 30, ppid: 20, cmd: 'node app.js' },
      ]);
      const found = tree.hasAncestorMatching(30, (p) => p.cmd === 'tmux');
      assert.equal(found, true);
    });

    it('returns false when no ancestor matches', () => {
      const tree = makeTree([
        { pid: 10, ppid: 1, cmd: 'bash' },
        { pid: 20, ppid: 10, cmd: 'node app.js' },
      ]);
      const found = tree.hasAncestorMatching(20, (p) => p.cmd === 'tmux');
      assert.equal(found, false);
    });

    it('cycle protection: does not loop forever', () => {
      // Artificial cycle: A→B→A
      const tree = makeTree([
        { pid: 10, ppid: 20, cmd: 'a' },
        { pid: 20, ppid: 10, cmd: 'b' },
      ]);
      const found = tree.hasAncestorMatching(10, () => false);
      assert.equal(found, false); // terminates without hanging
    });

    it('stops at PID 1 (does not test PID 1 as ancestor)', () => {
      const tree = makeTree([
        { pid: 1, ppid: 0, cmd: 'init' },
        { pid: 10, ppid: 1, cmd: 'bash' },
      ]);
      const found = tree.hasAncestorMatching(10, (p) => p.cmd === 'init');
      assert.equal(found, false);
    });
  });

  // ── ancestors ───────────────────────────────────────────────────
  describe('ancestors', () => {
    it('returns ancestor chain from parent to root', () => {
      const tree = makeTree([
        { pid: 10, ppid: 1, cmd: 'init-child' },
        { pid: 20, ppid: 10, cmd: 'bash' },
        { pid: 30, ppid: 20, cmd: 'node' },
      ]);
      const chain = tree.ancestors(30);
      assert.equal(chain.length, 2);
      assert.equal(chain[0].pid, 20); // direct parent first
      assert.equal(chain[1].pid, 10);
    });

    it('returns empty array when PID not in tree', () => {
      const tree = makeTree([]);
      assert.deepEqual(tree.ancestors(999), []);
    });

    it('returns empty array when parent not in tree', () => {
      const tree = makeTree([{ pid: 100, ppid: 9999, cmd: 'orphan' }]);
      assert.deepEqual(tree.ancestors(100), []);
    });
  });

});

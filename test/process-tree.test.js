'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree, parseElapsed } = require('../src/process-tree');
const { sanitizeDiagnosticText } = require('../src/process-diagnostic');

const isWindows = process.platform === 'win32';

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
  // ── fromPS parsing ──────────────────────────────────────────────
  describe('fromPS', () => {
    it('builds a tree from live ps output without throwing', { skip: isWindows }, () => {
      const tree = ProcessTree.fromPS();
      // Should have at least the current shell and node process
      assert.ok(tree.byPid.size > 0, 'tree should contain processes');
    });

    it('excludes its own PID from the tree', { skip: isWindows }, () => {
      const tree = ProcessTree.fromPS();
      assert.equal(tree.get(process.pid), null);
    });

    it('surfaces an explicit error when ps returns no process rows', () => {
      const tree = ProcessTree.fromPS({
        platform: 'darwin',
        currentPid: 9999,
        execSync: () => '',
      });

      assert.equal(tree.byPid.size, 0);
      assert.equal(tree.errors.length, 1);
      assert.equal(tree.errors[0].code, 'process-enumeration-provider-empty');
      assert.equal(tree.errors[0].provider, 'ps');
    });

    it('surfaces an explicit error when ps output is only partially parsed', () => {
      const tree = ProcessTree.fromPS({
        platform: 'linux',
        currentPid: 9999,
        execSync: () => [
          '123 1 2048 01:23:45 Mon Jan 1 12:00:00 2024 node server.js',
          'this row cannot be parsed',
        ].join('\n'),
      });

      assert.equal(tree.byPid.size, 1);
      assert.equal(tree.get(123).cmd, 'node server.js');
      assert.equal(tree.errors.length, 1);
      assert.equal(tree.errors[0].code, 'process-enumeration-provider-partial');
      assert.equal(tree.errors[0].provider, 'ps');
    });
  });

  describe('Windows enumeration', () => {
    const sampleCimOutput = JSON.stringify([
      {
        ProcessId: 1234,
        ParentProcessId: 4321,
        CommandLine: 'node C:\\agent\\server.js',
        WorkingSetSize: 1048576,
        CreationDate: '2024-01-01T00:00:00.000Z',
      },
    ]);

    it('uses CIM quietly when WMIC is not installed', () => {
      const calls = [];
      const tree = ProcessTree.build({
        platform: 'win32',
        currentPid: 9999,
        now: new Date('2024-01-01T01:00:00.000Z').getTime(),
        execSync(command, options) {
          calls.push({ command, options });
          if (command === 'where wmic') throw new Error('wmic not found');
          if (command.includes('Get-CimInstance')) return sampleCimOutput;
          throw new Error(`unexpected command: ${command}`);
        },
      });

      assert.equal(tree.get(1234).cmd, 'node C:\\agent\\server.js');
      assert.equal(tree.errors.length, 0);
      assert.equal(tree.warnings.length, 0);
      assert.equal(calls[0].command, 'where wmic');
      assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
      assert.ok(calls.some(({ command }) => command.includes('Get-CimInstance')));
      assert.ok(!calls.some(({ command }) => command.includes('wmic process get')));
    });

    it('falls back to CIM when WMIC returns no process rows', () => {
      const tree = ProcessTree.build({
        platform: 'win32',
        currentPid: 9999,
        execSync(command) {
          if (command === 'where wmic') return 'C:\\Windows\\System32\\wbem\\WMIC.exe';
          if (command.includes('wmic process get')) {
            return 'Node,CommandLine,CreationDate,ParentProcessId,ProcessId,WorkingSetSize\r\r\n';
          }
          if (command.includes('Get-CimInstance')) return sampleCimOutput;
          throw new Error(`unexpected command: ${command}`);
        },
      });

      assert.equal(tree.get(1234).ppid, 4321);
      assert.equal(tree.errors.length, 0);
      assert.equal(tree.warnings[0].code, 'process-enumeration-provider-empty');
      assert.equal(tree.warnings[0].provider, 'wmic');
    });

    it('surfaces an explicit error when all Windows providers fail', () => {
      const tree = ProcessTree.build({
        platform: 'win32',
        currentPid: 9999,
        execSync(command) {
          if (command === 'where wmic') return 'C:\\Windows\\System32\\wbem\\WMIC.exe';
          if (command.includes('wmic process get')) {
            const error = new Error('wmic failed');
            error.stderr = Buffer.from('WMIC provider stderr: invalid alias\r\n');
            throw error;
          }
          if (command.includes('Get-CimInstance')) {
            const error = new Error('cim failed');
            error.stderr = Buffer.from('CIM provider stderr: access denied\r\n');
            throw error;
          }
          throw new Error(`unexpected command: ${command}`);
        },
      });

      assert.equal(tree.byPid.size, 0);
      assert.ok(tree.warnings.length >= 2);
      assert.equal(tree.errors.length, 1);
      assert.equal(tree.errors[0].code, 'process-enumeration-failed');
      assert.equal(tree.errors[0].platform, 'win32');
      assert.deepEqual(tree.errors[0].providers, ['cim', 'wmic']);
      assert.ok(tree.warnings.some((warning) => warning.message.includes('WMIC provider stderr')));
      assert.ok(tree.warnings.some((warning) => warning.message.includes('CIM provider stderr')));
    });
  });

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

  // ── parseElapsed ────────────────────────────────────────────────
  describe('parseElapsed', () => {
    it('parses MM:SS', () => {
      assert.equal(parseElapsed('05:30'), (5 * 60 + 30) * 1000);
    });

    it('parses HH:MM:SS', () => {
      assert.equal(parseElapsed('01:23:45'), (1 * 3600 + 23 * 60 + 45) * 1000);
    });

    it('parses DD-HH:MM:SS', () => {
      assert.equal(parseElapsed('2-03:04:05'), ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000);
    });

    it('returns 0 for empty/null', () => {
      assert.equal(parseElapsed(''), 0);
      assert.equal(parseElapsed(null), 0);
    });
  });

  describe('public process diagnostics', () => {
    it('redacts credential values without treating hyphenated prose as an option', () => {
      const sanitized = sanitizeDiagnosticText(
        'bearer-secret worker failed /Users/example/private --token=secret-value'
      );

      assert.match(sanitized, /^bearer-secret worker failed \[local-path\]/);
      assert.match(sanitized, /--token=\[redacted\]/);
      assert.equal(sanitized.includes('secret-value'), false);
    });
  });
});

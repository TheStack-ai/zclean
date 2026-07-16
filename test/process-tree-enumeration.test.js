'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProcessTree } = require('../src/process-tree');

describe('ProcessTree', () => {
  // ── fromPS parsing ──────────────────────────────────────────────
  describe('fromPS', () => {
    it('builds a tree from injected ps output', () => {
      const tree = ProcessTree.fromPS({
        platform: 'darwin',
        currentPid: 9999,
        execSync: () => '123 1 2048 01:23:45 Mon Jan 1 12:00:00 2024 node server.js',
      });

      assert.equal(tree.get(123).cmd, 'node server.js');
    });

    it('excludes the injected current PID from the tree', () => {
      const tree = ProcessTree.fromPS({
        platform: 'linux',
        currentPid: 123,
        execSync: () => [
          '123 1 2048 01:23:45 Mon Jan 1 12:00:00 2024 node self.js',
          '456 1 1024 00:10:00 Mon Jan 1 12:00:00 2024 node worker.js',
        ].join('\n'),
      });

      assert.equal(tree.get(123), null);
      assert.equal(tree.get(456).cmd, 'node worker.js');
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

    it('accepts a BOM before CIM JSON output', () => {
      const tree = ProcessTree.fromCIM({
        currentPid: 9999,
        execSync: () => `\ufeff${sampleCimOutput}`,
      });

      assert.equal(tree.get(1234).ppid, 4321);
      assert.equal(tree.errors.length, 0);
    });

    it('enumerates live Windows processes without a false-clean result', {
      skip: process.platform !== 'win32',
    }, () => {
      const tree = ProcessTree.build();
      assert.equal(tree.errors.length, 0, JSON.stringify(tree.errors));
      assert.ok(tree.byPid.size > 0, JSON.stringify(tree.warnings));
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

    it('keeps commandless CIM rows so a live parent is not mistaken for a missing parent', () => {
      const tree = ProcessTree.build({
        platform: 'win32',
        currentPid: 9999,
        execSync(command) {
          if (command === 'where wmic') throw new Error('wmic not found');
          if (command.includes('Get-CimInstance')) {
            return JSON.stringify([
              {
                ProcessId: 4321,
                ParentProcessId: 4,
                CommandLine: null,
                WorkingSetSize: 2048,
                CreationDate: '2024-01-01T00:00:00.000Z',
              },
              {
                ProcessId: 1234,
                ParentProcessId: 4321,
                CommandLine: 'node C:\\agent\\worker.js',
                WorkingSetSize: 4096,
                CreationDate: '2024-01-01T00:05:00.000Z',
              },
            ]);
          }
          throw new Error(`unexpected command: ${command}`);
        },
      });

      assert.ok(tree.get(4321), 'parent row must remain in the topology');
      assert.equal(tree.get(4321).cmd, '');
      assert.equal(tree.isOrphan(1234).isOrphan, false);
      assert.equal(tree.errors.length, 0);
    });

    it('surfaces partial CIM parsing instead of treating a child with a missing row as safe', () => {
      const tree = ProcessTree.build({
        platform: 'win32',
        currentPid: 9999,
        execSync(command) {
          if (command === 'where wmic') throw new Error('wmic not found');
          if (command.includes('Get-CimInstance')) {
            return JSON.stringify([
              {
                ProcessId: 'not-a-pid',
                ParentProcessId: 4,
                CommandLine: 'parent.exe',
              },
              {
                ProcessId: 1234,
                ParentProcessId: 4321,
                CommandLine: 'node C:\\agent\\worker.js',
              },
            ]);
          }
          throw new Error(`unexpected command: ${command}`);
        },
      });

      assert.equal(tree.get(1234).ppid, 4321);
      assert.ok(tree.errors.some((error) => error.code === 'process-enumeration-provider-partial'));
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

});

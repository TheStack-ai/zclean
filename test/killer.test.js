'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { killZombies, verifyProcess, killProcess } = require('../src/killer');

// Fake zombies for testing batch limits (verifyProcess will fail → skipped, which is fine)
function fakeZombies(n) {
  return Array.from({ length: n }, (_, i) => ({
    pid: 90000 + i,
    name: 'test-zombie',
    cmd: `fake-zombie-${i}`,
    ppid: 1,
    mem: 1024,
    age: 100000,
    startTime: null,
    reason: 'test',
    pattern: 'test-zombie',
  }));
}

describe('killZombies — maxKillBatch', () => {
  it('limits processing to maxKillBatch when input exceeds limit', () => {
    const zombies = fakeZombies(25);
    const config = { maxKillBatch: 5, sigterm_timeout: 1 };
    const results = killZombies(zombies, config);

    // Should only attempt 5 (all will be skipped since PIDs are fake)
    const attempted = results.killed.length + results.failed.length + results.skipped.length;
    assert.equal(attempted, 5);
  });

  it('sets warning when batch limit exceeded', () => {
    const zombies = fakeZombies(25);
    const config = { maxKillBatch: 5, sigterm_timeout: 1 };
    const results = killZombies(zombies, config);

    assert.ok(results.warning);
    assert.ok(results.warning.includes('25'));
    assert.ok(results.warning.includes('5'));
  });

  it('processes all when count <= limit, no warning', () => {
    const zombies = fakeZombies(3);
    const config = { maxKillBatch: 10, sigterm_timeout: 1 };
    const results = killZombies(zombies, config);

    const attempted = results.killed.length + results.failed.length + results.skipped.length;
    assert.equal(attempted, 3);
    assert.equal(results.warning, null);
  });

  it('skips fake PIDs (verifyProcess fails → skipped)', () => {
    const zombies = fakeZombies(2);
    const config = { maxKillBatch: 20, sigterm_timeout: 1 };
    const results = killZombies(zombies, config);

    // Fake PIDs won't exist → skipped
    assert.equal(results.skipped.length, 2);
    assert.equal(results.killed.length, 0);
  });
});

describe('custom pattern kill verification', () => {
  it('rejects a process whose current command no longer contains the custom literal', () => {
    const sharedPrefix = `node ${'a'.repeat(50)}`;
    const result = verifyProcess({
      pid: 3210,
      cmd: `${sharedPrefix}my-agent-worker`,
      matchLiteral: 'my-agent-worker',
      startTime: null,
    }, {
      platform: 'darwin',
      execSync(command) {
        if (command.includes('ps -o command=')) return `${sharedPrefix}other-service`;
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'pattern-mismatch' });
  });
});

describe('Windows kill verification', () => {
  it('verifies identity with CIM when WMIC is missing', () => {
    const proc = {
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };

    const result = verifyProcess(proc, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('wmic')) throw new Error('wmic missing');
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: 'node C:\\agent\\server.js',
            CreationDate: '2024-01-01T00:00:00.000Z',
          });
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: true, reason: 'verified' });
  });

  it('rejects a recycled Windows PID when start time changed', () => {
    const proc = {
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };

    const result = verifyProcess(proc, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: 'node C:\\agent\\server.js',
            CreationDate: '2024-01-01T00:10:00.000Z',
          });
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'start-time-mismatch' });
  });

  it('polls process existence without WMIC before force kill', () => {
    const calls = [];
    const result = killProcess(3210, 1000, {
      platform: 'win32',
      execSync(command) {
        calls.push(command);
        if (command.startsWith('taskkill /PID 3210')) return '';
        if (command.includes('Get-CimInstance')) return '[]';
        if (command.startsWith('timeout /T')) return '';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { success: true, method: 'taskkill' });
    assert.ok(calls.some((command) => command.includes('Get-CimInstance')));
    assert.ok(!calls.some((command) => command.includes('wmic')));
  });
});

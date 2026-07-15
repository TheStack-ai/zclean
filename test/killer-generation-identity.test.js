'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { killProcess } = require('../src/killer');

describe('destructive process generation identity', () => {
  it('rejects a Unix process without a scanned start time before signaling', () => {
    const proc = { pid: 3210, cmd: 'node /tmp/worker.js', startTime: null };
    const signals = [];
    const result = killProcess(proc, 0, {
      platform: 'linux',
      execSync(command) {
        if (command.includes('ps -o command=')) return proc.cmd;
        throw new Error(`unexpected command: ${command}`);
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /start-time-unverified/);
    assert.deepEqual(signals, []);
  });

  it('rejects a Windows process without a scanned start time before taskkill', () => {
    const proc = { pid: 3210, cmd: 'node C:\\agent\\server.js', startTime: null };
    const calls = [];
    const result = killProcess(proc, 0, {
      platform: 'win32',
      now: () => 1000,
      execSync(command) {
        calls.push(command);
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({ ProcessId: 3210, CommandLine: proc.cmd });
        }
        if (command.startsWith('taskkill')) return '';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /start-time-unverified/);
    assert.equal(calls.some((command) => command.startsWith('taskkill')), false);
  });
});

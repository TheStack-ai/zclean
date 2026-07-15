'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { killProcess } = require('../src/killer');

describe('Unix kill polling safety', () => {
  it('does not report success when the liveness probe is denied', () => {
    const proc = {
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };
    const signals = [];

    const result = killProcess(proc, 1000, {
      platform: 'linux',
      execSync(command) {
        if (command.includes('ps -o command=')) return proc.cmd;
        if (command.includes('ps -o lstart=')) return proc.startTime;
        throw new Error(`unexpected command: ${command}`);
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 0) {
          const error = new Error('operation not permitted');
          error.code = 'EPERM';
          throw error;
        }
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /liveness|EPERM|verification/i);
    assert.deepEqual(signals, [[3210, 'SIGTERM'], [3210, 0]]);
  });
});

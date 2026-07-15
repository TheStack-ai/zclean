'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifyProcess, killProcess } = require('../src/killer');

describe('Windows process identity query failures', () => {
  it('fails closed when CIM returns a nonempty row without the requested PID', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('Get-CimInstance')) return '{}';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'identity-query-failed' });
  });

  it('fails closed when CIM returns an incomplete row after taskkill', () => {
    const proc = {
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };
    let processReads = 0;
    const result = killProcess(proc, 1000, {
      platform: 'win32',
      now: () => 1000,
      execSync(command) {
        if (command.includes('Get-CimInstance')) {
          processReads += 1;
          return processReads === 1
            ? JSON.stringify({
              ProcessId: 3210,
              CommandLine: proc.cmd,
              CreationDate: proc.startTime,
            })
            : '{}';
        }
        if (command === 'taskkill /PID 3210') return '';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /query|unverified|identity/i);
  });
});

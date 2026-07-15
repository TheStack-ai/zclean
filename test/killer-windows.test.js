'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifyProcess, killProcess } = require('../src/killer');

describe('Windows kill verification', () => {
  it('rejects a changed command when only the suffix after 50 characters differs', () => {
    const sharedPrefix = `node C:\\agent\\${'a'.repeat(64)}`;
    const result = verifyProcess({
      pid: 3210,
      cmd: `${sharedPrefix} --mode=scan`,
      startTime: null,
    }, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: `${sharedPrefix} --mode=serve`,
          });
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'cmd-mismatch' });
  });

  it('accepts the complete command when only surrounding whitespace differs', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: '  node C:\\agent\\server.js --mode=scan  ',
      startTime: null,
    }, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: '\r\nnode C:\\agent\\server.js --mode=scan\r\n',
          });
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: true, reason: 'verified' });
  });

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

  it('fails closed when the current Windows start time is missing', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: 'node C:\\agent\\server.js',
          });
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'start-time-unverified' });
  });

  it('fails closed when the current Windows start time is unparsable', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'win32',
      execSync(command) {
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: 'node C:\\agent\\server.js',
            CreationDate: 'not-a-date',
          });
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'start-time-unverified' });
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

  it('rechecks Windows identity before force-kill escalation', () => {
    const proc = {
      pid: 3210,
      cmd: 'node C:\\agent\\server.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };
    let currentCmd = proc.cmd;
    const calls = [];
    const result = killProcess(proc, 0, {
      platform: 'win32',
      now: () => 1000,
      execSync(command) {
        calls.push(command);
        if (command.includes('Get-CimInstance')) {
          return JSON.stringify({
            ProcessId: 3210,
            CommandLine: currentCmd,
            CreationDate: proc.startTime,
          });
        }
        if (command === 'taskkill /PID 3210') {
          currentCmd = 'replacement-process';
          return '';
        }
        if (command === 'taskkill /F /PID 3210') return '';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /identity/i);
    assert.equal(calls.includes('taskkill /F /PID 3210'), false);
  });
});

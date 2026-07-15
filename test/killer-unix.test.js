'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifyProcess, killProcess } = require('../src/killer');

describe('Unix kill verification', () => {
  it('rejects invalid PIDs before invoking ps', () => {
    let calls = 0;
    const result = verifyProcess({
      pid: '3210; touch /tmp/should-not-run',
      cmd: 'node /tmp/worker.js',
      startTime: null,
    }, {
      platform: 'darwin',
      execSync() {
        calls += 1;
        return 'node /tmp/worker.js';
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'invalid-pid' });
    assert.equal(calls, 0);
  });

  it('rejects a changed command when only the suffix after 50 characters differs', () => {
    const sharedPrefix = `node /tmp/${'a'.repeat(64)}`;
    const result = verifyProcess({
      pid: 3210,
      cmd: `${sharedPrefix} --mode=scan`,
      startTime: null,
    }, {
      platform: 'darwin',
      execSync(command) {
        if (command.includes('ps -o command=')) return `${sharedPrefix} --mode=serve`;
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'cmd-mismatch' });
  });

  it('accepts the complete command when only surrounding whitespace differs', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: '  node /tmp/worker.js --mode=scan  ',
      startTime: null,
    }, {
      platform: 'linux',
      execSync(command) {
        if (command.includes('ps -o command=')) return '\nnode /tmp/worker.js --mode=scan\r\n';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: true, reason: 'verified' });
  });

  it('fails closed when the current start time is missing', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'darwin',
      execSync(command) {
        if (command.includes('ps -o command=')) return 'node /tmp/worker.js';
        if (command.includes('ps -o lstart=')) return '   ';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'start-time-unverified' });
  });

  it('fails closed when the current start time is unparsable', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'linux',
      execSync(command) {
        if (command.includes('ps -o command=')) return 'node /tmp/worker.js';
        if (command.includes('ps -o lstart=')) return 'not-a-date';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'start-time-unverified' });
  });

  it('rejects a recycled PID when the Unix start time changed', () => {
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'darwin',
      execSync(command) {
        if (command.includes('ps -o command=')) return 'node /tmp/worker.js';
        if (command.includes('ps -o lstart=')) return '2024-01-01T00:10:00.000Z';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'start-time-mismatch' });
  });

  it('forces the C locale while verifying the Unix start time', () => {
    const calls = [];
    const result = verifyProcess({
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    }, {
      platform: 'linux',
      execSync(command) {
        calls.push(command);
        if (command.includes('ps -o command=')) return 'node /tmp/worker.js';
        if (command.includes('ps -o lstart=')) return '2024-01-01T00:00:00.000Z';
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: true, reason: 'verified' });
    assert.ok(calls.includes('LC_ALL=C ps -o lstart= -p 3210'));
  });

  it('rejects a bare numeric PID before sending any signal', () => {
    const signals = [];
    const commands = [];
    const result = killProcess(3210, 0, {
      platform: 'linux',
      execSync(command) {
        commands.push(command);
        return '';
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /identity.+required/i);
    assert.deepEqual(signals, []);
    assert.deepEqual(commands, []);
  });

  it('rechecks identity immediately before the first signal', () => {
    const proc = {
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };
    let currentCmd = proc.cmd;
    const signals = [];
    const runtime = {
      platform: 'darwin',
      execSync(command) {
        if (command.includes('ps -o command=')) return currentCmd;
        if (command.includes('ps -o lstart=')) return proc.startTime;
        throw new Error(`unexpected command: ${command}`);
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
      },
    };

    assert.deepEqual(verifyProcess(proc, runtime), { valid: true, reason: 'verified' });
    currentCmd = 'replacement-process';
    const result = killProcess(proc, 0, runtime);

    assert.equal(result.success, false);
    assert.match(result.error, /identity/i);
    assert.deepEqual(signals, []);
  });

  it('rechecks identity before SIGKILL escalation', () => {
    const proc = {
      pid: 3210,
      cmd: 'node /tmp/worker.js',
      startTime: '2024-01-01T00:00:00.000Z',
    };
    let currentCmd = proc.cmd;
    const signals = [];
    const result = killProcess(proc, 0, {
      platform: 'linux',
      execSync(command) {
        if (command.includes('ps -o command=')) return currentCmd;
        if (command.includes('ps -o lstart=')) return proc.startTime;
        throw new Error(`unexpected command: ${command}`);
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 'SIGTERM') currentCmd = 'replacement-process';
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /identity/i);
    assert.deepEqual(signals, [[3210, 'SIGTERM']]);
  });
});

describe('custom pattern kill verification', () => {
  it('rejects a process whose current command no longer contains the custom literal', () => {
    const sharedPrefix = `node ${'a'.repeat(50)}`;
    const currentCmd = `${sharedPrefix}other-service`;
    const result = verifyProcess({
      pid: 3210,
      cmd: currentCmd,
      matchLiteral: 'my-agent-worker',
      startTime: null,
    }, {
      platform: 'darwin',
      execSync(command) {
        if (command.includes('ps -o command=')) return currentCmd;
        throw new Error(`unexpected command: ${command}`);
      },
    });

    assert.deepEqual(result, { valid: false, reason: 'pattern-mismatch' });
  });
});

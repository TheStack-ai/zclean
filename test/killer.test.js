'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { killZombies } = require('../src/killer');

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

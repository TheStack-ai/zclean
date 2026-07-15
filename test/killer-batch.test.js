'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { killZombies } = require('../src/killer');

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
    cleanupEligible: true,
    classification: 'confirmed-stale',
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

  it('skips explicitly ineligible candidates before identity verification', () => {
    const [candidate] = fakeZombies(1);
    candidate.pid = 'not-a-pid';
    candidate.cleanupEligible = false;
    candidate.blockedReasons = ['start-time-unverified'];

    const results = killZombies([candidate], { maxKillBatch: 20, sigterm_timeout: 1 });

    assert.equal(results.skipped.length, 1);
    assert.equal(results.skipped[0].skipReason, 'cleanup-ineligible');
    assert.equal(results.killed.length, 0);
    assert.equal(results.failed.length, 0);
  });

  it('fails closed when cleanup eligibility metadata is missing or inconsistent', () => {
    const missing = {
      ...fakeZombies(1)[0],
      pid: 'not-a-pid',
      classification: 'confirmed-stale',
    };
    delete missing.cleanupEligible;
    const inconsistent = {
      ...fakeZombies(1)[0],
      pid: 'not-a-pid',
      cleanupEligible: true,
      classification: 'suspected',
    };

    const results = killZombies([missing, inconsistent], {
      maxKillBatch: 20,
      sigterm_timeout: 1,
    });

    assert.deepEqual(
      results.skipped.map((candidate) => candidate.skipReason),
      ['cleanup-ineligible', 'cleanup-ineligible']
    );
    assert.equal(results.killed.length, 0);
    assert.equal(results.failed.length, 0);
  });

  it('applies the batch limit after filtering ineligible candidates', () => {
    const candidates = fakeZombies(3);
    candidates[0].cleanupEligible = false;
    candidates[0].blockedReasons = ['active-session-descendant'];
    candidates[1].classification = 'suspected';
    candidates[2].pid = 'not-a-pid';

    const results = killZombies(candidates, { maxKillBatch: 1, sigterm_timeout: 1 });

    assert.deepEqual(
      results.skipped.map((candidate) => candidate.skipReason),
      ['cleanup-ineligible', 'cleanup-ineligible', 'invalid-pid']
    );
    assert.equal(results.warning, null);
  });
});

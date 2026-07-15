'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAuditReport } = require('../src/audit');

function classified(candidate, options = {}) {
  const cleanupEligible = options.cleanupEligible !== false;
  const provider = options.provider || candidate.pattern || 'unknown';
  return {
    ...candidate,
    provider,
    classification: options.classification || (cleanupEligible ? 'confirmed-stale' : 'suspected'),
    confidence: options.confidence || {
      score: cleanupEligible ? 95 : 60,
      level: cleanupEligible ? 'high' : 'medium',
    },
    evidence: options.evidence || [
      `runtime-pattern:${candidate.pattern || 'unknown'}`,
      `provider:${provider}`,
      'orphan:parent-gone',
      'age-grace-met',
      ...(cleanupEligible ? ['start-time:verified'] : []),
    ],
    cleanupEligible,
    blockedReasons: cleanupEligible ? [] : (options.blockedReasons || ['start-time-unverified']),
  };
}

describe('audit report safety', () => {
  it('omits raw command lines and local paths from candidate JSON', () => {
    const privatePath = '/Users/example/private-project/server.js';
    const zombies = [
      classified({
        pid: 101,
        name: 'node',
        pattern: 'codex',
        cmd: `node ${privatePath} --token=secret`,
        mem: 80 * 1024 * 1024,
        age: 14 * 60 * 60 * 1000,
        reason: 'pattern:codex, age-exceeded',
      }, {
        evidence: [
          'runtime-pattern:codex',
          'provider:codex',
          `local-path:${privatePath}`,
          'token:secret',
          'start-time:verified',
        ],
      }),
    ];
    zombies.warnings = [];
    zombies.errors = [];

    const report = buildAuditReport({
      config: { whitelist: [], dryRunDefault: true },
      zombies,
      logs: [],
      stats: {},
      now: '2026-06-30T01:00:00.000Z',
      commandName: 'report',
    });

    assert.equal(report.schemaVersion, 1);
    assert.equal(JSON.stringify(report).includes(privatePath), false);
    assert.equal(report.proGradeReview.candidates[0].command, undefined);
    assert.equal(report.proGradeReview.topCandidates[0].command, undefined);
    assert.equal(report.candidates.largestCandidate.command, undefined);
    assert.deepEqual(report.proGradeReview.candidates[0].evidence, [
      'runtime-pattern:codex',
      'provider:codex',
      'start-time:verified',
    ]);
  });

  it('offers cleanup only when eligible candidates exist and enumeration is complete', () => {
    const blocked = [classified({
      pid: 101,
      pattern: 'codex',
      mem: 1024,
      age: 1000,
    }, { cleanupEligible: false, blockedReasons: ['age-grace-not-met'] })];
    blocked.warnings = [];
    blocked.errors = [];

    const blockedReport = buildAuditReport({ zombies: blocked, now: '2026-06-30T01:00:00.000Z' });
    assert.equal(blockedReport.proGradeReview.safeToClean, false);
    assert.equal(blockedReport.summary.eligibleCount, 0);
    assert.equal(blockedReport.summary.blockedCount, 1);
    assert.doesNotMatch(JSON.stringify(blockedReport.recommendations), /zclean --yes/);
    assert.ok(!blockedReport.nextActions.some((item) => item.command === 'zclean --yes'));

    const incomplete = [classified({
      pid: 202,
      pattern: 'claude',
      mem: 1024,
      age: 7200000,
    })];
    incomplete.warnings = [];
    incomplete.errors = [{ code: 'process-enumeration-failed', message: 'provider failed' }];

    const incompleteReport = buildAuditReport({ zombies: incomplete, now: '2026-06-30T01:00:00.000Z' });
    assert.equal(incompleteReport.proGradeReview.safeToClean, false);
    assert.equal(incompleteReport.summary.reclaimableBytes, 0);
    assert.equal(incompleteReport.candidates.memoryReclaimable, 0);
    assert.doesNotMatch(JSON.stringify(incompleteReport.recommendations), /zclean --yes/);
    assert.ok(!incompleteReport.nextActions.some((item) => item.command === 'zclean --yes'));
  });

  it('marks enumeration failures as unknown risk', () => {
    const zombies = [];
    zombies.warnings = [];
    zombies.errors = [{ code: 'process-enumeration-failed', message: 'provider failed' }];

    const report = buildAuditReport({ zombies, now: '2026-06-30T01:00:00.000Z' });

    assert.equal(report.risk.score, 0);
    assert.equal(report.risk.level, 'unknown');
    assert.equal(report.risk.enumerationComplete, false);
    assert.match(report.recommendations[0], /zclean doctor/);
  });

  it('redacts diagnostic paths and secrets from public report JSON', () => {
    const zombies = [];
    zombies.warnings = [{
      code: 'provider-warning',
      provider: 'ps',
      message: 'failed at /Users/example/private/project --token=secret-value',
    }];
    zombies.errors = [{
      code: 'process-enumeration-failed',
      provider: 'cim',
      message: 'C:\\Users\\example\\private\\worker.exe --api-key top-secret',
    }];

    const report = buildAuditReport({ zombies, now: '2026-06-30T01:00:00.000Z' });
    const serialized = JSON.stringify(report);

    assert.equal(serialized.includes('/Users/example/private/project'), false);
    assert.equal(serialized.includes('C:\\Users\\example\\private'), false);
    assert.equal(serialized.includes('secret-value'), false);
    assert.equal(serialized.includes('top-secret'), false);
    assert.match(serialized, /\[local-path\]/);
    assert.match(serialized, /\[redacted\]/);
  });

  it('redacts JSON-shaped, prefixed environment, and history failure secrets', () => {
    const zombies = [];
    zombies.warnings = [{
      code: 'provider-warning',
      provider: 'ps',
      message: '{"token":"json-secret","OPENAI_API_KEY":"openai-secret"}',
    }];
    zombies.errors = [];

    const report = buildAuditReport({
      zombies,
      logs: [{
        timestamp: '2026-06-30T00:00:00.000Z',
        action: 'kill-failed',
        pid: 404,
        error: 'ANTHROPIC_AUTH_TOKEN=env-secret Bearer bearer-secret at /Users/alice/private/project',
      }],
      now: '2026-06-30T01:00:00.000Z',
    });
    const serialized = JSON.stringify(report);

    for (const secret of ['json-secret', 'openai-secret', 'env-secret', 'bearer-secret', '/Users/alice/private/project']) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    assert.match(serialized, /\[redacted\]/);
    assert.match(serialized, /\[local-path\]/);
  });
});

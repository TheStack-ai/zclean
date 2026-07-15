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

describe('audit report', () => {
  it('summarizes AI runtime candidates without destructive actions', () => {
    const zombies = [
      classified({
        pid: 123,
        name: 'Claude Code',
        pattern: 'claude',
        cmd: 'node /private/project/.claude/secret-token --api-key=abc',
        mem: 256 * 1024 * 1024,
        age: 7200000,
        reason: 'pattern:claude, orphan:ppid=1',
      }),
      classified({
        pid: 456,
        name: 'agent-browser',
        pattern: 'agent-browser',
        mem: 128 * 1024 * 1024,
        age: 3600000,
        reason: 'pattern:agent-browser, age-exceeded',
      }, {
        cleanupEligible: false,
        provider: 'unknown',
        classification: 'unattributed',
        blockedReasons: ['provider-pattern-not-strong', 'start-time-unverified'],
      }),
    ];
    zombies.warnings = [];
    zombies.errors = [];

    const report = buildAuditReport({
      config: {
        whitelist: ['keep-me'],
        maxAge: '24h',
        memoryThreshold: '500MB',
        maxKillBatch: 20,
        dryRunDefault: true,
        customAiDirs: ['.custom-ai'],
      },
      zombies,
      logs: [
        { action: 'dry-run' },
        { action: 'cleanup-summary', killed: 2, totalMemFreed: 1024 },
      ],
      stats: { totalKilled: 5, totalMemFreed: 4096, weekKilled: 2, weekMemFreed: 1024, lastRun: '2026-06-30T00:00:00.000Z' },
      now: '2026-06-30T01:00:00.000Z',
    });

    assert.equal(report.kind, 'ai-coding-runtime-hygiene');
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.notGeneralCleaner, true);
    assert.match(report.differentiation, /does not uninstall apps/);
    assert.equal(report.risk.enumerationComplete, true);
    assert.equal(report.summary.zombieCount, 2);
    assert.equal(report.summary.eligibleCount, 1);
    assert.equal(report.summary.blockedCount, 1);
    assert.equal(report.summary.reclaimableBytes, 256 * 1024 * 1024);
    assert.equal(report.candidates.memoryReclaimable, 256 * 1024 * 1024);
    assert.equal(report.proGradeReview.safeToClean, true);
    assert.equal(report.proGradeReview.guardrails.cleanupRequiresYes, true);
    assert.equal(report.proGradeReview.guardrails.whitelistCount, 1);
    assert.equal(report.proGradeReview.guardrails.customAiDirCount, 1);
    assert.equal(report.proGradeReview.guardrails.localOnly, true);
    assert.equal(report.proGradeReview.guardrails.telemetry, false);
    assert.equal(report.history.recent.dryRuns, 1);
    assert.equal(report.history.recent.cleanupSummaries, 1);
    assert.equal(report.proGradeReview.candidates[0].command, undefined);
    assert.equal(report.proGradeReview.candidates[0].commandHidden, undefined);
    assert.equal(report.proGradeReview.candidates[0].provider, 'claude');
    assert.equal(report.proGradeReview.candidates[0].classification, 'confirmed-stale');
    assert.deepEqual(report.proGradeReview.candidates[0].confidence, { score: 95, level: 'high' });
    assert.ok(report.proGradeReview.candidates[0].evidence.includes('start-time:verified'));
    assert.doesNotMatch(JSON.stringify(report), /secret-token|api-key=abc|private\/project/);
    assert.ok(report.recommendations.some((item) => item.includes('zclean --yes')));
  });

  it('adds report JSON review fields for candidate triage and recent failures', () => {
    const zombies = [
      classified({
        pid: 101,
        name: 'small-old-runtime',
        pattern: 'codex',
        mem: 80 * 1024 * 1024,
        age: 14 * 60 * 60 * 1000,
        reason: 'pattern:codex, age-exceeded',
      }),
      classified({
        pid: 202,
        name: 'large-runtime',
        pattern: 'claude',
        mem: 900 * 1024 * 1024,
        age: 2 * 60 * 60 * 1000,
        reason: 'pattern:claude, orphan:ppid=1',
      }),
      classified({
        pid: 303,
        name: 'medium-runtime',
        pattern: 'codex',
        mem: 220 * 1024 * 1024,
        age: 90 * 60 * 1000,
        reason: 'pattern:codex, orphan:ppid=1',
      }, { cleanupEligible: false, blockedReasons: ['start-time-unverified'] }),
    ];
    zombies.warnings = [];
    zombies.errors = [];

    const report = buildAuditReport({
      config: { whitelist: [], dryRunDefault: true },
      zombies,
      logs: [
        { timestamp: '2026-06-30T00:00:00.000Z', action: 'dry-run', found: 3 },
        { timestamp: '2026-06-30T00:05:00.000Z', action: 'kill-failed', pid: 404, error: 'EPERM' },
        { timestamp: '2026-06-30T00:10:00.000Z', action: 'scan-failed', message: 'ps failed' },
        { timestamp: '2026-06-30T00:15:00.000Z', action: 'dry-run', found: 2 },
      ],
      stats: {},
      now: '2026-06-30T01:00:00.000Z',
      commandName: 'report',
    });

    assert.deepEqual(
      report.proGradeReview.topCandidates.map((candidate) => candidate.pid),
      [202, 101, 303]
    );
    assert.deepEqual(report.candidateSources.byPattern, {
      claude: { count: 1, memoryBytes: 900 * 1024 * 1024, pids: [202] },
      codex: { count: 2, memoryBytes: 300 * 1024 * 1024, pids: [101, 303] },
    });
    assert.equal(report.candidates.byPattern.codex, 2);
    assert.equal(report.candidates.eligibleCount, 2);
    assert.equal(report.candidates.blockedCount, 1);
    assert.equal(report.candidates.largestCandidate.pid, 202);
    assert.equal(report.candidates.oldestCandidate.pid, 101);
    assert.equal(report.history.lastDryRun, '2026-06-30T00:15:00.000Z');
    assert.deepEqual(
      report.history.recentFailures.map((entry) => entry.action),
      ['kill-failed', 'scan-failed']
    );
    assert.ok(report.nextActions.some((item) => item.id === 'review-top-candidates' && item.priority === 'high'));
    assert.ok(report.nextActions.some((item) => item.id === 'manual-cleanup-requires-yes'));
  });

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
});

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

describe('audit report summaries', () => {
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
});

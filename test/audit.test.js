'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAuditReport } = require('../src/audit');

describe('audit report', () => {
  it('summarizes AI runtime candidates without destructive actions', () => {
    const zombies = [
      {
        pid: 123,
        name: 'Claude Code',
        pattern: 'claude',
        cmd: 'node /private/project/.claude/secret-token --api-key=abc',
        mem: 256 * 1024 * 1024,
        age: 7200000,
        reason: 'pattern:claude, orphan:ppid=1',
      },
      {
        pid: 456,
        name: 'agent-browser',
        pattern: 'agent-browser',
        mem: 128 * 1024 * 1024,
        age: 3600000,
        reason: 'pattern:agent-browser, age-exceeded',
      },
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
    assert.equal(report.summary.reclaimableBytes, 384 * 1024 * 1024);
    assert.equal(report.proGradeReview.guardrails.cleanupRequiresYes, true);
    assert.equal(report.proGradeReview.guardrails.whitelistCount, 1);
    assert.equal(report.proGradeReview.guardrails.customAiDirCount, 1);
    assert.equal(report.proGradeReview.guardrails.localOnly, true);
    assert.equal(report.proGradeReview.guardrails.telemetry, false);
    assert.equal(report.history.recent.dryRuns, 1);
    assert.equal(report.history.recent.cleanupSummaries, 1);
    assert.equal(report.proGradeReview.candidates[0].command, undefined);
    assert.equal(report.proGradeReview.candidates[0].commandHidden, undefined);
    assert.doesNotMatch(JSON.stringify(report), /secret-token|api-key=abc|private\/project/);
    assert.ok(report.recommendations.some((item) => item.includes('zclean --yes')));
  });

  it('adds report JSON review fields for candidate triage and recent failures', () => {
    const zombies = [
      {
        pid: 101,
        name: 'small-old-runtime',
        pattern: 'codex',
        mem: 80 * 1024 * 1024,
        age: 14 * 60 * 60 * 1000,
        reason: 'pattern:codex, age-exceeded',
      },
      {
        pid: 202,
        name: 'large-runtime',
        pattern: 'claude',
        mem: 900 * 1024 * 1024,
        age: 2 * 60 * 60 * 1000,
        reason: 'pattern:claude, orphan:ppid=1',
      },
      {
        pid: 303,
        name: 'medium-runtime',
        pattern: 'codex',
        mem: 220 * 1024 * 1024,
        age: 90 * 60 * 1000,
        reason: 'pattern:codex, orphan:ppid=1',
      },
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
      {
        pid: 101,
        name: 'node',
        pattern: 'codex',
        cmd: `node ${privatePath} --token=secret`,
        mem: 80 * 1024 * 1024,
        age: 14 * 60 * 60 * 1000,
        reason: 'pattern:codex, age-exceeded',
      },
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
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG } = require('../src/config');
const { runDoctor } = require('../src/doctor');
const {
  cleanupFixture,
  makeFixture,
  parseStdoutJson,
  runCli,
} = require('./cli-helpers');

describe('CLI argument contract', () => {
  it('rejects --session-pid without a value before scanning', () => {
    const result = runCli(['--session-pid']);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1);
    assert.match(output, /--session-pid must be a positive integer/);
    assert.doesNotMatch(output, /scanning for zombie processes/);
  });

  it('rejects non-numeric --session-pid values', () => {
    const result = runCli(['--session-pid=abc']);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1);
    assert.match(output, /--session-pid must be a positive integer/);
  });

  it('lists report in help output', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /zclean history \[--json\]\s+Show cleanup history/);
    assert.match(result.stdout, /zclean protect list \[--json\]\s+Show protected whitelist entries/);
    assert.match(result.stdout, /zclean doctor \[--json\]\s+Check if zclean is properly set up/);
    assert.match(result.stdout, /zclean report \[--json\] Show AI runtime hygiene report/);
    assert.match(result.stdout, /zclean audit \[--json\]\s+Alias for report/);
    assert.match(result.stdout, /zclean cache \[--json\]\s+Show safe workspace cache candidates/);
  });

  it('prints report JSON as a read-only runtime hygiene report', () => {
    const result = runCli(['report', '--json']);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.profile.tool, 'zclean');
    assert.equal(report.profile.focus, 'ai-coding-runtime-hygiene');
    assert.equal(report.profile.localOnly, true);
    assert.equal(report.profile.telemetry, false);
    assert.equal(report.safety.cleanupRequiresYes, true);
    assert.equal(typeof report.candidates.count, 'number');
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(report.recommendations.some((item) => item.includes('zclean report --json')));
    assert.equal(result.stderr, '');
  });

  it('prints audit JSON as a read-only runtime hygiene report', () => {
    const result = runCli(['audit', '--json']);
    assert.equal(result.status, 0);

    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.kind, 'ai-coding-runtime-hygiene');
    assert.equal(report.notGeneralCleaner, true);
    assert.match(report.differentiation, /does not uninstall apps/);
    assert.match(report.differentiation, /workspace cache/);
    assert.equal(report.proGradeReview.guardrails.localOnly, true);
    assert.equal(report.proGradeReview.guardrails.telemetry, false);
    assert.equal(report.proGradeReview.guardrails.cleanupRequiresYes, true);
    assert.equal(typeof report.summary.zombieCount, 'number');
    assert.ok(Array.isArray(report.recommendations));
    assert.equal(result.stderr, '');
  });
});

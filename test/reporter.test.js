'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { reportDryRun, reportKill } = require('../src/reporter');

function captureDryRun(candidates) {
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.join(' '));
  try {
    reportDryRun(candidates);
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function captureReport(callback) {
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.join(' '));
  try {
    callback();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('process report layout', () => {
  it('keeps long custom pattern names inside the fixed process column', () => {
    const name = `custom:${'x'.repeat(60)}`;
    const output = captureReport(() => reportKill({
      killed: [{ pid: 1000, name, mem: 1024 }],
      failed: [],
      skipped: [],
      warning: null,
    }));

    assert.match(output, /custom:xxxxxx\.\.\./);
    assert.doesNotMatch(output, new RegExp(name));
  });

  it('removes ANSI and OSC control sequences from process output', () => {
    const output = captureReport(() => reportKill({
      killed: [],
      failed: [{
        pid: 1001,
        name: 'agent-worker',
        error: '\u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007 \u001b[31mfailed\u001b[0m',
      }],
      skipped: [],
      warning: null,
    }));

    assert.doesNotMatch(output, /\u001b|\u0007|example\.invalid/);
    assert.match(output, /click failed/);
  });

  it('shows sanitized classification metadata without custom literals', () => {
    const name = `custom:${'x'.repeat(60)}`;
    const candidates = [{
      pid: 1000,
      name,
      cmd: 'node /Users/example/private/worker.js --token=secret',
      mem: 1024,
      age: 1000,
      reason: `pattern:${name}, orphan:parent-gone`,
      provider: 'custom',
      classification: 'unattributed',
      confidence: { score: 40, level: 'low' },
      evidence: [`runtime-pattern:${name}`, 'provider:custom', 'orphan:parent-gone'],
      cleanupEligible: false,
      blockedReasons: ['provider-pattern-not-strong', 'age-grace-not-met'],
    }];
    const output = captureDryRun(candidates);

    assert.match(output, /custom\s+unattributed/);
    assert.match(output, /confidence:\s+low \(40\/100\)/);
    assert.match(output, /runtime-pattern:custom/);
    assert.doesNotMatch(output, new RegExp(name));
    assert.doesNotMatch(output, /Users\/example|token=secret|worker\.js/);
  });

  it('does not print command lines, diagnostic payloads, paths, or tokens', () => {
    const candidates = [{
      pid: 1001,
      name: 'custom:agent-worker',
      cmd: 'node /Users/example/private/\u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007 \u001b[31mworker\u001b[0m --api-key=secret',
      mem: 1024,
      age: 1000,
      reason: 'path:/Users/example/private, token:secret',
      provider: 'custom',
      classification: 'unattributed',
      confidence: { score: 40, level: 'low' },
      evidence: ['runtime-pattern:custom:agent-worker', 'provider:custom', 'path:/Users/example/private'],
      cleanupEligible: false,
      blockedReasons: ['provider-pattern-not-strong'],
    }];
    candidates.warnings = [{
      code: 'provider-warning',
      message: '\u001b[31m/Users/example/private --token=untrusted\u001b[0m',
    }];
    const output = captureDryRun(candidates);

    assert.doesNotMatch(output, /\u001b|\u0007/);
    assert.doesNotMatch(output, /click|worker|Users\/example|api-key|token=|untrusted/);
    assert.match(output, /provider-warning: process scan diagnostic/);
    assert.match(output, /runtime-pattern:custom/);
  });

  it('offers cleanup only when at least one candidate is eligible', () => {
    const base = {
      pid: 1002,
      name: 'codex-exec',
      mem: 1024,
      age: 7200000,
      provider: 'codex',
      confidence: { score: 100, level: 'high' },
      evidence: [
        'runtime-pattern:codex-exec',
        'provider:codex',
        'provider-pattern:codex-exec',
        'orphan:parent-gone',
        'age-grace-met',
        'start-time:verified',
      ],
    };
    const blockedOutput = captureDryRun([{
      ...base,
      classification: 'suspected',
      cleanupEligible: false,
      blockedReasons: ['start-time-unverified'],
    }]);
    const eligibleOutput = captureDryRun([{
      ...base,
      classification: 'confirmed-stale',
      cleanupEligible: true,
      blockedReasons: [],
    }]);

    assert.doesNotMatch(blockedOutput, /zclean --yes/);
    assert.match(eligibleOutput, /zclean --yes/);
  });
});

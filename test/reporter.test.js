'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { reportDryRun } = require('../src/reporter');

describe('process report layout', () => {
  it('keeps long custom pattern names inside the fixed process column', () => {
    const name = `custom:${'x'.repeat(60)}`;
    const candidates = [{
      pid: 1000,
      name,
      cmd: 'node worker.js',
      mem: 1024,
      age: 1000,
      reason: `pattern:${name}, orphan:parent-gone`,
    }];
    const lines = [];
    const original = console.log;
    console.log = (...values) => lines.push(values.join(' '));
    try {
      reportDryRun(candidates);
    } finally {
      console.log = original;
    }

    const processLine = lines.find((line) => line.includes('PID'));
    assert.match(processLine, /custom:xxxxxx\.\.\./);
    assert.doesNotMatch(processLine, new RegExp(name));
  });

  it('removes ANSI and OSC control sequences from process output', () => {
    const candidates = [{
      pid: 1001,
      name: 'custom:agent-worker',
      cmd: 'node \u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007 \u001b[31mworker\u001b[0m',
      mem: 1024,
      age: 1000,
      reason: 'pattern:custom:agent-worker, orphan:parent-gone',
    }];
    candidates.warnings = [{
      code: 'provider-warning',
      message: '\u001b[31muntrusted diagnostic\u001b[0m',
    }];
    const lines = [];
    const original = console.log;
    console.log = (...values) => lines.push(values.join(' '));
    try {
      reportDryRun(candidates);
    } finally {
      console.log = original;
    }

    const output = lines.join('\n');
    assert.doesNotMatch(output, /\u001b|\u0007/);
    assert.match(output, /click worker/);
    assert.match(output, /untrusted diagnostic/);
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cleanupFixture, makeFixture, parseStdoutJson, runCli } = require('./cli-helpers');

const SAFE_HISTORY_ENTRY_KEYS = new Set([
  'action',
  'errors',
  'failed',
  'found',
  'killed',
  'skipped',
  'timestamp',
  'totalMemFreed',
]);

describe('CLI history and protect contracts', () => {
  it('prints history JSON from the isolated history log', () => {
    const fixture = makeFixture();
    const dryRunAt = new Date(Date.now() - 60_000).toISOString();
    const scanAt = new Date(Date.now() - 30_000).toISOString();
    const cleanupAt = new Date().toISOString();

    try {
      fs.writeFileSync(
        path.join(fixture.configDir, 'history.jsonl'),
        [
          JSON.stringify({ timestamp: dryRunAt, action: 'dry-run', found: 2 }),
          JSON.stringify({ timestamp: scanAt, action: 'scan', found: 0 }),
          JSON.stringify({ timestamp: scanAt, action: 'scan-failed', errors: 1 }),
          JSON.stringify({
            timestamp: cleanupAt,
            action: 'cleanup-summary',
            killed: 2,
            failed: 1,
            skipped: 0,
            totalMemFreed: 1048576,
          }),
        ].join('\n') + '\n',
        'utf-8'
      );

      const result = runCli(['history', '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);

      const history = parseStdoutJson(result);
      assert.equal(history.schemaVersion, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(history, 'logFile'), false);
      assert.deepEqual(history.entries.map((entry) => entry.action), [
        'dry-run',
        'scan',
        'scan-failed',
        'cleanup-summary',
      ]);
      assert.equal(history.entries[0].timestamp, dryRunAt);
      assert.equal(history.summary.dryRuns, 1);
      assert.equal(history.summary.scans, 1);
      assert.equal(history.summary.scanFailures, 1);
      assert.equal(history.summary.cleanupSummaries, 1);
      assert.equal(history.summary.failedKills, 1);
      assert.equal(history.summary.totalKilled, 2);
      assert.equal(history.summary.totalMemFreed, 1048576);
      assert.equal(history.summary.weekKilled, 2);
      assert.equal(history.summary.weekMemFreed, 1048576);
      assert.equal(history.summary.lastRun, cleanupAt);
      assert.equal(result.stderr, '');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('omits raw command and local path fields from history JSON entries', () => {
    const fixture = makeFixture();
    const privatePath = path.join(fixture.home, 'private-project', 'server.js');

    try {
      fs.writeFileSync(
        path.join(fixture.configDir, 'history.jsonl'),
        [
          JSON.stringify({
            timestamp: '2026-06-30T00:00:00.000Z',
            action: 'dry-run',
            found: 1,
            command: `node ${privatePath}`,
            cwd: path.dirname(privatePath),
          }),
          JSON.stringify({
            timestamp: '2026-06-30T00:01:00.000Z',
            action: 'kill-failed',
            pid: 123,
            error: `permission denied: ${privatePath}`,
          }),
        ].join('\n') + '\n',
        'utf-8'
      );

      const result = runCli(['history', '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);

      const history = parseStdoutJson(result);
      assert.equal(JSON.stringify(history).includes(privatePath), false);
      for (const entry of history.entries) {
        assert.deepEqual(
          Object.keys(entry).filter((key) => !SAFE_HISTORY_ENTRY_KEYS.has(key)),
          []
        );
      }
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('prints empty history JSON when no history log exists', () => {
    const result = runCli(['history', '--json']);
    assert.equal(result.status, 0, result.stderr);

    const history = parseStdoutJson(result);
    assert.equal(history.schemaVersion, 1);
    assert.deepEqual(history.entries, []);
    assert.equal(history.summary.totalKilled, 0);
    assert.equal(history.summary.totalMemFreed, 0);
    assert.equal(history.summary.dryRuns, 0);
    assert.equal(result.stderr, '');
  });

});

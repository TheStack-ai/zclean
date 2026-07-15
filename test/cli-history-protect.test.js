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

  it('protect add/list/remove manages whitelist strings in config', () => {
    const fixture = makeFixture();

    try {
      let result = runCli(['protect', 'add', 'keep-me'], { fixture });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /keep-me/);

      result = runCli(['protect', 'list', '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);
      const list = parseStdoutJson(result);
      assert.equal(list.schemaVersion, 1);
      assert.equal(Object.prototype.hasOwnProperty.call(list, 'configFile'), false);
      assert.deepEqual(list.whitelist, ['keep-me']);

      const savedConfig = JSON.parse(fs.readFileSync(path.join(fixture.configDir, 'config.json'), 'utf-8'));
      assert.deepEqual(savedConfig.whitelist, ['keep-me']);
      assert.ok(savedConfig.whitelist.every((entry) => typeof entry === 'string'));

      result = runCli(['protect', 'remove', '--index=1'], { fixture });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Removed/);

      result = runCli(['protect', 'list', '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(parseStdoutJson(result).whitelist, []);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('redacts local paths and embedded credentials from protect list JSON', () => {
    const fixture = makeFixture();
    const privateEntry = '/Users/alice/private-project/token=super-secret';

    try {
      fs.writeFileSync(
        path.join(fixture.configDir, 'config.json'),
        JSON.stringify({ whitelist: [privateEntry, 'OPENAI_API_KEY=openai-secret'] }),
        'utf8'
      );

      const result = runCli(['protect', 'list', '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);
      const serialized = JSON.stringify(parseStdoutJson(result));
      assert.equal(serialized.includes('/Users/alice/private-project'), false);
      assert.equal(serialized.includes('super-secret'), false);
      assert.equal(serialized.includes('openai-secret'), false);
      assert.match(serialized, /\[local-path\]|\[redacted\]/);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('protect add only persists the whitelist change in a minimal existing config', () => {
    const fixture = makeFixture();

    try {
      fs.writeFileSync(
        path.join(fixture.configDir, 'config.json'),
        JSON.stringify({ whitelist: ['old-entry'], customNote: 'keep-this' }, null, 2) + '\n',
        'utf-8'
      );

      const result = runCli(['protect', 'add', 'new-entry'], { fixture });
      assert.equal(result.status, 0, result.stderr);

      const savedConfig = JSON.parse(fs.readFileSync(path.join(fixture.configDir, 'config.json'), 'utf-8'));
      assert.deepEqual(savedConfig, {
        whitelist: ['old-entry', 'new-entry'],
        customNote: 'keep-this',
      });
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('does not overwrite a concurrent config update when the safety re-read fails', () => {
    const fixture = makeFixture();
    const configFile = path.join(fixture.configDir, 'config.json');
    const preload = path.join(fixture.root, 'fail-second-config-read.cjs');
    const concurrentConfig = JSON.stringify({
      whitelist: ['current-entry'],
      concurrentValue: 'preserve-me',
    }, null, 2) + '\n';

    try {
      fs.writeFileSync(configFile, JSON.stringify({ whitelist: ['stale-entry'] }, null, 2) + '\n');
      fs.writeFileSync(preload, [
        "'use strict';",
        "const fs = require('node:fs');",
        'const originalRead = fs.readFileSync;',
        'let descriptorReads = 0;',
        'fs.readFileSync = function injectedRead(target, ...args) {',
        "  if (typeof target === 'number' && ++descriptorReads === 2) {",
        "    fs.writeFileSync(process.env.ZCLEAN_RACE_CONFIG, Buffer.from(process.env.ZCLEAN_RACE_BYTES, 'base64'));",
        "    const error = new Error('injected config re-read failure');",
        "    error.code = 'EIO';",
        '    throw error;',
        '  }',
        '  return originalRead.call(this, target, ...args);',
        '};',
      ].join('\n'));
      fixture.env.NODE_OPTIONS = `--require=${preload}`;
      fixture.env.ZCLEAN_RACE_CONFIG = configFile;
      fixture.env.ZCLEAN_RACE_BYTES = Buffer.from(concurrentConfig).toString('base64');

      const result = runCli(['protect', 'add', 'new-entry'], { fixture });

      assert.equal(result.status, 1);
      assert.match(`${result.stdout}\n${result.stderr}`, /could not reload|no changes were written/i);
      assert.equal(fs.readFileSync(configFile, 'utf8'), concurrentConfig);
      assert.doesNotMatch(result.stdout, /Protected:/);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('protect add rejects duplicate and empty entries', () => {
    const fixture = makeFixture();

    try {
      const first = runCli(['protect', 'add', 'keep-me'], { fixture });
      assert.equal(first.status, 0, first.stderr);

      const duplicate = runCli(['protect', 'add', 'keep-me'], { fixture });
      assert.equal(duplicate.status, 1);
      assert.match(`${duplicate.stdout}\n${duplicate.stderr}`, /already protected|duplicate/i);

      const empty = runCli(['protect', 'add', ''], { fixture });
      assert.equal(empty.status, 1);
      assert.match(`${empty.stdout}\n${empty.stderr}`, /empty|required/i);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('protect remove rejects out-of-range indexes', () => {
    const fixture = makeFixture();

    try {
      const add = runCli(['protect', 'add', 'keep-me'], { fixture });
      assert.equal(add.status, 0, add.stderr);

      const result = runCli(['protect', 'remove', '--index=2'], { fixture });
      assert.equal(result.status, 1);
      assert.match(`${result.stdout}\n${result.stderr}`, /out of range|invalid/i);
    } finally {
      cleanupFixture(fixture);
    }
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG } = require('../src/config');
const { runDoctor } = require('../src/doctor');
const { generatePlist } = require('../src/installer/launchd');
const { cleanupFixture, makeFixture, parseStdoutJson, runCli } = require('./cli-helpers');

const LOCAL_ZCLEAN_JS = path.resolve(__dirname, '..', 'bin', 'zclean.js');

describe('CLI doctor contract', () => {
  it('labels an old cleanup as informational instead of a scheduler failure', () => {
    const fixture = makeFixture();
    let output = '';

    try {
      const report = runDoctor(DEFAULT_CONFIG, {
        scan: () => [],
        now: () => '2026-07-15T00:00:00.000Z',
        stats: { lastRun: '2026-06-15T00:00:00.000Z' },
        runtime: {
          platform: 'linux',
          homedir: fixture.home,
          execSync: () => '',
        },
        write: (chunk) => { output += chunk; },
      });
      const lastCleanup = report.checks.find((check) => check.id === 'last-run');

      assert.equal(lastCleanup.status, 'ok');
      assert.match(output, /Last cleanup:/);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('prints doctor JSON with structured check results', () => {
    const result = runCli(['doctor', '--json']);
    assert.ok(result.status === 0 || result.status === 1, `unexpected status ${result.status}`);

    const report = parseStdoutJson(result);
    assert.equal(report.schemaVersion, 1);
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(['ok', 'warning', 'error'].includes(report.overallStatus));
    assert.equal(typeof report.issueCount, 'number');
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.checks.some((check) => check.id === 'process-scan'));
    assert.equal(typeof report.stats.totalKilled, 'number');
  });

  it('doctor JSON omits scheduler local filesystem paths', () => {
    const fixture = makeFixture();
    let output = '';

    try {
      const report = runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        now: () => '2026-06-30T00:00:00.000Z',
        runtime: {
          platform: 'linux',
          homedir: fixture.home,
          execSync: () => {
            throw new Error('not installed');
          },
        },
        write: (chunk) => {
          output += chunk;
        },
      });

      const parsed = JSON.parse(output);
      const scheduler = parsed.checks.find((check) => check.id === 'scheduler');
      assert.equal(JSON.stringify(parsed).includes(fixture.home), false);
      assert.equal(scheduler.details?.path, undefined);
      assert.equal(report.checks.find((check) => check.id === 'scheduler').details?.path, undefined);
      assert.equal(parsed.checks.find((check) => check.id === 'config').details?.path, undefined);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('doctor JSON reports process enumeration failure as error', () => {
    const fixture = makeFixture();
    const originalConfigDir = process.env.ZCLEAN_CONFIG_DIR;
    const failedScan = [];
    failedScan.errors = [{ code: 'process-list-failed', message: 'ps failed' }];
    let output = '';

    try {
      process.env.ZCLEAN_CONFIG_DIR = fixture.configDir;
      const report = runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => failedScan,
        now: () => '2026-06-30T00:00:00.000Z',
        stats: {
          totalKilled: 0,
          totalMemFreed: 0,
          weekKilled: 0,
          weekMemFreed: 0,
          lastRun: null,
        },
        runtime: {
          platform: 'linux',
          homedir: fixture.home,
          execSync: () => {
            throw new Error('not installed');
          },
        },
        write: (chunk) => {
          output += chunk;
        },
      });

      const parsed = JSON.parse(output);
      assert.equal(report.overallStatus, 'error');
      assert.equal(report.exitCode, 1);
      assert.equal(parsed.overallStatus, 'error');
      assert.equal(parsed.checks.find((check) => check.id === 'process-scan').status, 'error');
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.ZCLEAN_CONFIG_DIR;
      } else {
        process.env.ZCLEAN_CONFIG_DIR = originalConfigDir;
      }
      cleanupFixture(fixture);
    }
  });

  it('redacts process diagnostic paths and secrets from doctor JSON', () => {
    const fixture = makeFixture();
    const failedScan = [];
    failedScan.errors = [{
      code: 'process-list-failed',
      provider: 'ps',
      message: 'failed /Users/example/private/project --token=secret-value',
    }];
    let output = '';

    try {
      runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => failedScan,
        stats: {},
        runtime: { platform: 'linux', homedir: fixture.home, execSync: () => '' },
        write: (chunk) => { output += chunk; },
      });

      assert.equal(output.includes('/Users/example/private/project'), false);
      assert.equal(output.includes('secret-value'), false);
      assert.match(output, /\[local-path\]/);
      assert.match(output, /\[redacted\]/);
    } finally {
      cleanupFixture(fixture);
    }
  });

  for (const item of [
    {
      name: 'macOS launchd',
      platform: 'darwin',
      file: ['Library', 'LaunchAgents', 'com.zclean.hourly.plist'],
      content: generatePlist(LOCAL_ZCLEAN_JS),
    },
    { name: 'Windows Task Scheduler', platform: 'win32' },
  ]) {
    it(`distinguishes ${item.name} query failures from a missing scheduler`, () => {
      const fixture = makeFixture();
      let output = '';
      try {
        if (item.file) {
          const file = path.join(fixture.home, ...item.file);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, item.content);
        }
        const error = new Error('EACCES: denied at /Users/alice/private/token=secret-value');
        error.code = 'EACCES';

        runDoctor(DEFAULT_CONFIG, {
          json: true,
          scan: () => [],
          stats: {},
          runtime: {
            platform: item.platform,
            homedir: fixture.home,
            execSync: () => { throw error; },
          },
          write: (chunk) => { output += chunk; },
        });

        const scheduler = JSON.parse(output).checks.find((check) => check.id === 'scheduler');
        assert.equal(scheduler.status, 'warning');
        assert.match(scheduler.message, /inspection failed.*EACCES/i);
        assert.doesNotMatch(scheduler.message, /not installed|secret-value|\/Users\/alice/);
        assert.equal(scheduler.details.causeCode, 'EACCES');
      } finally {
        cleanupFixture(fixture);
      }
    });
  }
});

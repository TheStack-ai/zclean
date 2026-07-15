'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../src/config');
const { runDoctor } = require('../src/doctor');
const { generatePlist } = require('../src/installer/launchd');
const { generateService } = require('../src/installer/systemd');
const { formatTaskRunCommand } = require('../src/installer/taskscheduler');
const { cleanupFixture, makeFixture, parseStdoutJson, runCli } = require('./cli-helpers');

describe('CLI doctor contract', () => {
  it('treats provider hook absence as healthy and optional', () => {
    const fixture = makeFixture();
    let output = '';
    try {
      const report = runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: {
          platform: 'linux',
          homedir: fixture.home,
          execSync: () => '',
        },
        write: (chunk) => { output += chunk; },
      });
      const hook = JSON.parse(output).checks.find((check) => check.id === 'hook');

      assert.equal(hook.status, 'ok');
      assert.match(hook.message, /optional|not required/i);
      assert.equal(report.checks.find((check) => check.id === 'hook').status, 'ok');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('warns only when the exact legacy Claude Stop hook remains', () => {
    const fixture = makeFixture();
    let output = '';
    try {
      const settingsPath = require('node:path').join(fixture.home, '.claude', 'settings.json');
      require('node:fs').mkdirSync(require('node:path').dirname(settingsPath), { recursive: true });
      require('node:fs').writeFileSync(settingsPath, JSON.stringify({
        hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: '/usr/local/bin/zclean --yes --session-pid=$PPID' }] }] },
      }));
      runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: { platform: 'linux', homedir: fixture.home, execSync: () => '' },
        write: (chunk) => { output += chunk; },
      });

      const hook = JSON.parse(output).checks.find((check) => check.id === 'hook');
      assert.equal(hook.status, 'warning');
      assert.match(hook.message, /legacy Claude Stop hook/i);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('warns when optional provider settings cannot be inspected safely', () => {
    const fixture = makeFixture();
    let output = '';
    try {
      const settingsPath = require('node:path').join(fixture.home, '.claude', 'settings.json');
      require('node:fs').mkdirSync(require('node:path').dirname(settingsPath), { recursive: true });
      require('node:fs').writeFileSync(settingsPath, '{ invalid json');

      runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: { platform: 'linux', homedir: fixture.home, execSync: () => '' },
        write: (chunk) => { output += chunk; },
      });

      const hook = JSON.parse(output).checks.find((check) => check.id === 'hook');
      assert.equal(hook.status, 'warning');
      assert.match(hook.message, /unreadable|inspect/i);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('warns when an installed scheduler still contains automatic cleanup', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const cases = [
      {
        platform: 'darwin',
        file: ['Library', 'LaunchAgents', 'com.zclean.hourly.plist'],
        content: '<string>/usr/local/bin/zclean</string><string>--yes</string>',
        execSync: () => 'com.zclean.hourly',
      },
      {
        platform: 'linux',
        file: ['.config', 'systemd', 'user', 'zclean.timer'],
        service: ['.config', 'systemd', 'user', 'zclean.service'],
        content: '[Timer]\nOnCalendar=hourly\n',
        serviceContent: '[Service]\nExecStart=/usr/local/bin/zclean --yes\n',
        execSync: () => '',
      },
      {
        platform: 'win32',
        execSync: () => 'Task To Run: C:\\tools\\zclean.cmd --yes',
      },
    ];

    for (const item of cases) {
      const fixture = makeFixture();
      let output = '';
      try {
        if (item.file) {
          const file = path.join(fixture.home, ...item.file);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, item.content);
        }
        if (item.service) {
          fs.writeFileSync(path.join(fixture.home, ...item.service), item.serviceContent);
        }

        runDoctor(DEFAULT_CONFIG, {
          json: true,
          scan: () => [],
          stats: {},
          runtime: {
            platform: item.platform,
            homedir: fixture.home,
            execSync: item.execSync,
          },
          write: (chunk) => { output += chunk; },
        });

        const scheduler = JSON.parse(output).checks.find((check) => check.id === 'scheduler');
        assert.equal(scheduler.status, 'warning', item.platform);
        assert.match(scheduler.message, /unsafe|report-only|zclean init/i, item.platform);
      } finally {
        cleanupFixture(fixture);
      }
    }
  });

  it('accepts generated report-only scheduler definitions on every platform', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const bin = process.platform === 'win32'
      ? 'C:\\Program Files\\zclean\\zclean.cmd'
      : '/usr/local/bin/zclean';
    const cases = [
      {
        platform: 'darwin',
        file: ['Library', 'LaunchAgents', 'com.zclean.hourly.plist'],
        content: generatePlist(bin),
        execSync: () => 'com.zclean.hourly',
      },
      {
        platform: 'linux',
        file: ['.config', 'systemd', 'user', 'zclean.timer'],
        service: ['.config', 'systemd', 'user', 'zclean.service'],
        content: '[Timer]\nOnCalendar=hourly\n',
        serviceContent: generateService(bin),
        execSync: () => '',
      },
      {
        platform: 'win32',
        execSync: () => `Task To Run: ${formatTaskRunCommand(bin)}`,
      },
    ];

    for (const item of cases) {
      const fixture = makeFixture();
      let output = '';
      try {
        if (item.file) {
          const file = path.join(fixture.home, ...item.file);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, item.content);
        }
        if (item.service) fs.writeFileSync(path.join(fixture.home, ...item.service), item.serviceContent);

        runDoctor(DEFAULT_CONFIG, {
          json: true,
          scan: () => [],
          stats: {},
          runtime: {
            platform: item.platform,
            homedir: fixture.home,
            execSync: item.execSync,
          },
          write: (chunk) => { output += chunk; },
        });

        const scheduler = JSON.parse(output).checks.find((check) => check.id === 'scheduler');
        assert.equal(scheduler.status, 'ok', item.platform);
      } finally {
        cleanupFixture(fixture);
      }
    }
  });

  it('rejects scheduler commands that only contain the audit and JSON tokens out of order', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const cases = [
      {
        platform: 'darwin',
        file: ['Library', 'LaunchAgents', 'com.zclean.hourly.plist'],
        content: [
          '<plist><dict><key>ProgramArguments</key><array>',
          '<string>/usr/local/bin/zclean</string>',
          '<string>cache</string>',
          '<string>--json</string>',
          '<string>audit</string>',
          '</array></dict></plist>',
        ].join(''),
        execSync: () => 'com.zclean.hourly',
      },
      {
        platform: 'linux',
        file: ['.config', 'systemd', 'user', 'zclean.timer'],
        service: ['.config', 'systemd', 'user', 'zclean.service'],
        content: '[Timer]\nOnCalendar=hourly\n',
        serviceContent: '[Service]\nExecStart=/usr/local/bin/zclean cache --json audit\n',
        execSync: () => '',
      },
      {
        platform: 'win32',
        execSync: () => 'Task To Run: C:\\tools\\zclean.cmd cache --json audit',
      },
    ];

    for (const item of cases) {
      const fixture = makeFixture();
      let output = '';
      try {
        if (item.file) {
          const file = path.join(fixture.home, ...item.file);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, item.content);
        }
        if (item.service) fs.writeFileSync(path.join(fixture.home, ...item.service), item.serviceContent);

        runDoctor(DEFAULT_CONFIG, {
          json: true,
          scan: () => [],
          stats: {},
          runtime: {
            platform: item.platform,
            homedir: fixture.home,
            execSync: item.execSync,
          },
          write: (chunk) => { output += chunk; },
        });

        const scheduler = JSON.parse(output).checks.find((check) => check.id === 'scheduler');
        assert.equal(scheduler.status, 'warning', item.platform);
      } finally {
        cleanupFixture(fixture);
      }
    }
  });

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
      assert.doesNotMatch(lastCleanup.message, /scheduler/i);
      assert.match(output, /Last cleanup:/);
      assert.doesNotMatch(output, /Last run:/);
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
});

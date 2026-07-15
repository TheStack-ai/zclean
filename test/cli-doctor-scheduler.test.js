'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../src/config');
const { runDoctor } = require('../src/doctor');
const { generatePlist } = require('../src/installer/launchd');
const { generateService } = require('../src/installer/systemd');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

const LOCAL_ZCLEAN_JS = path.resolve(__dirname, '..', 'bin', 'zclean.js');

describe('CLI doctor scheduler contract', () => {
  it('warns when an installed scheduler still contains automatic cleanup', () => {
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
        execSync: () => [
          '<Task><Actions><Exec>',
          '<Command>C:\\tools\\zclean.cmd</Command>',
          '<Arguments>--yes</Arguments>',
          '</Exec></Actions></Task>',
        ].join(''),
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

  for (const item of [
    {
      name: 'macOS',
      platform: 'darwin',
      file: ['Library', 'LaunchAgents', 'com.zclean.hourly.plist'],
      content: generatePlist(LOCAL_ZCLEAN_JS),
      execSync: () => 'com.zclean.hourly',
    },
    {
      name: 'Linux',
      platform: 'linux',
      file: ['.config', 'systemd', 'user', 'zclean.timer'],
      service: ['.config', 'systemd', 'user', 'zclean.service'],
      content: '[Timer]\nOnCalendar=hourly\n',
      serviceContent: generateService(LOCAL_ZCLEAN_JS),
      execSync: (command) => command.includes(' show ')
        ? `argv[]=${LOCAL_ZCLEAN_JS} audit --json ;`
        : 'active',
    },
  ]) {
    it(`accepts a generated ${item.name} scheduler using local bin/zclean.js`, () => {
      const fixture = makeFixture();
      let output = '';
      try {
        const file = path.join(fixture.home, ...item.file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, item.content);
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
        assert.equal(scheduler.status, 'ok');
      } finally {
        cleanupFixture(fixture);
      }
    });
  }

  it('accepts generated report-only scheduler definitions on every platform', () => {
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
        execSync: (command) => command.includes(' show ')
          ? `argv[]=${bin} audit --json ;`
          : 'active',
      },
      {
        platform: 'win32',
        execSync: () => [
          '<Task><Actions><Exec>',
          `<Command>${bin}</Command>`,
          '<Arguments>audit --json</Arguments>',
          '</Exec></Actions></Task>',
        ].join(''),
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
        execSync: () => [
          '<Task><Actions><Exec>',
          '<Command>C:\\tools\\zclean.cmd</Command>',
          '<Arguments>cache --json audit</Arguments>',
          '</Exec></Actions></Task>',
        ].join(''),
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

});

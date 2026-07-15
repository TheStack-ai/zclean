'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const systemd = require('../src/installer/systemd');
const taskScheduler = require('../src/installer/taskscheduler');
const { inspectSchedulerDefinition } = require('../src/doctor/scheduler-definition');
const { buildDoctorReport } = require('../src/doctor/checks');
const { DEFAULT_CONFIG } = require('../src/config');

describe('scheduler migration safety', () => {
  it('preserves systemd files when the existing timer cannot be stopped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-install-stop-'));
    const servicePath = path.join(root, 'zclean.service');
    const timerPath = path.join(root, 'zclean.timer');
    const oldService = '[Service]\nExecStart=/usr/bin/zclean --yes\n';
    fs.writeFileSync(servicePath, oldService);
    fs.writeFileSync(timerPath, '[Timer]\nOnCalendar=hourly\n');
    const calls = [];

    try {
      const result = systemd.installSystemd({
        platform: 'linux',
        servicePath,
        timerPath,
        binPath: '/usr/local/bin/zclean',
        execFileSync(command, args) {
          calls.push([command, args]);
          throw new Error('Failed to connect to bus: Permission denied');
        },
      });

      assert.equal(result.installed, false);
      assert.equal(result.active, false);
      assert.deepEqual(calls[0], [
        'systemctl',
        ['--user', 'disable', '--now', 'zclean.timer'],
      ]);
      assert.equal(fs.readFileSync(servicePath, 'utf8'), oldService);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops systemd before writing and enabling the read-only definition', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-install-order-'));
    const servicePath = path.join(root, 'zclean.service');
    const timerPath = path.join(root, 'zclean.timer');
    fs.writeFileSync(servicePath, '[Service]\nExecStart=/usr/bin/zclean --yes\n');
    fs.writeFileSync(timerPath, '[Timer]\nOnCalendar=hourly\n');
    const calls = [];

    try {
      const result = systemd.installSystemd({
        platform: 'linux',
        servicePath,
        timerPath,
        binPath: '/usr/local/bin/zclean',
        execFileSync(command, args) {
          calls.push([command, args]);
          if (args.includes('daemon-reload')) {
            const written = fs.readFileSync(servicePath, 'utf8');
            assert.match(written, /audit --json/);
            assert.doesNotMatch(written, /--yes/);
          }
          return '';
        },
      });

      assert.equal(result.active, true);
      assert.deepEqual(calls.map((call) => call[1]), [
        ['--user', 'disable', '--now', 'zclean.timer'],
        ['--user', 'daemon-reload'],
        ['--user', 'enable', '--now', 'zclean.timer'],
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not replace a Windows task when the old task cannot be removed', () => {
    const calls = [];
    const result = taskScheduler.installTaskScheduler({
      platform: 'win32',
      binPath: 'C:\\Tools\\zclean.cmd',
      execFileSync(command, args) {
        calls.push([command, args]);
        throw new Error('ERROR: Access is denied.');
      },
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      'schtasks',
      ['/delete', '/TN', taskScheduler.TASK_NAME, '/F'],
    ]);
  });

  it('removes an old Windows task before creating the report-only task', () => {
    const calls = [];
    const result = taskScheduler.installTaskScheduler({
      platform: 'win32',
      binPath: 'C:\\Tools\\zclean.cmd',
      execFileSync(command, args) {
        calls.push([command, args]);
        return '';
      },
    });

    assert.equal(result.active, true);
    assert.deepEqual(calls[0][1], ['/delete', '/TN', taskScheduler.TASK_NAME, '/F']);
    assert.equal(calls[1][1][0], '/create');
    assert.doesNotMatch(calls[1][1].join(' '), /--yes/);
  });
});

describe('scheduler definition inspection', () => {
  it('requires the zclean executable as well as exact audit arguments', () => {
    const wrongLinux = '[Service]\nExecStart=/usr/bin/other audit --json\n';
    const wrongWindows = [
      'Task To Run: C:\\Tools\\other.exe audit --json',
      'Comment: C:\\Tools\\zclean.cmd audit --json',
    ].join('\r\n');

    assert.equal(inspectSchedulerDefinition(wrongLinux, 'linux').safe, false);
    assert.equal(inspectSchedulerDefinition(wrongWindows, 'win32').safe, false);
  });

  it('reads the Windows task command from XML instead of arbitrary list rows', () => {
    const xml = [
      '<Task><Actions><Exec>',
      '<Command>C:\\Program Files\\zclean.cmd</Command>',
      '<Arguments>audit --json</Arguments>',
      '</Exec></Actions></Task>',
    ].join('');

    assert.equal(inspectSchedulerDefinition(xml, 'win32').safe, true);
  });

  it('doctor rejects an unsafe loaded systemd command even when disk files are safe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-loaded-state-'));
    const home = path.join(root, 'home');
    const configDir = path.join(root, 'config');
    const unitDir = path.join(home, '.config', 'systemd', 'user');
    const originalConfigDir = process.env.ZCLEAN_CONFIG_DIR;
    fs.mkdirSync(unitDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(DEFAULT_CONFIG));
    fs.writeFileSync(path.join(unitDir, 'zclean.service'), systemd.generateService('/usr/local/bin/zclean'));
    fs.writeFileSync(path.join(unitDir, 'zclean.timer'), systemd.generateTimer());
    process.env.ZCLEAN_CONFIG_DIR = configDir;

    try {
      const report = buildDoctorReport(DEFAULT_CONFIG, {
        scan: () => [],
        stats: {},
        runtime: {
          platform: 'linux',
          homedir: home,
          execSync(command) {
            if (command.includes(' show ')) return 'argv[]=/usr/local/bin/zclean --yes ;';
            return 'active';
          },
        },
      });
      const scheduler = report.checks.find((check) => check.id === 'scheduler');
      assert.equal(scheduler.status, 'warning');
      assert.match(scheduler.message, /unsafe|report-only|zclean init/i);
    } finally {
      if (originalConfigDir === undefined) delete process.env.ZCLEAN_CONFIG_DIR;
      else process.env.ZCLEAN_CONFIG_DIR = originalConfigDir;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

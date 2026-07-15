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
  it('replaces systemd files after the existing timer cannot be stopped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-install-stop-'));
    const servicePath = path.join(root, 'zclean.service');
    const timerPath = path.join(root, 'zclean.timer');
    const binPath = '/usr/local/bin/zclean';
    fs.writeFileSync(servicePath, '[Service]\nExecStart=/usr/bin/zclean --yes\n');
    fs.writeFileSync(timerPath, '[Timer]\nOnCalendar=hourly\n');
    const calls = [];

    try {
      const result = systemd.installSystemd({
        platform: 'linux',
        servicePath,
        timerPath,
        binPath,
        execFileSync(command, args) {
          calls.push([command, args]);
          if (args.includes('disable')) {
            throw new Error('Failed to connect to bus: Permission denied');
          }
          if (args.includes('daemon-reload')) {
            const writtenService = fs.readFileSync(servicePath, 'utf8');
            assert.deepEqual(inspectSchedulerDefinition(writtenService, 'linux'), { safe: true });
            assert.match(writtenService, /ExecStart=\/usr\/local\/bin\/zclean audit --json/);
          }
          if (args.includes('show')) return `argv[]=${binPath} audit --json ;`;
          return '';
        },
      });

      assert.equal(result.installed, true);
      assert.equal(result.active, true);
      assert.match(result.message, /stop failed.*replaced.*verified/i);
      assert.deepEqual(calls, [
        ['systemctl', ['--user', 'disable', '--now', 'zclean.timer']],
        ['systemctl', ['--user', 'daemon-reload']],
        ['systemctl', ['--user', 'enable', '--now', 'zclean.timer']],
        ['systemctl', [
          '--user',
          'show',
          'zclean.service',
          '--property=ExecCondition,ExecStartPre,ExecStart,ExecStartPost,ExecReload,ExecStop,ExecStopPost',
          '--value',
        ]],
      ]);
      const service = fs.readFileSync(servicePath, 'utf8');
      assert.deepEqual(inspectSchedulerDefinition(service, 'linux'), { safe: true });
      assert.match(fs.readFileSync(timerPath, 'utf8'), /OnCalendar=hourly/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports when systemd cannot activate the in-place replacement', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-install-failure-'));
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
          throw new Error(args.includes('disable') ? 'Access denied' : 'Daemon reload failed');
        },
      });

      assert.equal(result.installed, false);
      assert.equal(result.active, false);
      assert.match(result.message, /could not stop.*could not activate.*may still be active/i);
      assert.deepEqual(calls.map((call) => call[1]), [
        ['--user', 'disable', '--now', 'zclean.timer'],
        ['--user', 'daemon-reload'],
      ]);
      assert.deepEqual(inspectSchedulerDefinition(fs.readFileSync(servicePath, 'utf8'), 'linux'), { safe: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not report systemd success when the loaded command is destructive', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-install-unsafe-'));
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
          if (args.includes('disable')) throw new Error('Failed to connect to bus');
          if (args.includes('show')) return 'argv[]=/usr/bin/zclean --yes ;';
          return '';
        },
      });

      assert.equal(result.installed, false);
      assert.equal(result.active, false);
      assert.match(result.message, /could not be verified.*may still be active/i);
      assert.equal(calls.at(-1)[1][1], 'show');
      assert.deepEqual(inspectSchedulerDefinition(fs.readFileSync(servicePath, 'utf8'), 'linux'), { safe: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('replaces a Windows task after the old task cannot be deleted', () => {
    const calls = [];
    const binPath = 'C:\\Tools\\zclean.cmd';
    const result = taskScheduler.installTaskScheduler({
      platform: 'win32',
      binPath,
      execFileSync(command, args) {
        calls.push([command, args]);
        if (args[0] === '/delete') throw new Error('ERROR: Access is denied.');
        if (args[0] === '/query') return windowsTaskXml(binPath);
        return '';
      },
    });

    assert.equal(result.installed, true);
    assert.equal(result.active, true);
    assert.match(result.message, /delete failed.*replaced.*verified/i);
    assert.deepEqual(calls, [
      ['schtasks', ['/delete', '/TN', taskScheduler.TASK_NAME, '/F']],
      ['schtasks', taskScheduler.buildCreateTaskArgs(binPath)],
      ['schtasks', ['/query', '/TN', taskScheduler.TASK_NAME, '/XML']],
    ]);
    assert.deepEqual(inspectSchedulerDefinition(windowsTaskXml(binPath), 'win32'), { safe: true });
  });

  it('reports when Windows in-place replacement fails after delete failure', () => {
    const calls = [];
    const result = taskScheduler.installTaskScheduler({
      platform: 'win32',
      binPath: 'C:\\Tools\\zclean.cmd',
      execFileSync(command, args) {
        calls.push([command, args]);
        throw new Error(args[0] === '/delete' ? 'ERROR: Access is denied.' : 'ERROR: Create failed.');
      },
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.match(result.message, /delete failed.*replacement failed.*may still run/i);
    assert.deepEqual(calls.map((call) => call[1][0]), ['/delete', '/create']);
  });

  it('does not report Windows success when the resulting command is destructive', () => {
    const calls = [];
    const result = taskScheduler.installTaskScheduler({
      platform: 'win32',
      binPath: 'C:\\Tools\\zclean.cmd',
      execFileSync(command, args) {
        calls.push([command, args]);
        if (args[0] === '/delete') throw new Error('ERROR: Access is denied.');
        if (args[0] === '/query') return windowsTaskXml('C:\\Tools\\zclean.cmd', '--yes');
        return '';
      },
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.match(result.message, /could not be verified.*may still run/i);
    assert.deepEqual(calls.map((call) => call[1][0]), ['/delete', '/create', '/query']);
  });

});

function windowsTaskXml(binPath, args = 'audit --json') {
  return `<Task><Actions><Exec><Command>${binPath}</Command><Arguments>${args}</Arguments></Exec></Actions></Task>`;
}

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

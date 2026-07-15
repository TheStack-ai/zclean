'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const launchd = require('../src/installer/launchd');
const systemd = require('../src/installer/systemd');
const taskScheduler = require('../src/installer/taskscheduler');
const scheduler = require('../src/commands/scheduler');
const packageJson = require('../package.json');
const { LOCAL_BIN_HINT } = require('../src/installer/bin-path');

describe('installer persistent commands', () => {
  it('uses the unscoped package identity in public install guidance', () => {
    assert.equal(packageJson.name, 'z-clean');
    assert.match(LOCAL_BIN_HINT, /npm install -g z-clean/);
  });

  it('launchd uses a local executable as one ProgramArgument', () => {
    const plist = launchd.generatePlist('/usr/local/bin/zclean');
    assert.match(plist, /<string>\/usr\/local\/bin\/zclean<\/string>/);
    assert.match(plist, /<string>audit<\/string>/);
    assert.match(plist, /<string>--json<\/string>/);
    assert.doesNotMatch(plist, /--yes/);
    assert.doesNotMatch(plist, /npx/);
  });

  it('escapes launchd paths and always quotes the Windows task executable', () => {
    const plist = launchd.generatePlist('/tmp/zclean&tool', { homedir: '/tmp/home&unsafe' });
    assert.match(plist, /zclean&amp;tool/);
    assert.match(plist, /home&amp;unsafe/);
    assert.doesNotMatch(plist, /<string>\/tmp\/home&unsafe/);

    const task = taskScheduler.formatTaskRunCommand('C:\\Users\\dev\\bin&calc\\zclean.cmd');
    assert.equal(task, '"C:\\Users\\dev\\bin&calc\\zclean.cmd" audit --json');
  });

  it('does not overwrite the plist while an old launchd job cannot be stopped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-launchd-migration-'));
    const plistPath = path.join(root, 'com.zclean.hourly.plist');
    const oldPlist = '<plist><string>--yes</string></plist>';
    fs.writeFileSync(plistPath, oldPlist);

    const result = launchd.installLaunchd({
      platform: 'darwin',
      homedir: root,
      plistPath,
      uid: 501,
      binPath: '/usr/local/bin/zclean',
      execFileSync(command, args) {
        assert.equal(command, 'launchctl');
        if (args[0] === 'print') return 'ProgramArguments = { --yes }';
        throw new Error('bootout failed');
      },
    });

    assert.equal(result.active, false);
    assert.match(result.message, /could not stop|still loaded|preserved/i);
    assert.equal(fs.readFileSync(plistPath, 'utf8'), oldPlist);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('Windows Task Scheduler uses argument arrays and quotes local paths with spaces', () => {
    const args = taskScheduler.buildCreateTaskArgs('C:\\Program Files\\nodejs\\zclean.cmd');
    assert.deepEqual(args.slice(0, 5), ['/create', '/TN', taskScheduler.TASK_NAME, '/SC', 'HOURLY']);
    assert.equal(args[5], '/TR');
    assert.equal(args[6], '"C:\\Program Files\\nodejs\\zclean.cmd" audit --json');
    assert.equal(args[7], '/F');
    assert.doesNotMatch(args.join(' '), /--yes/);
    assert.doesNotMatch(args.join(' '), /@thestackai\/zclean/);
  });

  it('systemd uses a local executable and quotes paths with spaces', () => {
    const service = systemd.generateService('/home/me/tools/z clean');
    assert.match(service, /^ExecStart="\/home\/me\/tools\/z clean" audit --json$/m);
    assert.doesNotMatch(service, /--yes/);
    assert.doesNotMatch(service, /npx/);
  });

  it('does not label a written but inactive scheduler as active', () => {
    assert.equal(scheduler.getSchedulerState({ installed: true, active: true }), 'ACTIVE');
    assert.equal(scheduler.getSchedulerState({ installed: true, active: false }), 'WARNING');
    assert.equal(scheduler.getSchedulerState({ installed: false }), 'WARNING');
  });

  it('handles uninstall on unsupported platforms without throwing', () => {
    const original = console.log;
    console.log = () => {};
    try {
      assert.doesNotThrow(() => scheduler.uninstallScheduler('freebsd'));
    } finally {
      console.log = original;
    }
  });

  it('does not report removal while the launchd service is still loaded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-launchd-remove-'));
    const plistPath = path.join(root, 'com.zclean.hourly.plist');
    fs.writeFileSync(plistPath, '<plist/>');

    const result = launchd.removeLaunchd({
      platform: 'darwin',
      plistPath,
      uid: 501,
      execFileSync(command, args) {
        assert.equal(command, 'launchctl');
        if (args[0] === 'print') return '';
        throw new Error('bootout failed');
      },
    });

    assert.equal(result.removed, false);
    assert.equal(result.failed, true);
    assert.match(result.message, /still loaded/i);
    assert.equal(fs.existsSync(plistPath), true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('unloads the launchd service even when the plist is already missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-launchd-missing-plist-'));
    const plistPath = path.join(root, 'com.zclean.hourly.plist');
    const calls = [];

    const result = launchd.removeLaunchd({
      platform: 'darwin',
      plistPath,
      uid: 501,
      execFileSync(command, args) {
        calls.push([command, args]);
        return '';
      },
    });

    assert.equal(result.removed, true);
    assert.deepEqual(calls[0], ['launchctl', ['bootout', 'gui/501/com.zclean.hourly']]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports already uninstalled when neither service nor plist exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-launchd-absent-'));
    const result = launchd.removeLaunchd({
      platform: 'darwin',
      plistPath: path.join(root, 'com.zclean.hourly.plist'),
      uid: 501,
      execFileSync() {
        throw new Error('Could not find service "com.zclean.hourly" in domain for user');
      },
    });

    assert.equal(result.removed, false);
    assert.equal(result.failed, false);
    assert.match(result.message, /already uninstalled/i);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('preserves the plist when launchd service state cannot be verified', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-launchd-unknown-'));
    const plistPath = path.join(root, 'com.zclean.hourly.plist');
    fs.writeFileSync(plistPath, '<plist/>');

    const result = launchd.removeLaunchd({
      platform: 'darwin',
      plistPath,
      uid: 501,
      execFileSync() {
        throw new Error('launchctl IPC permission denied');
      },
    });

    assert.equal(result.removed, false);
    assert.equal(result.failed, true);
    assert.match(result.message, /could not verify/i);
    assert.equal(fs.existsSync(plistPath), true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('propagates scheduler removal failures to the command caller', () => {
    const original = console.log;
    const originalExitCode = process.exitCode;
    console.log = () => {};
    try {
      process.exitCode = undefined;
      const result = scheduler.uninstallScheduler('darwin', {
        remove() {
          return { removed: false, failed: true, message: 'Could not verify launchd service removal.' };
        },
      });
      assert.equal(result.failed, true);
      assert.equal(process.exitCode, 1);
    } finally {
      console.log = original;
      process.exitCode = originalExitCode;
    }
  });

  it('preserves systemd unit files when disable fails operationally', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-failure-'));
    const servicePath = path.join(root, 'zclean-hourly.service');
    const timerPath = path.join(root, 'zclean-hourly.timer');
    fs.writeFileSync(servicePath, '[Service]');
    fs.writeFileSync(timerPath, '[Timer]');

    const result = systemd.removeSystemd({
      platform: 'linux',
      servicePath,
      timerPath,
      execFileSync() {
        throw new Error('Failed to connect to bus: Permission denied');
      },
    });

    assert.equal(result.failed, true);
    assert.equal(fs.existsSync(servicePath), true);
    assert.equal(fs.existsSync(timerPath), true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('distinguishes a missing systemd unit from an operational failure', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-systemd-absent-'));
    const result = systemd.removeSystemd({
      platform: 'linux',
      servicePath: path.join(root, 'zclean-hourly.service'),
      timerPath: path.join(root, 'zclean-hourly.timer'),
      execFileSync() {
        throw new Error('Unit zclean-hourly.timer does not exist.');
      },
    });

    assert.equal(result.removed, false);
    assert.equal(result.failed, false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('treats Windows access denied as a scheduler removal failure', () => {
    const result = taskScheduler.removeTaskScheduler({
      platform: 'win32',
      execFileSync() {
        throw new Error('ERROR: Access is denied.');
      },
    });

    assert.equal(result.removed, false);
    assert.equal(result.failed, true);
  });

  it('treats a missing Windows task as already uninstalled', () => {
    const result = taskScheduler.removeTaskScheduler({
      platform: 'win32',
      execFileSync() {
        throw new Error('ERROR: The specified task name does not exist in the system.');
      },
    });

    assert.equal(result.removed, false);
    assert.equal(result.failed, false);
  });
});

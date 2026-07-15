'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');

const launchd = require('../src/installer/launchd');
const systemd = require('../src/installer/systemd');
const taskScheduler = require('../src/installer/taskscheduler');
const { inspectSchedulerDefinition } = require('../src/doctor/scheduler-definition');

describe('scheduler destination write boundaries', () => {
  it('keeps a launchd symlink target byte-identical', (t) => {
    const root = createFixture(t, 'zclean-launchd-symlink-');
    const targetPath = path.join(root, 'plist-target');
    const plistPath = path.join(root, 'LaunchAgents', 'com.zclean.hourly.plist');
    const original = Buffer.from('launchd-symlink-sentinel\0', 'utf8');
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(targetPath, original);
    if (!createFileSymlink(t, targetPath, plistPath)) return;
    const calls = [];

    const result = launchd.installLaunchd({
      platform: 'darwin',
      homedir: root,
      plistPath,
      uid: 501,
      binPath: '/usr/local/bin/zclean',
      execFileSync: fakeService(calls),
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.deepEqual(fs.readFileSync(targetPath), original);
    assert.equal(fs.lstatSync(plistPath).isSymbolicLink(), true);
    assert.equal(calls.some((call) => call.args[0] === 'bootstrap'), false);
  });

  for (const destination of ['service', 'timer']) {
    it(`keeps a systemd ${destination} symlink target byte-identical`, (t) => {
      const root = createFixture(t, `zclean-systemd-${destination}-symlink-`);
      const servicePath = path.join(root, 'zclean.service');
      const timerPath = path.join(root, 'zclean.timer');
      const destinationPath = destination === 'service' ? servicePath : timerPath;
      const targetPath = path.join(root, `${destination}-target`);
      const original = Buffer.from(`systemd-${destination}-symlink-sentinel\0`, 'utf8');
      fs.writeFileSync(targetPath, original);
      if (!createFileSymlink(t, targetPath, destinationPath)) return;
      const calls = [];

      const result = systemd.installSystemd({
        platform: 'linux',
        servicePath,
        timerPath,
        binPath: '/usr/local/bin/zclean',
        execFileSync: fakeService(calls),
      });

      assert.equal(result.installed, false);
      assert.equal(result.active, false);
      assert.deepEqual(fs.readFileSync(targetPath), original);
      assert.equal(fs.lstatSync(destinationPath).isSymbolicLink(), true);
      assert.equal(calls.some((call) => call.args.includes('daemon-reload')), false);
    });
  }

  it('rejects a non-regular launchd destination without throwing', (t) => {
    const root = createFixture(t, 'zclean-launchd-directory-');
    const plistPath = path.join(root, 'LaunchAgents', 'com.zclean.hourly.plist');
    fs.mkdirSync(plistPath, { recursive: true });
    const calls = [];

    const result = launchd.installLaunchd({
      platform: 'darwin',
      homedir: root,
      plistPath,
      uid: 501,
      binPath: '/usr/local/bin/zclean',
      execFileSync: fakeService(calls),
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.equal(fs.statSync(plistPath).isDirectory(), true);
    assert.equal(calls.some((call) => call.args[0] === 'bootstrap'), false);
  });

  it('rejects a non-regular systemd destination', (t) => {
    const root = createFixture(t, 'zclean-systemd-directory-');
    const servicePath = path.join(root, 'zclean.service');
    const timerPath = path.join(root, 'zclean.timer');
    fs.mkdirSync(servicePath);
    const calls = [];

    const result = systemd.installSystemd({
      platform: 'linux',
      servicePath,
      timerPath,
      binPath: '/usr/local/bin/zclean',
      execFileSync: fakeService(calls),
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.equal(fs.statSync(servicePath).isDirectory(), true);
    assert.equal(calls.some((call) => call.args.includes('daemon-reload')), false);
  });
});

describe('loaded scheduler action cardinality', () => {
  it('rejects loaded systemd state with audit plus a destructive action', (t) => {
    const root = createFixture(t, 'zclean-systemd-actions-');
    const calls = [];
    const loaded = [
      'argv[]=/usr/local/bin/zclean audit --json ;',
      'argv[]=/usr/local/bin/zclean --yes ;',
    ].join(' ');

    const result = systemd.installSystemd({
      platform: 'linux',
      servicePath: path.join(root, 'zclean.service'),
      timerPath: path.join(root, 'zclean.timer'),
      binPath: '/usr/local/bin/zclean',
      execFileSync: fakeService(calls, loaded),
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.equal(calls.filter((call) => call.args.includes('show')).length, 1);
  });

  it('rejects a loaded Windows task with audit plus a destructive action', () => {
    const calls = [];
    const definition = [
      '<Task><Actions>',
      '<Exec><Command>C:\\Tools\\zclean.cmd</Command><Arguments>audit --json</Arguments></Exec>',
      '<Exec><Command>C:\\Tools\\zclean.cmd</Command><Arguments>--yes</Arguments></Exec>',
      '</Actions></Task>',
    ].join('');

    const result = taskScheduler.installTaskScheduler({
      platform: 'win32',
      binPath: 'C:\\Tools\\zclean.cmd',
      execFileSync: fakeService(calls, definition),
    });

    assert.equal(result.installed, false);
    assert.equal(result.active, false);
    assert.equal(calls.filter((call) => call.args[0] === '/query').length, 1);
  });
});

describe('doctor scheduler action cardinality', () => {
  it('rejects loaded systemd state with two report-only actions', () => {
    const definition = [
      'argv[]=/usr/local/bin/zclean audit --json ;',
      'argv[]=/usr/local/bin/zclean audit --json ;',
    ].join(' ');

    const result = inspectSchedulerDefinition(definition, 'linux');

    assert.equal(result.safe, false);
  });

  it('rejects a Windows task with two report-only actions', () => {
    const definition = [
      '<Task><Actions>',
      '<Exec><Command>C:\\Tools\\zclean.cmd</Command><Arguments>audit --json</Arguments></Exec>',
      '<Exec><Command>C:\\Tools\\zclean.cmd</Command><Arguments>audit --json</Arguments></Exec>',
      '</Actions></Task>',
    ].join('');

    const result = inspectSchedulerDefinition(definition, 'win32');

    assert.equal(result.safe, false);
  });
});

function createFixture(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createFileSymlink(t, targetPath, destinationPath) {
  try {
    fs.symlinkSync(targetPath, destinationPath, 'file');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error.code)) {
      t.skip(`file symlinks unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function fakeService(calls, definition = 'argv[]=/usr/local/bin/zclean audit --json ;') {
  return (command, args) => {
    calls.push({ command, args });
    if (args.includes('show') || args[0] === '/query') return definition;
    return '';
  };
}

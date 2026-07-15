'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const launchd = require('../src/installer/launchd');
const systemd = require('../src/installer/systemd');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('scheduler parent directory boundary', () => {
  it('does not write a launchd plist through a parent directory symlink', (t) => {
    const fixture = makeFixture();
    try {
      const outside = path.join(fixture.root, 'outside-launchd');
      const launchAgents = path.join(fixture.home, 'Library', 'LaunchAgents');
      const plistPath = path.join(launchAgents, 'com.zclean.hourly.plist');
      const outsidePlist = path.join(outside, 'com.zclean.hourly.plist');
      fs.mkdirSync(path.dirname(launchAgents), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(outsidePlist, 'launchd-sentinel');
      if (!createDirectorySymlink(t, outside, launchAgents)) return;

      const result = launchd.installLaunchd({
        platform: 'darwin',
        homedir: fixture.home,
        plistPath,
        uid: 501,
        binPath: '/usr/local/bin/zclean',
        execFileSync: () => '',
      });

      assert.equal(result.installed, false);
      assert.equal(fs.readFileSync(outsidePlist, 'utf8'), 'launchd-sentinel');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('does not write systemd units through a parent directory symlink', (t) => {
    const fixture = makeFixture();
    try {
      const outside = path.join(fixture.root, 'outside-systemd');
      const unitDirectory = path.join(fixture.home, '.config', 'systemd', 'user');
      const servicePath = path.join(unitDirectory, 'zclean.service');
      const timerPath = path.join(unitDirectory, 'zclean.timer');
      const outsideService = path.join(outside, 'zclean.service');
      const outsideTimer = path.join(outside, 'zclean.timer');
      fs.mkdirSync(path.dirname(unitDirectory), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(outsideService, 'service-sentinel');
      fs.writeFileSync(outsideTimer, 'timer-sentinel');
      if (!createDirectorySymlink(t, outside, unitDirectory)) return;

      const result = systemd.installSystemd({
        platform: 'linux',
        servicePath,
        timerPath,
        binPath: '/usr/local/bin/zclean',
        execFileSync: () => '',
      });

      assert.equal(result.installed, false);
      assert.equal(fs.readFileSync(outsideService, 'utf8'), 'service-sentinel');
      assert.equal(fs.readFileSync(outsideTimer, 'utf8'), 'timer-sentinel');
    } finally {
      cleanupFixture(fixture);
    }
  });
});

function createDirectorySymlink(t, target, destination) {
  try {
    fs.symlinkSync(target, destination, 'dir');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error.code)) {
      t.skip(`directory symlinks unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

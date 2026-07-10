'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const hook = require('../src/installer/hook');
const launchd = require('../src/installer/launchd');
const systemd = require('../src/installer/systemd');
const taskScheduler = require('../src/installer/taskscheduler');
const packageJson = require('../package.json');
const { LOCAL_BIN_HINT } = require('../src/installer/bin-path');

describe('installer persistent commands', () => {
  it('uses the unscoped package identity in public install guidance', () => {
    assert.equal(packageJson.name, 'z-clean');
    assert.match(LOCAL_BIN_HINT, /npm install -g z-clean/);
    assert.doesNotMatch(LOCAL_BIN_HINT, /@thestackai\/zclean/);
  });

  it('shows a persistent install before init in the terminal demo', () => {
    const demo = fs.readFileSync(path.join(__dirname, '..', 'assets', 'demo.cast'), 'utf8');
    assert.match(demo, /npm install -g z-clean/);
    assert.match(demo, /zclean init/);
    assert.doesNotMatch(demo, /npx(?: --yes)? z-clean init/);
  });

  it('launchd uses a local executable as one ProgramArgument', () => {
    const plist = launchd.generatePlist('/usr/local/bin/zclean');
    assert.match(plist, /<string>\/usr\/local\/bin\/zclean<\/string>/);
    assert.match(plist, /<string>--yes<\/string>/);
    assert.doesNotMatch(plist, /npx/);
  });

  it('Windows Task Scheduler uses argument arrays and quotes local paths with spaces', () => {
    const args = taskScheduler.buildCreateTaskArgs('C:\\Program Files\\nodejs\\zclean.cmd');
    assert.deepEqual(args.slice(0, 5), ['/create', '/TN', taskScheduler.TASK_NAME, '/SC', 'HOURLY']);
    assert.equal(args[5], '/TR');
    assert.equal(args[6], '"C:\\Program Files\\nodejs\\zclean.cmd" --yes');
    assert.equal(args[7], '/F');
    assert.doesNotMatch(args.join(' '), /@thestackai\/zclean/);
  });

  it('systemd uses a local executable and quotes paths with spaces', () => {
    const service = systemd.generateService('/home/me/tools/z clean');
    assert.match(service, /^ExecStart="\/home\/me\/tools\/z clean" --yes$/m);
    assert.doesNotMatch(service, /npx/);
  });

  it('Claude hook uses a local executable and preserves session PID expansion', () => {
    const command = hook.buildHookCommand('/usr/local/bin/zclean');
    assert.equal(command, '/usr/local/bin/zclean --yes --session-pid=$PPID');
    assert.doesNotMatch(command, /npx/);
  });
});

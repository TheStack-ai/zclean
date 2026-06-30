'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const hook = require('../src/installer/hook');
const launchd = require('../src/installer/launchd');
const systemd = require('../src/installer/systemd');
const taskScheduler = require('../src/installer/taskscheduler');

describe('installer persistent commands', () => {
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

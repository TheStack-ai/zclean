'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSchedulerDefinition } = require('../src/doctor/scheduler-definition');

describe('scheduler definition safety', () => {
  it('rejects a launchd Program that disagrees with report-only ProgramArguments', () => {
    const plist = [
      '<plist><dict>',
      '<key>Program</key><string>/tmp/untrusted-runner</string>',
      '<key>ProgramArguments</key><array>',
      '<string>/usr/local/bin/zclean</string>',
      '<string>audit</string>',
      '<string>--json</string>',
      '</array>',
      '</dict></plist>',
    ].join('');

    const inspection = inspectSchedulerDefinition(plist, 'darwin');

    assert.equal(inspection.safe, false);
    assert.match(inspection.reason, /executable|contract|verified/i);
  });
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { checkScheduler } = require('../src/doctor/scheduler-check');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

it('warns when launchd values match only after trimming', () => {
  const exact = [
    '<key>ProgramArguments</key><array>',
    '<string>/usr/local/bin/zclean</string><string>audit</string><string>--json</string>',
    '</array>',
  ].join('');
  const definitions = [
    exact.replace('ProgramArguments', ' ProgramArguments '),
    exact.replace('/usr/local/bin/zclean', '/usr/local/bin/zclean '),
    exact.replace('/usr/local/bin/zclean', ' /usr/local/bin/zclean'),
    exact.replace('<string>audit</string>', '<string> audit </string>'),
    [
      '<key>Program</key><string> /usr/local/bin/zclean</string>',
      exact.replace('/usr/local/bin/zclean', ' /usr/local/bin/zclean'),
    ].join(''),
  ];

  for (const definition of definitions) {
    const fixture = makeFixture();
    try {
      const file = path.join(
        fixture.home,
        'Library',
        'LaunchAgents',
        'com.zclean.hourly.plist'
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '<plist><dict>' + definition + '</dict></plist>');

      const scheduler = checkScheduler({
        platform: 'darwin',
        homedir: fixture.home,
        execSync: () => 'com.zclean.hourly',
      });

      assert.equal(scheduler.status, 'warning', definition);
    } finally {
      cleanupFixture(fixture);
    }
  }
});

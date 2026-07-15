'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { inspectSchedulerDefinition } = require('../src/doctor/scheduler-definition');

describe('scheduler definition safety', () => {
  it('accepts exact report-only values encoded with numeric XML references', () => {
    for (const encodedKey of ['Program&#65;rguments', 'Program&#x41;rguments']) {
      const plist = [
        '<plist><dict>',
        `<key>${encodedKey}</key><array>`,
        '<string>/usr/local/bin/zclean</string><string>audit</string><string>--json</string>',
        '</array>',
        '</dict></plist>',
      ].join('');

      assert.deepEqual(inspectSchedulerDefinition(plist, 'darwin'), { safe: true }, encodedKey);
    }
  });

  it('rejects values that only match the launchd contract after trimming', () => {
    const exact = [
      '<key>ProgramArguments</key><array>',
      '<string>/usr/local/bin/zclean</string><string>audit</string><string>--json</string>',
      '</array>',
    ].join('');
    const definitions = [
      exact.replace('ProgramArguments', ' ProgramArguments '),
      exact.replace('/usr/local/bin/zclean', '/usr/local/bin/zclean '),
      exact.replace('<string>audit</string>', '<string> audit </string>'),
    ];

    for (const definition of definitions) {
      const inspection = inspectSchedulerDefinition(
        `<plist><dict>${definition}</dict></plist>`,
        'darwin'
      );
      assert.equal(inspection.safe, false, definition);
    }
  });

  it('rejects a launchd Program that disagrees with report-only ProgramArguments', () => {
    const programValues = [
      '<key>Program</key><string>/tmp/untrusted-runner</string>',
      '<key>Program</key><!-- gap --><string>/tmp/untrusted-runner</string>',
      '<key>Program</key><?gap ok?><string>/tmp/untrusted-runner</string>',
      '<key>Program</key><string data-x="1">/tmp/untrusted-runner</string>',
    ];

    for (const programValue of programValues) {
      const plist = [
        '<plist><dict>',
        programValue,
        '<key>ProgramArguments</key><array>',
        '<string>/usr/local/bin/zclean</string>',
        '<string>audit</string>',
        '<string>--json</string>',
        '</array>',
        '</dict></plist>',
      ].join('');

      const inspection = inspectSchedulerDefinition(plist, 'darwin');

      assert.equal(inspection.safe, false, programValue);
      assert.match(inspection.reason, /executable|contract|verified|keys/i, programValue);
    }
  });

  it('rejects duplicate launchd ProgramArguments blocks', () => {
    const safe = [
      '<key>ProgramArguments</key><array>',
      '<string>/usr/local/bin/zclean</string><string>audit</string><string>--json</string>',
      '</array>',
    ].join('');
    const definitions = [
      safe + [
        '<key>ProgramArguments</key><array>',
        '<string>/usr/local/bin/zclean</string><string>uninstall</string><string>--json</string>',
        '</array>',
      ].join(''),
      safe.replace('</array>', '<integer>7</integer></array>'),
      `<key>EnvironmentVariables</key><dict>${safe}</dict>`,
      safe.replace('ProgramArguments', 'programarguments'),
      `<!-- ${safe} -->`,
      `<key>Note</key><string><![CDATA[${safe}]]></string>`,
    ];

    for (const definition of definitions) {
      const inspection = inspectSchedulerDefinition(
        `<plist><dict>${definition}</dict></plist>`,
        'darwin'
      );

      assert.equal(inspection.safe, false, definition);
      assert.match(inspection.reason, /contract|verified|keys/i, definition);
    }
  });

  it('rejects XML-equivalent duplicate launchd ProgramArguments blocks', () => {
    for (const encodedKey of ['Program&#65;rguments', '<![CDATA[ProgramArguments]]>']) {
      const plist = [
        '<plist><dict>',
        '<key>ProgramArguments</key><array>',
        '<string>/usr/local/bin/zclean</string><string>audit</string><string>--json</string>',
        '</array>',
        `<key>${encodedKey}</key><array>`,
        '<string>/usr/local/bin/zclean</string><string>uninstall</string><string>--json</string>',
        '</array>',
        '</dict></plist>',
      ].join('');

      const inspection = inspectSchedulerDefinition(plist, 'darwin');

      assert.equal(inspection.safe, false, encodedKey);
      assert.match(inspection.reason, /contract|verified/i, encodedKey);
    }
  });

  it('rejects an XML-equivalent launchd Program mismatch', () => {
    for (const encodedKey of ['Progr&#97;m', '<![CDATA[Program]]>']) {
      const plist = [
        '<plist><dict>',
        `<key>${encodedKey}</key><string>/tmp/untrusted-runner</string>`,
        '<key>ProgramArguments</key><array>',
        '<string>/usr/local/bin/zclean</string><string>audit</string><string>--json</string>',
        '</array>',
        '</dict></plist>',
      ].join('');

      const inspection = inspectSchedulerDefinition(plist, 'darwin');

      assert.equal(inspection.safe, false, encodedKey);
      assert.match(inspection.reason, /executable|contract|verified/i, encodedKey);
    }
  });
});

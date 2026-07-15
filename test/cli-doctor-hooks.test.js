'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../src/config');
const { runDoctor } = require('../src/doctor');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('CLI doctor provider hook contract', () => {
  it('treats provider hook absence as healthy and optional', () => {
    const fixture = makeFixture();
    let output = '';
    try {
      const report = runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: {
          platform: 'linux',
          homedir: fixture.home,
          execSync: () => '',
        },
        write: (chunk) => { output += chunk; },
      });
      const hook = JSON.parse(output).checks.find((check) => check.id === 'hook');

      assert.equal(hook.status, 'ok');
      assert.match(hook.message, /optional|not required/i);
      assert.equal(report.checks.find((check) => check.id === 'hook').status, 'ok');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('warns only when the exact legacy Claude Stop hook remains', () => {
    const fixture = makeFixture();
    let output = '';
    try {
      const settingsPath = require('node:path').join(fixture.home, '.claude', 'settings.json');
      require('node:fs').mkdirSync(require('node:path').dirname(settingsPath), { recursive: true });
      require('node:fs').writeFileSync(settingsPath, JSON.stringify({
        hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: '/usr/local/bin/zclean --yes --session-pid=$PPID' }] }] },
      }));
      runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: { platform: 'linux', homedir: fixture.home, execSync: () => '' },
        write: (chunk) => { output += chunk; },
      });

      const hook = JSON.parse(output).checks.find((check) => check.id === 'hook');
      assert.equal(hook.status, 'warning');
      assert.match(hook.message, /legacy Claude Stop hook/i);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('warns when optional provider settings cannot be inspected safely', () => {
    const fixture = makeFixture();
    let output = '';
    try {
      const settingsPath = require('node:path').join(fixture.home, '.claude', 'settings.json');
      require('node:fs').mkdirSync(require('node:path').dirname(settingsPath), { recursive: true });
      require('node:fs').writeFileSync(settingsPath, '{ invalid json');

      runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: { platform: 'linux', homedir: fixture.home, execSync: () => '' },
        write: (chunk) => { output += chunk; },
      });

      const hook = JSON.parse(output).checks.find((check) => check.id === 'hook');
      assert.equal(hook.status, 'warning');
      assert.match(hook.message, /unreadable|inspect/i);
    } finally {
      cleanupFixture(fixture);
    }
  });
});

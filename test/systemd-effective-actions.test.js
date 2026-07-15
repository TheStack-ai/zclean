'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG } = require('../src/config');
const { runDoctor } = require('../src/doctor');
const systemd = require('../src/installer/systemd');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('effective systemd action contract', () => {
  it('does not activate when a drop-in adds a post-start action', () => {
    const fixture = createSystemdFixture();
    try {
      const result = systemd.installSystemd({
        platform: 'linux',
        servicePath: fixture.servicePath,
        timerPath: fixture.timerPath,
        binPath: fixture.binPath,
        execFileSync(command, args) {
          if (command === 'systemctl' && args.includes('show')) {
            return requestedAllActions(args)
              ? loadedActions(fixture.binPath)
              : `argv[]=${fixture.binPath} audit --json ;`;
          }
          return '';
        },
      });

      assert.equal(result.installed, false);
      assert.equal(result.active, false);
      assert.equal(fs.existsSync(fixture.dropInPath), true);
    } finally {
      cleanupFixture(fixture.base);
    }
  });

  it('doctor warns when the effective unit has a post-start action', () => {
    const fixture = createSystemdFixture();
    let output = '';
    try {
      const report = runDoctor(DEFAULT_CONFIG, {
        json: true,
        scan: () => [],
        stats: {},
        runtime: {
          platform: 'linux',
          homedir: fixture.base.home,
          execSync(command) {
            if (command.includes(' show ')) {
              return command.includes('ExecStartPost')
                ? loadedActions(fixture.binPath)
                : `argv[]=${fixture.binPath} audit --json ;`;
            }
            if (command.includes(' is-active ')) return 'active';
            return '';
          },
        },
        write: (chunk) => { output += chunk; },
      });

      const scheduler = JSON.parse(output).checks.find((check) => check.id === 'scheduler');
      assert.equal(scheduler.status, 'warning');
      assert.equal(report.exitCode, 1);
    } finally {
      cleanupFixture(fixture.base);
    }
  });
});

function createSystemdFixture() {
  const base = makeFixture();
  const unitDirectory = path.join(base.home, '.config', 'systemd', 'user');
  const servicePath = path.join(unitDirectory, 'zclean.service');
  const timerPath = path.join(unitDirectory, 'zclean.timer');
  const dropInPath = path.join(unitDirectory, 'zclean.service.d', 'override.conf');
  const binPath = '/usr/local/bin/zclean';
  fs.mkdirSync(path.dirname(dropInPath), { recursive: true });
  fs.writeFileSync(servicePath, systemd.generateService(binPath));
  fs.writeFileSync(timerPath, systemd.generateTimer());
  fs.writeFileSync(dropInPath, `[Service]\nExecStartPost=${binPath} -y\n`);
  return { base, servicePath, timerPath, dropInPath, binPath };
}

function requestedAllActions(args) {
  return args.some((arg) => arg.startsWith('--property=') && arg.includes('ExecStartPost'));
}

function loadedActions(binPath) {
  return [
    `argv[]=${binPath} audit --json ;`,
    `argv[]=${binPath} -y ;`,
  ].join('\n');
}

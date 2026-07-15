'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_CONFIG } = require('../src/config');
const { runInit } = require('../src/commands/init');

describe('provider-neutral init command', () => {
  it('creates config and installs only the scheduler for a fresh Codex-only home', () => {
    withFixture(({ home, configDir }) => {
      const calls = [];
      const output = [];
      const result = runInit({
        config: DEFAULT_CONFIG,
        platform: 'darwin',
        inspectLegacy: () => ({ state: 'absent', message: 'not present' }),
        removeLegacy: () => {
          throw new Error('remove should not run');
        },
        installScheduler: () => {
          calls.push('scheduler');
          return { installed: true, active: true, message: 'active' };
        },
        write: (value) => output.push(value),
      });

      assert.equal(result.exitCode, 0);
      assert.deepEqual(calls, ['scheduler']);
      assert.equal(fs.existsSync(path.join(configDir, 'config.json')), true);
      assert.equal(fs.existsSync(path.join(home, '.claude')), false);
      assert.match(output.join('\n'), /02\s+SCHEDULER\s+ACTIVE/);
    });
  });

  it('removes an exact legacy hook before changing scheduler state', () => {
    withFixture(() => {
      const calls = [];
      const result = runInit({
        config: DEFAULT_CONFIG,
        platform: 'linux',
        inspectLegacy: () => ({ state: 'legacy', message: 'found' }),
        removeLegacy: () => {
          calls.push('remove');
          return { state: 'removed', message: 'removed' };
        },
        installScheduler: () => {
          calls.push('scheduler');
          return { installed: true, active: true, message: 'active' };
        },
        write: () => {},
      });

      assert.equal(result.exitCode, 0);
      assert.deepEqual(calls, ['remove', 'scheduler']);
      assert.equal(result.steps[1].label, 'CLAUDE LEGACY STOP');
      assert.equal(result.steps[1].state, 'REMOVED');
    });
  });

  it('stops before scheduler mutation when exact legacy removal fails', () => {
    withFixture(() => {
      let schedulerCalls = 0;
      const result = runInit({
        config: DEFAULT_CONFIG,
        platform: 'win32',
        inspectLegacy: () => ({ state: 'legacy', message: 'found' }),
        removeLegacy: () => ({ state: 'error', message: 'original preserved' }),
        installScheduler: () => {
          schedulerCalls += 1;
          return { installed: true, active: true };
        },
        write: () => {},
      });

      assert.equal(result.exitCode, 1);
      assert.equal(schedulerCalls, 0);
      assert.equal(result.steps[1].state, 'ERROR');
      assert.equal(result.steps[2].state, 'SKIPPED');
    });
  });

  it('leaves malformed optional Claude settings non-blocking', () => {
    withFixture(() => {
      let schedulerCalls = 0;
      const result = runInit({
        config: DEFAULT_CONFIG,
        platform: 'darwin',
        inspectLegacy: () => ({ state: 'invalid', message: 'left unchanged' }),
        removeLegacy: () => {
          throw new Error('remove should not run');
        },
        installScheduler: () => {
          schedulerCalls += 1;
          return { installed: true, active: true, message: 'active' };
        },
        write: () => {},
      });

      assert.equal(result.exitCode, 0);
      assert.equal(schedulerCalls, 1);
      assert.equal(result.steps[1].label, 'OPTIONAL CLAUDE SETTINGS');
      assert.equal(result.steps[1].state, 'WARNING');
    });
  });

  it('returns non-zero when the native scheduler is not active', () => {
    withFixture(() => {
      const result = runInit({
        config: DEFAULT_CONFIG,
        platform: 'linux',
        inspectLegacy: () => ({ state: 'unchanged', message: 'none' }),
        installScheduler: () => ({ installed: true, active: false, message: 'not active' }),
        write: () => {},
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.steps.at(-1).state, 'WARNING');
    });
  });
});

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-init-test-'));
  const home = path.join(root, 'home');
  const configDir = path.join(root, 'config');
  const previousHome = process.env.HOME;
  const previousConfigDir = process.env.ZCLEAN_CONFIG_DIR;
  const previousExitCode = process.exitCode;
  fs.mkdirSync(home, { recursive: true });

  try {
    process.env.HOME = home;
    process.env.ZCLEAN_CONFIG_DIR = configDir;
    process.exitCode = undefined;
    run({ root, home, configDir });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousConfigDir === undefined) delete process.env.ZCLEAN_CONFIG_DIR;
    else process.env.ZCLEAN_CONFIG_DIR = previousConfigDir;
    process.exitCode = previousExitCode;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

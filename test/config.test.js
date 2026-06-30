'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_CONFIG,
  appendLog,
  getConfigDir,
  getConfigFile,
  getLogFile,
  loadConfig,
  readLogs,
  saveConfig,
  summarizeHistory,
} = require('../src/config');

const originalConfigDir = process.env.ZCLEAN_CONFIG_DIR;

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.ZCLEAN_CONFIG_DIR;
  } else {
    process.env.ZCLEAN_CONFIG_DIR = originalConfigDir;
  }
});

describe('config storage', () => {
  it('includes documented customAiDirs in default config', () => {
    assert.deepEqual(DEFAULT_CONFIG.customAiDirs, []);
  });

  it('uses a temp config root under node --test when no explicit root is set', () => {
    delete process.env.ZCLEAN_CONFIG_DIR;
    assert.notEqual(getConfigDir(), path.join(os.homedir(), '.zclean'));
    assert.match(getConfigDir(), /zclean-node-test/);
  });

  it('can route config and log files to an explicit config root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-config-test-'));
    process.env.ZCLEAN_CONFIG_DIR = root;

    assert.equal(getConfigDir(), root);
    assert.equal(getConfigFile(), path.join(root, 'config.json'));
    assert.equal(getLogFile(), path.join(root, 'history.jsonl'));

    saveConfig({ ...DEFAULT_CONFIG, maxAge: '1h' });
    appendLog({ action: 'test-log', found: 1 });

    assert.equal(loadConfig().maxAge, '1h');
    assert.deepEqual(readLogs(1).map((entry) => entry.action), ['test-log']);
    assert.equal(fs.existsSync(path.join(root, 'config.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'history.jsonl')), true);
  });

  it('summarizes history actions for JSON command surfaces', () => {
    const summary = summarizeHistory(
      [
        { action: 'dry-run', found: 2 },
        { action: 'scan', found: 0 },
        { action: 'scan-failed', errors: 1 },
        { action: 'cleanup-summary', killed: 3, failed: 1, totalMemFreed: 2048 },
      ],
      {
        totalKilled: 3,
        totalMemFreed: 2048,
        weekKilled: 3,
        weekMemFreed: 2048,
        lastRun: '2026-06-30T00:00:00.000Z',
      }
    );

    assert.deepEqual(summary, {
      dryRuns: 1,
      scans: 1,
      scanFailures: 1,
      cleanupSummaries: 1,
      failedKills: 1,
      totalKilled: 3,
      totalMemFreed: 2048,
      weekKilled: 3,
      weekMemFreed: 2048,
      lastRun: '2026-06-30T00:00:00.000Z',
    });
  });
});

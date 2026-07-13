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
    assert.deepEqual(DEFAULT_CONFIG.customPatterns, []);
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

  it('falls back to the safe default when maxAge is invalid or zero', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-invalid-age-test-'));
    process.env.ZCLEAN_CONFIG_DIR = root;

    for (const maxAge of ['invalid', '0h']) {
      saveConfig({ ...DEFAULT_CONFIG, maxAge });
      assert.equal(loadConfig().maxAge, DEFAULT_CONFIG.maxAge);
    }
  });

  it('never persists command lines or arguments in history', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-history-test-'));
    process.env.ZCLEAN_CONFIG_DIR = root;

    appendLog({
      action: 'kill',
      pid: 1234,
      cmd: 'node agent.js --token=secret-value',
      command: 'node agent.js --api-key secret-value',
      args: ['--token', 'secret-value'],
    });

    const raw = fs.readFileSync(getLogFile(), 'utf-8');
    const [entry] = readLogs(1);
    assert.equal(raw.includes('secret-value'), false);
    assert.equal(Object.hasOwn(entry, 'cmd'), false);
    assert.equal(Object.hasOwn(entry, 'command'), false);
    assert.equal(Object.hasOwn(entry, 'args'), false);
  });

  it('migrates sensitive fields out of existing history', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-history-migration-'));
    process.env.ZCLEAN_CONFIG_DIR = root;
    fs.writeFileSync(
      getLogFile(),
      `${JSON.stringify({ action: 'kill', pid: 1234, cmd: 'node --token=old-secret' })}\n`,
      'utf-8'
    );

    loadConfig();

    const raw = fs.readFileSync(getLogFile(), 'utf-8');
    assert.equal(raw.includes('old-secret'), false);
    assert.equal(Object.hasOwn(JSON.parse(raw), 'cmd'), false);
  });

  it('hardens an existing config file to private permissions on Unix', { skip: process.platform === 'win32' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-existing-mode-test-'));
    process.env.ZCLEAN_CONFIG_DIR = root;
    fs.writeFileSync(getConfigFile(), JSON.stringify(DEFAULT_CONFIG), { mode: 0o644 });
    fs.chmodSync(getConfigFile(), 0o644);

    loadConfig();

    assert.equal(fs.statSync(getConfigFile()).mode & 0o777, 0o600);
  });

  it('uses private config and history permissions on Unix', { skip: process.platform === 'win32' }, () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-mode-test-')), 'private');
    process.env.ZCLEAN_CONFIG_DIR = root;

    saveConfig(DEFAULT_CONFIG);
    appendLog({ action: 'test-log' });

    const mode = (file) => fs.statSync(file).mode & 0o777;
    assert.equal(mode(root), 0o700);
    assert.equal(mode(getConfigFile()), 0o600);
    assert.equal(mode(getLogFile()), 0o600);
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

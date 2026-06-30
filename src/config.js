'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR_ENV = 'ZCLEAN_CONFIG_DIR';

function getConfigDir() {
  const configured = process.env[CONFIG_DIR_ENV];
  if (configured) return path.resolve(configured);
  if (process.env.NODE_TEST_CONTEXT) {
    return path.join(os.tmpdir(), 'zclean-node-test', String(process.pid));
  }
  return path.join(os.homedir(), '.zclean');
}

function getConfigFile() {
  return path.join(getConfigDir(), 'config.json');
}

function getLogFile() {
  return path.join(getConfigDir(), 'history.jsonl');
}

const DEFAULT_CONFIG = {
  whitelist: [],
  maxAge: '24h',
  memoryThreshold: '500MB',
  sigterm_timeout: 10,
  dryRunDefault: true,
  logRetention: '30d',
  maxKillBatch: 20,
  customAiDirs: [],
};

/**
 * Parse a duration string like "24h", "30d", "1h" into milliseconds.
 */
function parseDuration(str) {
  const match = String(str).match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

/**
 * Parse a memory string like "500MB", "1GB" into bytes.
 */
function parseMemory(str) {
  const match = String(str).match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  return Math.floor(value * multipliers[unit]);
}

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir() {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load config from disk, merging with defaults.
 */
function loadConfig() {
  ensureConfigDir();
  const configFile = getConfigFile();
  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      const userConfig = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch {
      // Corrupted config — use defaults
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save config to disk.
 */
function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(getConfigFile(), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Append a log entry to the history file.
 * Each entry is a JSON line with timestamp, action, and details.
 */
function appendLog(entry) {
  ensureConfigDir();
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(getLogFile(), line, 'utf-8');
}

/**
 * Read recent log entries (up to `limit`).
 */
function readLogs(limit = 50) {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return [];
  try {
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Prune logs older than logRetention.
 */
function pruneLogs(config) {
  const retentionMs = parseDuration(config.logRetention || '30d');
  const logFile = getLogFile();
  if (!retentionMs || !fs.existsSync(logFile)) return;

  const cutoff = Date.now() - retentionMs;
  const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
  const kept = lines.filter((line) => {
    try {
      const entry = JSON.parse(line);
      return new Date(entry.timestamp).getTime() >= cutoff;
    } catch {
      return false;
    }
  });
  fs.writeFileSync(logFile, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8');
}

/**
 * Compute cumulative stats from history.jsonl.
 * Returns { totalKilled, totalMemFreed, weekKilled, weekMemFreed, lastRun }.
 */
function getCumulativeStats() {
  const logs = readLogs(10000);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let totalKilled = 0;
  let totalMemFreed = 0;
  let weekKilled = 0;
  let weekMemFreed = 0;
  let lastRun = null;

  for (const entry of logs) {
    if (entry.action === 'cleanup-summary') {
      totalKilled += entry.killed || 0;
      totalMemFreed += entry.totalMemFreed || 0;
      if (!lastRun || entry.timestamp > lastRun) lastRun = entry.timestamp;

      const ts = new Date(entry.timestamp).getTime();
      if (ts >= weekAgo) {
        weekKilled += entry.killed || 0;
        weekMemFreed += entry.totalMemFreed || 0;
      }
    }
  }

  return { totalKilled, totalMemFreed, weekKilled, weekMemFreed, lastRun };
}

function summarizeHistory(logs, stats = {}) {
  let dryRuns = 0;
  let scans = 0;
  let scanFailures = 0;
  let cleanupSummaries = 0;
  let summaryFailedKills = 0;
  let looseFailedKills = 0;

  for (const entry of logs || []) {
    switch (entry.action) {
      case 'dry-run':
        dryRuns++;
        break;
      case 'scan':
        scans++;
        break;
      case 'scan-failed':
        scanFailures++;
        break;
      case 'cleanup-summary':
        cleanupSummaries++;
        summaryFailedKills += entry.failed || 0;
        break;
      case 'kill-failed':
        looseFailedKills++;
        break;
      default:
        break;
    }
  }

  return {
    dryRuns,
    scans,
    scanFailures,
    cleanupSummaries,
    failedKills: cleanupSummaries > 0 ? summaryFailedKills : looseFailedKills,
    totalKilled: stats.totalKilled || 0,
    totalMemFreed: stats.totalMemFreed || 0,
    weekKilled: stats.weekKilled || 0,
    weekMemFreed: stats.weekMemFreed || 0,
    lastRun: stats.lastRun || null,
  };
}

const exported = {
  DEFAULT_CONFIG,
  parseDuration,
  parseMemory,
  getConfigDir,
  getConfigFile,
  getLogFile,
  loadConfig,
  saveConfig,
  appendLog,
  readLogs,
  pruneLogs,
  ensureConfigDir,
  getCumulativeStats,
  summarizeHistory,
};

Object.defineProperties(exported, {
  CONFIG_DIR: { enumerable: true, get: getConfigDir },
  CONFIG_FILE: { enumerable: true, get: getConfigFile },
  LOG_FILE: { enumerable: true, get: getLogFile },
});

module.exports = exported;

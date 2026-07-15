'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseDuration, parseMemory } = require('./config-values');
const {
  appendPrivateFile,
  readPrivateFile,
  sanitizeHistoryEntry,
  sanitizeHistoryFile,
  secureDirectory,
  secureFile,
  writePrivateFile,
} = require('./storage-security');

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
  customPatterns: [],
};

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir() {
  return secureDirectory(getConfigDir());
}

/**
 * Load config from disk, merging with defaults.
 */
function loadConfig() {
  const directoryState = ensureConfigDir();
  const storageOptions = { directoryState };
  sanitizeHistoryFile(getLogFile(), storageOptions);
  const configFile = getConfigFile();
  if (fs.existsSync(configFile)) {
    secureFile(configFile, storageOptions);
    let raw;
    try {
      raw = readPrivateFile(configFile, storageOptions);
    } catch (error) {
      if (error?.code === 'ZCLEAN_UNSAFE_STORAGE') throw error;
      throw configLoadError('ZCLEAN_CONFIG_UNREADABLE', 'Config could not be read safely.', error);
    }
    let userConfig;
    try {
      userConfig = JSON.parse(raw);
    } catch (error) {
      throw configLoadError(
        'ZCLEAN_INVALID_CONFIG',
        'Config JSON is invalid; cleanup was stopped so whitelist rules are not ignored.',
        error
      );
    }
    const config = { ...DEFAULT_CONFIG, ...userConfig };
    if (!(parseDuration(config.maxAge) > 0)) config.maxAge = DEFAULT_CONFIG.maxAge;
    return config;
  }
  return { ...DEFAULT_CONFIG };
}

function configLoadError(code, message, cause) {
  const error = new Error(message, { cause });
  error.code = code;
  return error;
}

/**
 * Save config to disk.
 */
function saveConfig(config) {
  ensureConfigDir();
  writePrivateFile(getConfigFile(), JSON.stringify(config, null, 2) + '\n');
}

/**
 * Append a log entry to the history file.
 * Each entry is a JSON line with timestamp, action, and details.
 */
function appendLog(entry) {
  ensureConfigDir();
  const sanitized = sanitizeHistoryEntry({ timestamp: new Date().toISOString(), ...entry });
  appendPrivateFile(getLogFile(), JSON.stringify(sanitized) + '\n');
}

/**
 * Read recent log entries (up to `limit`).
 */
function readLogs(limit = 50) {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return [];
  try {
    const lines = readPrivateFile(logFile).trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try { return sanitizeHistoryEntry(JSON.parse(line)); } catch { return null; }
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
  const lines = readPrivateFile(logFile).trim().split('\n').filter(Boolean);
  const kept = lines.flatMap((line) => {
    try {
      const entry = sanitizeHistoryEntry(JSON.parse(line));
      return new Date(entry.timestamp).getTime() >= cutoff ? [JSON.stringify(entry)] : [];
    } catch {
      return [];
    }
  });
  writePrivateFile(logFile, kept.join('\n') + (kept.length ? '\n' : ''));
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

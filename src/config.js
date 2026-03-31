'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Config directory: ~/.zclean/
const CONFIG_DIR = path.join(os.homedir(), '.zclean');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE = path.join(CONFIG_DIR, 'history.jsonl');

const DEFAULT_CONFIG = {
  whitelist: [],
  maxAge: '24h',
  memoryThreshold: '500MB',
  schedule: 'hourly',
  sigterm_timeout: 10,
  dryRunDefault: true,
  logRetention: '30d',
  maxKillBatch: 20,
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
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load config from disk, merging with defaults.
 */
function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Append a log entry to the history file.
 * Each entry is a JSON line with timestamp, action, and details.
 */
function appendLog(entry) {
  ensureConfigDir();
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf-8');
}

/**
 * Read recent log entries (up to `limit`).
 */
function readLogs(limit = 50) {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean);
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
  if (!retentionMs || !fs.existsSync(LOG_FILE)) return;

  const cutoff = Date.now() - retentionMs;
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean);
  const kept = lines.filter((line) => {
    try {
      const entry = JSON.parse(line);
      return new Date(entry.timestamp).getTime() >= cutoff;
    } catch {
      return false;
    }
  });
  fs.writeFileSync(LOG_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8');
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  LOG_FILE,
  DEFAULT_CONFIG,
  parseDuration,
  parseMemory,
  loadConfig,
  saveConfig,
  appendLog,
  readLogs,
  pruneLogs,
  ensureConfigDir,
};

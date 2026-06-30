'use strict';

const fs = require('fs');
const {
  saveConfig,
  readLogs,
  getCumulativeStats,
  getConfigFile,
  getLogFile,
  summarizeHistory,
} = require('../config');
const { reportLogs, c, bold } = require('../reporter');

const SAFE_HISTORY_ENTRY_KEYS = new Set([
  'action',
  'errors',
  'failed',
  'found',
  'killed',
  'skipped',
  'timestamp',
  'totalMemFreed',
]);

function runHistory(flags) {
  const logs = readLogs(50);
  if (flags.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      entries: logs.map(sanitizeHistoryEntry),
      summary: summarizeHistory(logs, getCumulativeStats()),
    }, null, 2));
    return;
  }
  reportLogs(logs);
}

function runProtect(config, flags, positional) {
  const subcommand = positional[1] || 'list';

  switch (subcommand) {
    case 'list':
      return protectList(config, flags);
    case 'add':
      return protectAdd(config, flags, positional);
    case 'remove':
      return protectRemove(config, flags, positional);
    default:
      console.error(c('red', `  Unknown protect command: ${subcommand}`));
      console.error(c('gray', '  Usage: zclean protect list|add|remove'));
      process.exit(1);
  }
}

function protectList(config, flags) {
  const whitelist = getWhitelist(config);
  if (flags.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      whitelist,
    }, null, 2));
    return;
  }

  console.log(bold('\n  Protected entries\n'));
  if (whitelist.length === 0) {
    console.log(c('gray', '  No protected entries configured.\n'));
    return;
  }
  whitelist.forEach((entry, index) => {
    console.log(`  ${String(index + 1).padStart(2)}. ${entry}`);
  });
  console.log();
}

function protectAdd(config, flags, positional) {
  const entry = normalizeProtectEntry(positional.slice(2).join(' '));
  if (!entry) failProtect('Protection entry is required and cannot be empty.');

  const writableConfig = readWritableConfig(config);
  const whitelist = getWhitelist(writableConfig);
  if (whitelist.includes(entry)) {
    failProtect(`Entry is already protected: ${entry}`);
  }

  saveConfig({ ...writableConfig, whitelist: [...whitelist, entry] });
  console.log(c('green', `  Protected: ${entry}`));
  if (flags.reason) {
    console.log(c('gray', '  Note: --reason is accepted for workflow notes but is not stored in config yet.'));
  }
}

function protectRemove(config, flags, positional) {
  const writableConfig = readWritableConfig(config);
  const whitelist = getWhitelist(writableConfig);
  const indexValue = flags.index;
  let index = -1;
  let entry = null;

  if (indexValue !== undefined) {
    index = parseProtectIndex(indexValue, whitelist.length);
    entry = whitelist[index];
  } else {
    entry = normalizeProtectEntry(positional.slice(2).join(' '));
    if (!entry) failProtect('Protection entry or --index=N is required.');
    index = whitelist.indexOf(entry);
    if (index === -1) failProtect(`Entry is not protected: ${entry}`);
  }

  saveConfig({ ...writableConfig, whitelist: whitelist.filter((_, current) => current !== index) });
  console.log(c('green', `  Removed protected entry: ${entry}`));
}

function sanitizeHistoryEntry(entry) {
  const safe = {};
  for (const key of SAFE_HISTORY_ENTRY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) safe[key] = entry[key];
  }
  return safe;
}

function readWritableConfig(fallback) {
  const configFile = getConfigFile();
  if (!fs.existsSync(configFile)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return fallback;
}

function getWhitelist(config) {
  return Array.isArray(config.whitelist)
    ? config.whitelist.filter((entry) => typeof entry === 'string')
    : [];
}

function normalizeProtectEntry(value) {
  return String(value || '').trim();
}

function parseProtectIndex(value, length) {
  if (value === true || value === '') failProtect('--index must be a positive integer.');
  const index = Number(value);
  if (!Number.isInteger(index) || index < 1) failProtect('--index must be a positive integer.');
  if (index > length) failProtect(`Protection index out of range: ${index}`);
  return index - 1;
}

function failProtect(message) {
  console.error(c('red', `  ${message}`));
  process.exit(1);
}

module.exports = { runHistory, runProtect };

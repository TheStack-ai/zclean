'use strict';

const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { scan, hasScanErrors } = require('../scanner');
const { getConfigFile, getCumulativeStats } = require('../config');
const { inspectLegacyHook } = require('../installer/hook');
const { sanitizeDiagnostics, sanitizeDiagnosticText } = require('../process-diagnostic');
const { checkScheduler } = require('./scheduler-check');

function buildDoctorReport(config, options = {}) {
  const runtime = buildRuntime(options);
  const generatedAt = readGeneratedAt(options);
  const stats = normalizeStats(options.stats || getCumulativeStats());
  const checks = [
    checkConfig(),
    checkProcessScan(config, options),
    checkHook(runtime.homedir),
    checkScheduler(runtime),
    checkLastRun(stats, generatedAt),
  ];

  return {
    schemaVersion: 1,
    generatedAt,
    overallStatus: getOverallStatus(checks),
    issueCount: checks.filter((check) => check.status !== 'ok').length,
    checks,
    stats,
  };
}

function buildRuntime(options) {
  const runtime = options.runtime || {};
  return {
    platform: runtime.platform || options.platform || os.platform(),
    homedir: runtime.homedir || options.homedir || os.homedir(),
    execSync: runtime.execSync || options.execSync || execSync,
  };
}

function readGeneratedAt(options) {
  const value = typeof options.now === 'function' ? options.now() : new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeStats(stats) {
  return {
    totalKilled: stats.totalKilled || 0,
    totalMemFreed: stats.totalMemFreed || 0,
    weekKilled: stats.weekKilled || 0,
    weekMemFreed: stats.weekMemFreed || 0,
    lastRun: stats.lastRun || null,
  };
}

function checkConfig() {
  if (fs.existsSync(getConfigFile())) {
    return { id: 'config', status: 'ok', message: 'found' };
  }
  return {
    id: 'config',
    status: 'warning',
    message: 'not found - run `zclean init`',
  };
}

function checkProcessScan(config, options) {
  const scanFn = options.scan || scan;
  const hasScanErrorsFn = options.hasScanErrors || hasScanErrors;
  let scanResult;

  try {
    scanResult = scanFn(config);
  } catch (err) {
    return {
      id: 'process-scan',
      status: 'error',
      message: sanitizeDiagnosticText(err?.message || 'unable to enumerate processes'),
    };
  }

  if (hasScanErrorsFn(scanResult)) {
    const errors = sanitizeDiagnostics(scanResult.errors);
    const first = errors[0] || {};
    return {
      id: 'process-scan',
      status: 'error',
      message: `failed - ${first.message || first.code || 'unable to enumerate processes'}`,
      details: { errors },
    };
  }

  if (Array.isArray(scanResult.warnings) && scanResult.warnings.length > 0) {
    const warnings = sanitizeDiagnostics(scanResult.warnings);
    return {
      id: 'process-scan',
      status: 'warning',
      message: `warning - ${warnings[0].message || warnings[0].code || 'partial diagnostic'}`,
      details: { warnings },
    };
  }

  return { id: 'process-scan', status: 'ok', message: 'healthy' };
}

function checkHook(homeDir) {
  const inspected = inspectLegacyHook({ homedir: homeDir });
  if (inspected.state === 'legacy') {
    return {
      id: 'hook',
      status: 'warning',
      message: 'legacy Claude Stop hook found - run `zclean init` to remove it',
    };
  }
  if (inspected.state === 'invalid' || inspected.state === 'error') {
    return {
      id: 'hook',
      status: 'warning',
      message: 'optional Claude settings unreadable; legacy hook state could not be inspected',
    };
  }
  return { id: 'hook', status: 'ok', message: 'provider hooks are optional and not required' };
}

function checkLastRun(stats, generatedAt) {
  if (!stats.lastRun) return { id: 'last-run', status: 'ok', message: 'never (informational only)' };

  const ago = new Date(generatedAt).getTime() - new Date(stats.lastRun).getTime();
  const agoStr = ago < 3600000 ? `${Math.floor(ago / 60000)}m ago` :
                 ago < 86400000 ? `${Math.floor(ago / 3600000)}h ago` :
                 `${Math.floor(ago / 86400000)}d ago`;
  return {
    id: 'last-run',
    status: 'ok',
    message: `${agoStr} (${stats.lastRun.slice(0, 19).replace('T', ' ')}) - informational only`,
  };
}

function getOverallStatus(checks) {
  if (checks.some((check) => check.status === 'error')) return 'error';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'ok';
}

module.exports = { buildDoctorReport };

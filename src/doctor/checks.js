'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { scan, hasScanErrors } = require('../scanner');
const { getConfigFile, getCumulativeStats } = require('../config');
const { inspectLegacyHook } = require('../installer/hook');
const { sanitizeDiagnostics, sanitizeDiagnosticText } = require('../process-diagnostic');

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

function checkScheduler(runtime) {
  if (runtime.platform === 'darwin') return checkLaunchd(runtime);
  if (runtime.platform === 'linux') return checkSystemd(runtime);
  if (runtime.platform === 'win32') return checkTaskScheduler(runtime);
  return {
    id: 'scheduler',
    status: 'warning',
    message: `unsupported platform (${runtime.platform})`,
    details: { platform: runtime.platform },
  };
}

function checkLaunchd(runtime) {
  const plistPath = path.join(runtime.homedir, 'Library', 'LaunchAgents', 'com.zclean.hourly.plist');
  if (!fs.existsSync(plistPath)) {
    return {
      id: 'scheduler',
      status: 'warning',
      message: 'not installed - run `zclean init`',
      details: { platform: 'darwin' },
    };
  }

  const definition = inspectSchedulerDefinition(readSchedulerFile(plistPath));
  if (!definition.safe) return schedulerDefinitionWarning('darwin', definition.reason);

  try {
    const out = runtime.execSync('launchctl list com.zclean.hourly 2>&1', { encoding: 'utf-8', timeout: 5000 });
    if (!out.includes('Could not find')) {
      return {
        id: 'scheduler',
        status: 'ok',
        message: 'launchd agent loaded',
        details: { platform: 'darwin' },
      };
    }
  } catch {}

  return {
    id: 'scheduler',
    status: 'warning',
    message: 'plist exists but not loaded - run `zclean init`',
    details: { platform: 'darwin' },
  };
}

function checkSystemd(runtime) {
  const timerPath = path.join(runtime.homedir, '.config', 'systemd', 'user', 'zclean.timer');
  const servicePath = path.join(runtime.homedir, '.config', 'systemd', 'user', 'zclean.service');
  if (!fs.existsSync(timerPath) || !fs.existsSync(servicePath)) {
    return {
      id: 'scheduler',
      status: 'warning',
      message: 'not installed - run `zclean init`',
      details: { platform: 'linux' },
    };
  }

  const definition = inspectSchedulerDefinition(readSchedulerFile(servicePath));
  if (!definition.safe) return schedulerDefinitionWarning('linux', definition.reason);
  return {
    id: 'scheduler',
    status: 'ok',
    message: 'systemd report-only timer installed',
    details: { platform: 'linux' },
  };
}

function checkTaskScheduler(runtime) {
  try {
    const output = runtime.execSync(
      'schtasks /query /TN "zclean-hourly" /V /FO LIST',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const definition = inspectSchedulerDefinition(output);
    if (!definition.safe) return schedulerDefinitionWarning('win32', definition.reason);
    return {
      id: 'scheduler',
      status: 'ok',
      message: 'Task Scheduler report-only task installed',
      details: { platform: 'win32' },
    };
  } catch {}
  return {
    id: 'scheduler',
    status: 'warning',
    message: 'not installed - run `zclean init`',
    details: { platform: 'win32' },
  };
}

function readSchedulerFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function inspectSchedulerDefinition(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { safe: false, reason: 'command could not be verified' };
  }
  if (/(?:^|[\s>\"])--yes(?:[\s<\"]|$)/i.test(value)) {
    return { safe: false, reason: 'unsafe automatic cleanup command found' };
  }
  if (!/\baudit\b/i.test(value) || !/(?:^|[\s>\"])--json(?:[\s<\"]|$)/i.test(value)) {
    return { safe: false, reason: 'command is not the report-only audit contract' };
  }
  return { safe: true };
}

function schedulerDefinitionWarning(platform, reason) {
  return {
    id: 'scheduler',
    status: 'warning',
    message: `${reason} - run \`zclean init\` to install the report-only scheduler`,
    details: { platform },
  };
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

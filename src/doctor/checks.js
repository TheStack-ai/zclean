'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { scan, hasScanErrors } = require('../scanner');
const { getConfigFile, getCumulativeStats } = require('../config');

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
      message: err.message || 'unable to enumerate processes',
    };
  }

  if (hasScanErrorsFn(scanResult)) {
    const errors = Array.isArray(scanResult.errors) ? scanResult.errors : [];
    const first = errors[0] || {};
    return {
      id: 'process-scan',
      status: 'error',
      message: `failed - ${first.message || first.code || 'unable to enumerate processes'}`,
      details: { errors },
    };
  }

  if (Array.isArray(scanResult.warnings) && scanResult.warnings.length > 0) {
    return {
      id: 'process-scan',
      status: 'warning',
      message: `warning - ${scanResult.warnings[0].message || scanResult.warnings[0].code || 'partial diagnostic'}`,
      details: { warnings: scanResult.warnings },
    };
  }

  return { id: 'process-scan', status: 'ok', message: 'healthy' };
}

function checkHook(homeDir) {
  const claudeSettings = path.join(homeDir, '.claude', 'settings.json');
  let hookInstalled = false;
  if (fs.existsSync(claudeSettings)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettings, 'utf-8'));
      const hooks = settings.hooks?.Stop || [];
      hookInstalled = hooks.some((h) =>
        (h.command && h.command.includes('zclean')) ||
        (Array.isArray(h.hooks) && h.hooks.some((sub) => sub.command && sub.command.includes('zclean')))
      );
    } catch {}
  }
  if (hookInstalled) return { id: 'hook', status: 'ok', message: 'Claude Code SessionEnd registered' };
  return { id: 'hook', status: 'warning', message: 'not registered - run `zclean init`' };
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
  if (fs.existsSync(timerPath)) {
    return {
      id: 'scheduler',
      status: 'ok',
      message: 'systemd timer installed',
      details: { platform: 'linux' },
    };
  }
  return {
    id: 'scheduler',
    status: 'warning',
    message: 'not installed - run `zclean init`',
    details: { platform: 'linux' },
  };
}

function checkTaskScheduler(runtime) {
  try {
    runtime.execSync('schtasks /query /TN "zclean-hourly"', { encoding: 'utf-8', timeout: 5000 });
    return {
      id: 'scheduler',
      status: 'ok',
      message: 'Task Scheduler task installed',
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

function checkLastRun(stats, generatedAt) {
  if (!stats.lastRun) return { id: 'last-run', status: 'ok', message: 'never - run `zclean --yes` to test' };

  const ago = new Date(generatedAt).getTime() - new Date(stats.lastRun).getTime();
  const agoStr = ago < 3600000 ? `${Math.floor(ago / 60000)}m ago` :
                 ago < 86400000 ? `${Math.floor(ago / 3600000)}h ago` :
                 `${Math.floor(ago / 86400000)}d ago`;
  if (ago > 2 * 3600000) {
    return {
      id: 'last-run',
      status: 'warning',
      message: `${agoStr} (${stats.lastRun.slice(0, 19).replace('T', ' ')}) - scheduler may not be running`,
    };
  }
  return {
    id: 'last-run',
    status: 'ok',
    message: `${agoStr} (${stats.lastRun.slice(0, 19).replace('T', ' ')})`,
  };
}

function getOverallStatus(checks) {
  if (checks.some((check) => check.status === 'error')) return 'error';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'ok';
}

module.exports = { buildDoctorReport };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeDiagnosticText } = require('../process-diagnostic');
const { systemdShowCommand } = require('../systemd-contract');
const { inspectSchedulerDefinition } = require('./scheduler-definition');

function checkScheduler(runtime) {
  if (runtime.platform === 'darwin') return checkLaunchd(runtime);
  if (runtime.platform === 'linux') return checkSystemd(runtime);
  if (runtime.platform === 'win32') return checkTaskScheduler(runtime);
  return warning(runtime.platform, `unsupported platform (${runtime.platform})`);
}

function checkLaunchd(runtime) {
  const plistPath = path.join(runtime.homedir, 'Library', 'LaunchAgents', 'com.zclean.hourly.plist');
  if (!fs.existsSync(plistPath)) return warning('darwin', 'not installed');

  const definition = inspectSchedulerDefinition(readSchedulerFile(plistPath), 'darwin');
  if (!definition.safe) return warning('darwin', definition.reason);

  try {
    const output = runtime.execSync('launchctl list com.zclean.hourly 2>&1', executionOptions());
    if (!String(output).includes('Could not find')) {
      return ok('darwin', 'launchd agent loaded');
    }
    return warning('darwin', 'plist exists but is not loaded');
  } catch (error) {
    if (isMissingScheduler(error, 'darwin')) return warning('darwin', 'plist exists but is not loaded');
    return queryWarning('darwin', error);
  }
}

function checkSystemd(runtime) {
  const unitDir = path.join(runtime.homedir, '.config', 'systemd', 'user');
  const timerPath = path.join(unitDir, 'zclean.timer');
  const servicePath = path.join(unitDir, 'zclean.service');
  if (!fs.existsSync(timerPath) || !fs.existsSync(servicePath)) return warning('linux', 'not installed');

  const definition = inspectSchedulerDefinition(readSchedulerFile(servicePath), 'linux');
  if (!definition.safe) return warning('linux', definition.reason);
  try {
    const loadedDefinition = runtime.execSync(systemdShowCommand('zclean.service'), executionOptions());
    const timerState = runtime.execSync('systemctl --user is-active zclean.timer', executionOptions());
    const loaded = inspectSchedulerDefinition(loadedDefinition, 'linux');
    if (!loaded.safe) return warning('linux', loaded.reason);
    if (String(timerState).trim() !== 'active') return warning('linux', 'report-only timer is not active');
    return ok('linux', 'systemd report-only timer installed');
  } catch (error) {
    return queryWarning('linux', error);
  }
}

function checkTaskScheduler(runtime) {
  try {
    const output = runtime.execSync(
      'schtasks /query /TN "zclean-hourly" /XML',
      executionOptions()
    );
    const definition = inspectSchedulerDefinition(output, 'win32');
    if (!definition.safe) return warning('win32', definition.reason);
    return ok('win32', 'Task Scheduler report-only task installed');
  } catch (error) {
    if (isMissingScheduler(error, 'win32')) return warning('win32', 'not installed');
    return queryWarning('win32', error);
  }
}

function readSchedulerFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function queryWarning(platform, error) {
  const causeCode = typeof error?.code === 'string' ? error.code.slice(0, 80) : 'QUERY_FAILED';
  const cause = sanitizeDiagnosticText(error?.message || 'scheduler state could not be queried');
  return {
    id: 'scheduler',
    status: 'warning',
    message: `scheduler inspection failed (${causeCode}): ${cause}`,
    details: { platform, causeCode },
  };
}

function warning(platform, reason) {
  return {
    id: 'scheduler',
    status: 'warning',
    message: `${reason} - run \`zclean init\` to install the report-only scheduler`,
    details: { platform },
  };
}

function ok(platform, message) {
  return { id: 'scheduler', status: 'ok', message, details: { platform } };
}

function isMissingScheduler(error, platform) {
  const output = `${error?.message || ''}\n${String(error?.stdout || '')}\n${String(error?.stderr || '')}`;
  if (platform === 'darwin') return /could not find service|service not found|no such process/i.test(output);
  return /cannot find (?:the )?(?:file|task)|task .* not found|does not exist/i.test(output);
}

function executionOptions() {
  return { encoding: 'utf-8', timeout: 5000 };
}

module.exports = { checkScheduler };

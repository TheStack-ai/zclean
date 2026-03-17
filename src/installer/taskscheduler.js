'use strict';

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TASK_NAME = 'zclean-hourly';

/**
 * Resolve the full path to the zclean binary on Windows.
 */
function resolveZcleanBin() {
  // Check npm global
  try {
    const npmPrefix = execSync('npm prefix -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    const candidate = path.join(npmPrefix, 'zclean.cmd');
    if (fs.existsSync(candidate)) return candidate;
    const candidate2 = path.join(npmPrefix, 'node_modules', '.bin', 'zclean.cmd');
    if (fs.existsSync(candidate2)) return candidate2;
  } catch { /* ignore */ }

  // Check AppData local
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const npmGlobal = path.join(appData, 'npm', 'zclean.cmd');
  if (fs.existsSync(npmGlobal)) return npmGlobal;

  return 'npx zclean';
}

/**
 * Install a Windows Task Scheduler hourly task.
 *
 * Uses `schtasks /create` with user-scoped hourly task.
 *
 * @returns {{ installed: boolean, message: string }}
 */
function installTaskScheduler() {
  if (os.platform() !== 'win32') {
    return { installed: false, message: 'Task Scheduler is Windows only.' };
  }

  const binPath = resolveZcleanBin();

  // Build schtasks command
  // /SC HOURLY — run every hour
  // /TN — task name
  // /TR — task to run
  // /F — force overwrite if exists
  const command = [
    'schtasks', '/create',
    '/TN', `"${TASK_NAME}"`,
    '/SC', 'HOURLY',
    '/TR', `"${binPath} --yes"`,
    '/F',
  ].join(' ');

  try {
    execSync(command, { encoding: 'utf-8', timeout: 10000 });
    return {
      installed: true,
      message: `Task Scheduler task created: ${TASK_NAME} (hourly)`,
    };
  } catch (err) {
    return {
      installed: false,
      message: `Failed to create scheduled task: ${err.message}\nTry running as administrator.`,
    };
  }
}

/**
 * Remove the Windows Task Scheduler task.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeTaskScheduler() {
  if (os.platform() !== 'win32') {
    return { removed: false, message: 'Task Scheduler is Windows only.' };
  }

  try {
    execSync(`schtasks /delete /TN "${TASK_NAME}" /F`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return {
      removed: true,
      message: `Task Scheduler task removed: ${TASK_NAME}`,
    };
  } catch (err) {
    if (err.message.includes('does not exist') || err.message.includes('ERROR')) {
      return { removed: false, message: 'Task not found. Already uninstalled.' };
    }
    return {
      removed: false,
      message: `Failed to remove task: ${err.message}`,
    };
  }
}

module.exports = { installTaskScheduler, removeTaskScheduler, TASK_NAME };

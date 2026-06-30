'use strict';

const { execFileSync } = require('child_process');
const os = require('os');
const { LOCAL_BIN_HINT, resolveZcleanBin } = require('./bin-path');

const TASK_NAME = 'zclean-hourly';

function buildCreateTaskArgs(binPath) {
  return [
    '/create',
    '/TN', TASK_NAME,
    '/SC', 'HOURLY',
    '/TR', formatTaskRunCommand(binPath),
    '/F',
  ];
}

function formatTaskRunCommand(binPath) {
  const text = String(binPath);
  const command = /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
  return `${command} --yes`;
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
  if (!binPath) {
    return { installed: false, message: `Local zclean executable not found. ${LOCAL_BIN_HINT}` };
  }

  const args = buildCreateTaskArgs(binPath);

  try {
    execFileSync('schtasks', args, { encoding: 'utf-8', timeout: 10000 });
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
    execFileSync('schtasks', ['/delete', '/TN', TASK_NAME, '/F'], {
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

module.exports = {
  installTaskScheduler,
  removeTaskScheduler,
  resolveZcleanBin,
  buildCreateTaskArgs,
  formatTaskRunCommand,
  TASK_NAME,
};

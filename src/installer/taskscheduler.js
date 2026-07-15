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
  const command = `"${text.replace(/"/g, '\\"')}"`;
  return `${command} audit --json`;
}

/**
 * Install a Windows Task Scheduler hourly task.
 *
 * Uses `schtasks /create` with user-scoped hourly task.
 *
 * @returns {{ installed: boolean, message: string }}
 */
function installTaskScheduler(options = {}) {
  const platform = options.platform || os.platform();
  const run = options.execFileSync || execFileSync;
  if (platform !== 'win32') {
    return { installed: false, message: 'Task Scheduler is Windows only.' };
  }

  const binPath = options.binPath || resolveZcleanBin();
  if (!binPath) {
    return { installed: false, message: `Local zclean executable not found. ${LOCAL_BIN_HINT}` };
  }

  const args = buildCreateTaskArgs(binPath);

  try {
    run('schtasks', ['/delete', '/TN', TASK_NAME, '/F'], schedulerOptions());
  } catch (error) {
    if (!isTaskMissing(error)) {
      return {
        installed: false,
        active: false,
        message: 'Could not remove the existing scheduled task; it was preserved for a later retry.',
      };
    }
  }

  try {
    run('schtasks', args, schedulerOptions());
    return {
      installed: true,
      active: true,
      message: `Task Scheduler task created: ${TASK_NAME} (hourly)`,
    };
  } catch {
    return {
      installed: false,
      active: false,
      message: 'The old task was removed, but the report-only task could not be created. Try running as administrator.',
    };
  }
}

/**
 * Remove the Windows Task Scheduler task.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeTaskScheduler(options = {}) {
  const platform = options.platform || os.platform();
  const run = options.execFileSync || execFileSync;
  if (platform !== 'win32') {
    return { removed: false, failed: false, message: 'Task Scheduler is Windows only.' };
  }

  try {
    run('schtasks', ['/delete', '/TN', TASK_NAME, '/F'], schedulerOptions());
    return {
      removed: true,
      failed: false,
      message: `Task Scheduler task removed: ${TASK_NAME}`,
    };
  } catch (err) {
    if (isTaskMissing(err)) {
      return { removed: false, failed: false, message: 'Task not found. Already uninstalled.' };
    }
    return {
      removed: false,
      failed: true,
      message: `Failed to remove task: ${err.message}`,
    };
  }
}

function schedulerOptions() {
  return { encoding: 'utf-8', timeout: 10000 };
}

function isTaskMissing(err) {
  const output = `${err?.message || ''}\n${String(err?.stdout || '')}\n${String(err?.stderr || '')}`;
  return /task name(?: .*?)? does not exist|cannot find the (?:file|task)|task .* not found/i.test(output);
}

module.exports = {
  installTaskScheduler,
  removeTaskScheduler,
  resolveZcleanBin,
  buildCreateTaskArgs,
  formatTaskRunCommand,
  TASK_NAME,
};

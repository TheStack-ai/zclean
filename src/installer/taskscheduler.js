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

  let deleteFailed = false;
  try {
    run('schtasks', ['/delete', '/TN', TASK_NAME, '/F'], schedulerOptions());
  } catch (error) {
    if (!isTaskMissing(error)) {
      deleteFailed = true;
    }
  }

  try {
    run('schtasks', args, schedulerOptions());
  } catch {
    return {
      installed: false,
      active: false,
      message: deleteFailed
        ? 'Existing task delete failed, and its in-place report-only replacement failed; the previous task may still run.'
        : 'The old task was removed, but the report-only task could not be created. Try running as administrator.',
    };
  }

  let definition;
  try {
    definition = run('schtasks', ['/query', '/TN', TASK_NAME, '/XML'], schedulerOptions());
  } catch {}
  if (!isExpectedTaskDefinition(definition, binPath)) {
    return {
      installed: false,
      active: false,
      message: deleteFailed
        ? 'Existing task delete failed; the resulting command could not be verified as audit --json and a destructive command may still run.'
        : 'The task was created, but its resulting command could not be verified as audit --json.',
    };
  }

  return {
    installed: true,
    active: true,
    message: deleteFailed
      ? `Existing task delete failed; the task was replaced in place and its audit --json command was verified: ${TASK_NAME} (hourly)`
      : `Task Scheduler task created and verified: ${TASK_NAME} (hourly)`,
  };
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

function isExpectedTaskDefinition(value, binPath) {
  const xml = String(value || '');
  const actionBlocks = [...xml.matchAll(/<Actions\b[^>]*>([\s\S]*?)<\/Actions>/gi)];
  if (actionBlocks.length !== 1) return false;
  const actions = actionBlocks[0][1];
  const actionNames = [...actions.matchAll(/<(Exec|ComHandler|SendEmail|ShowMessage)\b/gi)];
  if (actionNames.length !== 1 || actionNames[0][1].toLowerCase() !== 'exec') return false;
  const exec = actions.match(/<Exec\b[^>]*>([\s\S]*?)<\/Exec>/i);
  const command = exec?.[1].match(/<Command>([\s\S]*?)<\/Command>/i);
  const args = exec?.[1].match(/<Arguments>([\s\S]*?)<\/Arguments>/i);
  if (!command || !args) return false;
  return normalizeTaskPath(decodeXml(command[1])) === normalizeTaskPath(binPath)
    && decodeXml(args[1]).trim() === 'audit --json';
}

function normalizeTaskPath(value) {
  return String(value).trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\//g, '\\').toLowerCase();
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

module.exports = {
  installTaskScheduler,
  removeTaskScheduler,
  resolveZcleanBin,
  buildCreateTaskArgs,
  formatTaskRunCommand,
  TASK_NAME,
};

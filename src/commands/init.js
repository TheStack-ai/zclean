'use strict';

const fs = require('node:fs');
const os = require('node:os');
const { saveConfig, getConfigFile } = require('../config');
const { inspectLegacyHook, removeLegacyHook } = require('../installer/hook');
const scheduler = require('./scheduler');
const { renderInit } = require('../cli-brand');
const { version } = require('../../package.json');

function runInit(options) {
  const {
    config,
    platform,
    inspectLegacy = inspectLegacyHook,
    removeLegacy = removeLegacyHook,
    installScheduler = scheduler.installScheduler,
    getSchedulerState = scheduler.getSchedulerState,
    write = console.log,
  } = options;
  const configFile = getConfigFile();
  const configExists = fs.existsSync(configFile);
  if (!configExists) saveConfig(config);

  const steps = [{
    index: '01',
    label: 'CONFIG',
    state: configExists ? 'EXISTS' : 'READY',
    detail: configFile.replace(os.homedir(), '~'),
  }];
  const inspected = safelyInspect(inspectLegacy);
  let legacyResult = inspected;

  if (inspected.state === 'legacy') {
    legacyResult = safelyRemove(removeLegacy);
    if (legacyResult.state !== 'removed') {
      addStep(steps, 'CLAUDE LEGACY STOP', 'ERROR', legacyResult.message);
      addStep(steps, 'SCHEDULER', 'SKIPPED', 'Not changed because legacy migration did not complete');
      return finish({ steps, exitCode: 1, write, legacyResult, schedulerResult: null });
    }
    addStep(steps, 'CLAUDE LEGACY STOP', 'REMOVED', legacyResult.message);
  } else if (inspected.state === 'invalid' || inspected.state === 'error') {
    addStep(steps, 'OPTIONAL CLAUDE SETTINGS', 'WARNING', inspected.message);
  }

  let schedulerResult;
  try {
    schedulerResult = installScheduler(platform);
  } catch (error) {
    schedulerResult = { installed: false, active: false, message: error.message || 'Scheduler install failed.' };
  }
  const schedulerState = getSchedulerState(schedulerResult);
  addStep(
    steps,
    'SCHEDULER',
    schedulerState,
    schedulerState === 'ACTIVE' ? schedulerLabel(platform) : schedulerResult.message
  );
  if (schedulerState === 'ACTIVE') {
    addStep(steps, 'AUTO CLEANUP', 'LOCKED', 'Scheduler never passes --yes');
    addStep(steps, 'PROVIDER HOOKS', 'NONE', 'No provider hook installation');
  }

  return finish({
    steps,
    exitCode: schedulerState === 'ACTIVE' ? 0 : 1,
    write,
    legacyResult,
    schedulerResult,
  });
}

function safelyInspect(inspectLegacy) {
  try {
    return inspectLegacy();
  } catch {
    return { state: 'error', message: 'Optional Claude Code settings could not be inspected and were left unchanged.' };
  }
}

function safelyRemove(removeLegacy) {
  try {
    return removeLegacy();
  } catch {
    return { state: 'error', message: 'Legacy zclean Stop hook could not be removed; original settings were preserved.' };
  }
}

function addStep(steps, label, state, detail) {
  steps.push({
    index: String(steps.length + 1).padStart(2, '0'),
    label,
    state,
    detail,
  });
}

function finish({ steps, exitCode, write, legacyResult, schedulerResult }) {
  const warningCount = steps.filter((step) => step.state === 'WARNING').length;
  const errorCount = steps.filter((step) => step.state === 'ERROR').length;
  write(renderInit({ version, steps, warningCount, errorCount }));
  if (exitCode !== 0) process.exitCode = exitCode;
  return { exitCode, legacyResult, schedulerResult, steps };
}

function schedulerLabel(platform) {
  if (platform === 'darwin') return 'Hourly launchd read-only audit --json';
  if (platform === 'linux') return 'Hourly systemd read-only audit --json';
  if (platform === 'win32') return 'Hourly Windows read-only audit --json';
  return 'Hourly native read-only audit --json';
}

module.exports = { runInit };

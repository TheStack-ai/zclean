'use strict';

const fs = require('node:fs');
const os = require('node:os');
const { saveConfig, getConfigFile } = require('../config');
const { installHook } = require('../installer/hook');
const { installScheduler, getSchedulerState } = require('./scheduler');
const { renderInit } = require('../cli-brand');
const { version } = require('../../package.json');

function runInit({ config, platform }) {
  const configFile = getConfigFile();
  const configExists = fs.existsSync(configFile);
  if (!configExists) saveConfig(config);

  const hookResult = installHook();
  const schedulerResult = installScheduler(platform);
  const schedulerState = getSchedulerState(schedulerResult);
  const steps = [
    {
      index: '01',
      label: 'CONFIG',
      state: configExists ? 'EXISTS' : 'READY',
      detail: configFile.replace(os.homedir(), '~'),
    },
    {
      index: '02',
      label: 'CLAUDE HOOK',
      state: hookResult.installed ? 'INSTALLED' : 'WARNING',
      detail: hookResult.installed ? 'SessionEnd cleanup hook registered' : hookResult.message,
    },
    {
      index: '03',
      label: 'SCHEDULER',
      state: schedulerState,
      detail: schedulerState === 'ACTIVE' ? schedulerLabel(platform) : schedulerResult.message,
    },
  ];
  const warningCount = steps.filter((step) => step.state === 'WARNING').length;
  console.log(renderInit({ version, steps, warningCount }));
}

function schedulerLabel(platform) {
  if (platform === 'darwin') return 'Hourly launchd hygiene check';
  if (platform === 'linux') return 'Hourly systemd hygiene timer';
  if (platform === 'win32') return 'Hourly Task Scheduler check';
  return 'Runtime hygiene scheduler';
}

module.exports = { runInit };

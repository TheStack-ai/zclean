'use strict';

const { c } = require('../reporter');

function installScheduler(platform) {
  switch (platform) {
    case 'darwin': {
      const { installLaunchd } = require('../installer/launchd');
      const result = installLaunchd();
      const icon = result.installed ? c('green', '  Scheduler:') : c('yellow', '  Scheduler:');
      console.log(`${icon} ${result.message}`);
      break;
    }
    case 'linux': {
      const { installSystemd } = require('../installer/systemd');
      const result = installSystemd();
      const icon = result.installed ? c('green', '  Scheduler:') : c('yellow', '  Scheduler:');
      console.log(`${icon} ${result.message}`);
      break;
    }
    case 'win32': {
      const { installTaskScheduler } = require('../installer/taskscheduler');
      const result = installTaskScheduler();
      const icon = result.installed ? c('green', '  Scheduler:') : c('yellow', '  Scheduler:');
      console.log(`${icon} ${result.message}`);
      break;
    }
    default:
      console.log(c('yellow', `  Scheduler: Unsupported platform (${platform}). Install a cron job manually.`));
  }
}

function uninstallScheduler(platform) {
  switch (platform) {
    case 'darwin': {
      const { removeLaunchd } = require('../installer/launchd');
      const result = removeLaunchd();
      console.log(`  Scheduler: ${result.message}`);
      break;
    }
    case 'linux': {
      const { removeSystemd } = require('../installer/systemd');
      const result = removeSystemd();
      console.log(`  Scheduler: ${result.message}`);
      break;
    }
    case 'win32': {
      const { removeTaskScheduler } = require('../installer/taskscheduler');
      const result = removeTaskScheduler();
      console.log(`  Scheduler: ${result.message}`);
      break;
    }
    default:
      console.log(c('yellow', `  Scheduler: Remove manually for ${platform}.`));
  }
}

module.exports = { installScheduler, uninstallScheduler };

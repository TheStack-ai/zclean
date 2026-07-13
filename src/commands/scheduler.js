'use strict';

const { c } = require('../reporter');

function installScheduler(platform) {
  switch (platform) {
    case 'darwin': {
      const { installLaunchd } = require('../installer/launchd');
      return installLaunchd();
    }
    case 'linux': {
      const { installSystemd } = require('../installer/systemd');
      return installSystemd();
    }
    case 'win32': {
      const { installTaskScheduler } = require('../installer/taskscheduler');
      return installTaskScheduler();
    }
    default:
      return {
        installed: false,
        message: `Unsupported platform (${platform}). Install a cron job manually.`,
      };
  }
}

function uninstallScheduler(platform, options = {}) {
  const log = options.log || console.log;
  let result;
  switch (platform) {
    case 'darwin': {
      const { removeLaunchd } = require('../installer/launchd');
      result = (options.remove || removeLaunchd)();
      log(`  Scheduler: ${result.message}`);
      break;
    }
    case 'linux': {
      const { removeSystemd } = require('../installer/systemd');
      result = (options.remove || removeSystemd)();
      log(`  Scheduler: ${result.message}`);
      break;
    }
    case 'win32': {
      const { removeTaskScheduler } = require('../installer/taskscheduler');
      result = (options.remove || removeTaskScheduler)();
      log(`  Scheduler: ${result.message}`);
      break;
    }
    default: {
      result = { removed: false, failed: false, message: `Remove manually for ${platform}.` };
      log(c('yellow', `  Scheduler: ${result.message}`));
    }
  }
  if (result.failed) process.exitCode = 1;
  return result;
}

function getSchedulerState(result) {
  return result.installed && result.active !== false ? 'ACTIVE' : 'WARNING';
}

module.exports = { installScheduler, uninstallScheduler, getSchedulerState };

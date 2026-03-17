#!/usr/bin/env node
'use strict';

const os = require('os');
const { scan } = require('../src/scanner');
const { killZombies } = require('../src/killer');
const { loadConfig, saveConfig, readLogs, pruneLogs, CONFIG_FILE, DEFAULT_CONFIG, appendLog } = require('../src/config');
const { reportDryRun, reportKill, reportStatus, reportLogs, reportConfig, c, bold } = require('../src/reporter');
const { installHook, removeHook } = require('../src/installer/hook');

// Platform-specific installers (lazy loaded)
const platform = os.platform();

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    flags[key] = value !== undefined ? value : true;
  } else if (arg.startsWith('-') && arg.length === 2) {
    flags[arg.substring(1)] = true;
  } else {
    positional.push(arg);
  }
}

const command = positional[0] || null;

// ─── Version / Help ─────────────────────────────────────────────────────────

if (flags.version || flags.v) {
  const pkg = require('../package.json');
  console.log(`zclean v${pkg.version}`);
  process.exit(0);
}

if (flags.help || flags.h) {
  printHelp();
  process.exit(0);
}

// ─── Command Dispatch ───────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();

  switch (command) {
    case 'init':
      return cmdInit(config);

    case 'status':
      return cmdStatus(config);

    case 'logs':
      return cmdLogs(config);

    case 'uninstall':
      return cmdUninstall();

    case 'config':
      return cmdConfig(config);

    case null:
      // Default: scan (dry-run unless --yes)
      return cmdScan(config);

    default:
      console.error(c('red', `  Unknown command: ${command}`));
      printHelp();
      process.exit(1);
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────

/**
 * Default command: scan for zombies.
 * Dry-run unless --yes is passed.
 */
function cmdScan(config) {
  const sessionPid = flags['session-pid'] ? parseInt(flags['session-pid'], 10) : null;
  const force = flags.yes || flags.y;

  console.log(bold('\n  zclean') + c('gray', ' — scanning for zombie processes...\n'));

  const zombies = scan(config, { sessionPid });

  if (force) {
    // Kill mode
    if (zombies.length === 0) {
      console.log(c('green', '  No zombie processes found. System is clean.\n'));
      appendLog({ action: 'scan', found: 0 });
      return;
    }
    appendLog({ action: 'scan', found: zombies.length });
    const results = killZombies(zombies, config);
    reportKill(results);
  } else {
    // Dry-run mode
    reportDryRun(zombies);
    if (zombies.length > 0) {
      appendLog({ action: 'dry-run', found: zombies.length });
    }
  }

  // Prune old logs
  pruneLogs(config);
}

/**
 * init: Install hooks + scheduler.
 */
function cmdInit(config) {
  console.log(bold('\n  zclean init') + c('gray', ' — installing hooks and scheduler...\n'));

  // 1. Save default config if none exists
  const existingConfig = loadConfig();
  if (JSON.stringify(existingConfig) === JSON.stringify(DEFAULT_CONFIG)) {
    saveConfig(DEFAULT_CONFIG);
    console.log(c('green', '  Config created:') + ` ${CONFIG_FILE}`);
  } else {
    console.log(c('gray', '  Config exists:') + ` ${CONFIG_FILE}`);
  }

  // 2. Install Claude Code hook
  const hookResult = installHook();
  const hookIcon = hookResult.installed ? c('green', '  Hook:') : c('yellow', '  Hook:');
  console.log(`${hookIcon} ${hookResult.message}`);

  // 3. Install platform-specific scheduler
  installScheduler();

  console.log();
}

/**
 * status: Show current zombies and last cleanup info.
 */
function cmdStatus(config) {
  const zombies = scan(config);
  const logs = readLogs(100);
  reportStatus(zombies, logs);
}

/**
 * logs: Show recent cleanup history.
 */
function cmdLogs(config) {
  const logs = readLogs(50);
  reportLogs(logs);
}

/**
 * uninstall: Remove hooks + scheduler.
 */
function cmdUninstall() {
  console.log(bold('\n  zclean uninstall') + c('gray', ' — removing hooks and scheduler...\n'));

  // Remove hook
  const hookResult = removeHook();
  console.log(`  Hook: ${hookResult.message}`);

  // Remove scheduler
  uninstallScheduler();

  console.log(c('gray', `\n  Config and logs preserved at ~/.zclean/`));
  console.log(c('gray', `  To fully remove: rm -rf ~/.zclean\n`));
}

/**
 * config: Show current config.
 */
function cmdConfig(config) {
  reportConfig(config, CONFIG_FILE);
}

// ─── Platform Scheduler Install/Uninstall ───────────────────────────────────

function installScheduler() {
  switch (platform) {
    case 'darwin': {
      const { installLaunchd } = require('../src/installer/launchd');
      const result = installLaunchd();
      const icon = result.installed ? c('green', '  Scheduler:') : c('yellow', '  Scheduler:');
      console.log(`${icon} ${result.message}`);
      break;
    }
    case 'linux': {
      const { installSystemd } = require('../src/installer/systemd');
      const result = installSystemd();
      const icon = result.installed ? c('green', '  Scheduler:') : c('yellow', '  Scheduler:');
      console.log(`${icon} ${result.message}`);
      break;
    }
    case 'win32': {
      const { installTaskScheduler } = require('../src/installer/taskscheduler');
      const result = installTaskScheduler();
      const icon = result.installed ? c('green', '  Scheduler:') : c('yellow', '  Scheduler:');
      console.log(`${icon} ${result.message}`);
      break;
    }
    default:
      console.log(c('yellow', `  Scheduler: Unsupported platform (${platform}). Install a cron job manually.`));
  }
}

function uninstallScheduler() {
  switch (platform) {
    case 'darwin': {
      const { removeLaunchd } = require('../src/installer/launchd');
      const result = removeLaunchd();
      console.log(`  Scheduler: ${result.message}`);
      break;
    }
    case 'linux': {
      const { removeSystemd } = require('../src/installer/systemd');
      const result = removeSystemd();
      console.log(`  Scheduler: ${result.message}`);
      break;
    }
    case 'win32': {
      const { removeTaskScheduler } = require('../src/installer/taskscheduler');
      const result = removeTaskScheduler();
      console.log(`  Scheduler: ${result.message}`);
      break;
    }
    default:
      console.log(c('yellow', `  Scheduler: Remove manually for ${platform}.`));
  }
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
  ${bold('zclean')} — Automatic zombie process cleaner for AI coding tools

  ${bold('Usage:')}
    zclean                Scan for zombies (dry-run)
    zclean --yes          Scan and kill zombies
    zclean init           Install hooks + scheduler
    zclean status         Show current zombies and last cleanup
    zclean logs           Show recent cleanup history
    zclean uninstall      Remove hooks + scheduler
    zclean config         Show current configuration

  ${bold('Options:')}
    --yes, -y             Kill found zombies (default: dry-run)
    --session-pid=PID     Filter by parent session PID
    --version, -v         Show version
    --help, -h            Show this help

  ${bold('Config:')}  ~/.zclean/config.json
  ${bold('Logs:')}    ~/.zclean/history.jsonl

  ${bold('Docs:')}    https://github.com/whynowlab/zclean
`);
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(c('red', `\n  Error: ${err.message}\n`));
  if (flags.verbose) {
    console.error(err.stack);
  }
  process.exit(1);
});

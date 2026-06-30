#!/usr/bin/env node
'use strict';

const os = require('os');
const { scan, hasScanErrors } = require('../src/scanner');
const { killZombies } = require('../src/killer');
const {
  loadConfig,
  saveConfig,
  readLogs,
  pruneLogs,
  DEFAULT_CONFIG,
  appendLog,
  getCumulativeStats,
  getConfigFile,
} = require('../src/config');
const { reportDryRun, reportKill, reportStatus, reportLogs, reportConfig, c, bold } = require('../src/reporter');
const { installHook, removeHook } = require('../src/installer/hook');
const { runHistory, runProtect } = require('../src/commands/trust');
const { installScheduler, uninstallScheduler } = require('../src/commands/scheduler');
const { runDoctor } = require('../src/doctor');
const { runAudit } = require('../src/audit');
const { runCache } = require('../src/cache');

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

    case 'history':
      return runHistory(flags);

    case 'protect':
      return runProtect(config, flags, positional);

    case 'uninstall':
      return cmdUninstall();

    case 'config':
      return cmdConfig(config);

    case 'doctor':
      return cmdDoctor(config);

    case 'report':
      return cmdAudit(config, 'report');

    case 'audit':
      return cmdAudit(config, 'audit');

    case 'cache':
      return cmdCache();

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
  const sessionPid = parseSessionPidFlag();
  const force = flags.yes || flags.y;

  console.log(bold('\n  zclean') + c('gray', ' — scanning for zombie processes...\n'));

  const zombies = scan(config, { sessionPid });

  if (hasScanErrors(zombies)) {
    reportDryRun(zombies);
    appendLog({ action: 'scan-failed', errors: zombies.errors.length });
    pruneLogs(config);
    process.exitCode = 1;
    return;
  }

  if (force) {
    // Kill mode
    if (zombies.length === 0) {
      console.log(c('green', '  No zombie processes found. System is clean.\n'));
      appendLog({ action: 'scan', found: 0 });
      return;
    }
    appendLog({ action: 'scan', found: zombies.length });
    const results = killZombies(zombies, config);
    results.cumulative = getCumulativeStats();
    reportKill(results);
  } else {
    // Dry-run mode
    if (config.dryRunDefault === false) {
      console.log(c('yellow', '  dryRunDefault=false is not an auto-kill switch; pass --yes to clean.\n'));
    }
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
    console.log(c('green', '  Config created:') + ` ${getConfigFile()}`);
  } else {
    console.log(c('gray', '  Config exists:') + ` ${getConfigFile()}`);
  }

  // 2. Install Claude Code hook
  const hookResult = installHook();
  const hookIcon = hookResult.installed ? c('green', '  Hook:') : c('yellow', '  Hook:');
  console.log(`${hookIcon} ${hookResult.message}`);

  // 3. Install platform-specific scheduler
  installScheduler(platform);

  console.log();
}

/**
 * status: Show current zombies and last cleanup info.
 */
function cmdStatus(config) {
  const zombies = scan(config);
  const logs = readLogs(100);
  reportStatus(zombies, logs);
  if (hasScanErrors(zombies)) process.exitCode = 1;
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
  uninstallScheduler(platform);

  console.log(c('gray', `\n  Config and logs preserved at ~/.zclean/`));
  console.log(c('gray', `  To fully remove: rm -rf ~/.zclean\n`));
}

/**
 * config: Show current config.
 */
function cmdConfig(config) {
  reportConfig(config, getConfigFile());
}

/**
 * doctor: Self-diagnosis — check if zclean is properly set up and running.
 */
function cmdDoctor(config) {
  const report = runDoctor(config, { json: Boolean(flags.json) });
  if (report.exitCode !== 0) process.exitCode = report.exitCode;
}

function cmdAudit(config, commandName = 'audit') {
  const sessionPid = parseSessionPidFlag();
  const report = runAudit(config, { json: Boolean(flags.json), sessionPid, commandName });
  if (!report.risk.enumerationComplete) process.exitCode = 1;
}

function cmdCache() {
  runCache({
    root: typeof flags.path === 'string' ? flags.path : process.cwd(),
    yes: Boolean(flags.yes || flags.y),
    json: Boolean(flags.json),
  });
}

function parseSessionPidFlag() {
  if (flags['session-pid'] === undefined) return null;
  if (flags['session-pid'] === true || flags['session-pid'] === '') {
    console.error(c('red', '  --session-pid must be a positive integer'));
    process.exit(1);
  }
  const pid = Number(flags['session-pid']);
  if (Number.isInteger(pid) && pid > 0) return pid;
  console.error(c('red', '  --session-pid must be a positive integer'));
  process.exit(1);
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
  ${bold('zclean')} — AI coding runtime hygiene for agent sessions

  ${bold('Usage:')}
    zclean                Scan for zombies (dry-run)
    zclean --yes          Scan and kill zombies
    zclean init           Install hooks + scheduler
    zclean status         Show current zombies and last cleanup
    zclean logs           Show recent cleanup history
    zclean history [--json]       Show cleanup history
    zclean protect list [--json]  Show protected whitelist entries
    zclean protect add <entry>    Add a whitelist entry
    zclean protect remove <entry|--index=N>
                          Remove a whitelist entry
    zclean uninstall      Remove hooks + scheduler
    zclean config         Show current configuration
    zclean doctor [--json]        Check if zclean is properly set up
    zclean report [--json] Show AI runtime hygiene report
    zclean audit [--json]  Alias for report
    zclean cache [--json]  Show safe workspace cache candidates
    zclean cache --yes     Remove supported workspace cache directories

  ${bold('Options:')}
    --yes, -y             Kill found zombies (default: dry-run)
    --session-pid=PID     Filter by parent session PID
    --path=DIR            Workspace path for zclean cache
    --json                Print machine-readable output for supported commands
    --version, -v         Show version
    --help, -h            Show this help

  ${bold('Config:')}  ~/.zclean/config.json
  ${bold('Logs:')}    ~/.zclean/history.jsonl

  ${bold('Docs:')}    https://github.com/TheStack-ai/zclean
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

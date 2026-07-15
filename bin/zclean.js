#!/usr/bin/env node
'use strict';

const os = require('os');
const { scan, hasScanErrors } = require('../src/scanner');
const { killZombies } = require('../src/killer');
const {
  loadConfig,
  readLogs,
  pruneLogs,
  appendLog,
  getCumulativeStats,
  getConfigFile,
} = require('../src/config');
const { reportDryRun, reportKill, reportStatus, reportLogs, reportConfig, c, bold } = require('../src/reporter');
const { removeHook } = require('../src/installer/hook');
const { runHistory, runProtect } = require('../src/commands/trust');
const { uninstallScheduler } = require('../src/commands/scheduler');
const { runDoctor } = require('../src/doctor');
const { runAudit } = require('../src/audit');
const { runCacheCommand } = require('../src/cache');
const { getCustomPatternError, normalizeCustomPattern } = require('../src/detector/patterns');
const { runInit } = require('../src/commands/init');

// Platform-specific installers (lazy loaded)
const platform = os.platform();

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (const arg of args) {
  if (arg.startsWith('--')) {
    const body = arg.substring(2);
    const separator = body.indexOf('=');
    const key = separator === -1 ? body : body.slice(0, separator);
    flags[key] = separator === -1 ? true : body.slice(separator + 1);
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
      if (!validateInitArguments()) return;
      return runInit({ config, platform });

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
      process.exitCode = runCacheCommand(flags).exitCode;
      return;

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
  const scanConfig = withPatternFlag(config);
  if (!scanConfig) return;
  const sessionPid = parseSessionPidFlag();
  const force = flags.yes || flags.y;

  console.log(bold('\n  zclean') + c('gray', ' — scanning for zombie processes...\n'));

  const zombies = scan(scanConfig, { sessionPid });

  if (hasScanErrors(zombies)) {
    reportDryRun(zombies);
    appendLog({ action: 'scan-failed', errors: zombies.errors.length });
    pruneLogs(scanConfig);
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
    const results = killZombies(zombies, scanConfig);
    results.cumulative = getCumulativeStats();
    reportKill(results);
  } else {
    // Dry-run mode
    if (scanConfig.dryRunDefault === false) {
      console.log(c('yellow', '  dryRunDefault=false is not an auto-kill switch; pass --yes to clean.\n'));
    }
    reportDryRun(zombies);
    if (zombies.length > 0) {
      appendLog({ action: 'dry-run', found: zombies.length });
    }
  }

  // Prune old logs
  pruneLogs(scanConfig);
}

/**
 * status: Show current zombies and last cleanup info.
 */
function cmdStatus(config) {
  const scanConfig = withPatternFlag(config);
  if (!scanConfig) return;
  const zombies = scan(scanConfig);
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
 * uninstall: Remove the scheduler and an exact legacy zclean hook, if present.
 */
function cmdUninstall() {
  console.log(bold('\n  zclean uninstall') + c('gray', ' — removing scheduler and legacy zclean integration...\n'));

  // Remove hook
  const hookResult = removeHook();
  console.log(`  Legacy hook: ${hookResult.message}`);
  if (hookResult.state === 'error') process.exitCode = 1;

  // Remove scheduler
  uninstallScheduler(platform);

  console.log(c('gray', `\n  Config and logs preserved at ~/.zclean/`));
  console.log(c('gray', `  To fully remove: rm -rf ~/.zclean\n`));
}

function validateInitArguments() {
  const unsupportedFlag = Object.keys(flags)[0];
  if (unsupportedFlag) {
    console.error(c('red', `  Unsupported option for zclean init: --${unsupportedFlag}`));
    process.exitCode = 1;
    return false;
  }
  if (positional.length > 1) {
    console.error(c('red', `  Unsupported argument for zclean init: ${positional[1]}`));
    process.exitCode = 1;
    return false;
  }
  return true;
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
  const scanConfig = withPatternFlag(config);
  if (!scanConfig) return;
  const sessionPid = parseSessionPidFlag();
  const report = runAudit(scanConfig, { json: Boolean(flags.json), sessionPid, commandName });
  if (!report.risk.enumerationComplete) process.exitCode = 1;
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

function withPatternFlag(config) {
  if (flags.pattern === undefined) return config;
  const error = getCustomPatternError(flags.pattern);
  if (error) {
    console.error(c('red', `  ${error}`));
    process.exitCode = 1;
    return null;
  }
  const literal = normalizeCustomPattern(flags.pattern);
  const configured = Array.isArray(config.customPatterns) ? config.customPatterns : [];
  return { ...config, customPatterns: [...configured, literal] };
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
  ${bold('zclean')} — AI coding runtime hygiene for agent sessions

  ${bold('Usage:')}
    zclean                Scan for zombies (dry-run)
    zclean --yes          Kill only cleanupEligible confirmed-stale candidates
    zclean init           Create config + hourly read-only audit scheduler
    zclean status         Show current zombies and last cleanup
    zclean logs           Show recent cleanup history
    zclean history [--json]       Show cleanup history
    zclean protect list [--json]  Show protected whitelist entries
    zclean protect add <entry>    Add a whitelist entry
    zclean protect remove <entry|--index=N>
                          Remove a whitelist entry
    zclean uninstall      Remove scheduler + exact legacy zclean hook
    zclean config         Show current configuration
    zclean doctor [--json]        Check if zclean is properly set up
    zclean report [--json] Show AI runtime hygiene report
    zclean audit [--json]  Alias for report
    zclean cache [--json]  Show safe workspace cache candidates
    zclean cache --yes     Remove supported workspace cache directories

  ${bold('Options:')}
    --yes, -y             Kill only cleanupEligible confirmed-stale candidates
    --session-pid=PID     Filter by parent session PID
    --pattern=TEXT        Add a literal orphan-process pattern
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

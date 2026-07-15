'use strict';

const { sanitizeTerminalText } = require('./terminal-text');
const { normalizeProvider, toPublicRuntimeMetadata } = require('./runtime-classifier');

/**
 * ANSI color codes — no external dependencies.
 */
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// Disable colors if NO_COLOR env is set or not a TTY
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

function c(color, text) {
  if (!useColor) return text;
  return `${C[color]}${text}${C.reset}`;
}

function bold(text) {
  if (!useColor) return text;
  return `${C.bold}${text}${C.reset}`;
}

/**
 * Format bytes into human-readable string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  return `${val} ${units[i]}`;
}

/**
 * Format milliseconds into human-readable duration.
 */
function formatDuration(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Truncate a string to maxLen, adding ellipsis if needed.
 */
function truncate(str, maxLen = 80) {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

function getDiagnostics(result) {
  return {
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    errors: Array.isArray(result?.errors) ? result.errors : [],
  };
}

function formatDiagnostic(item) {
  if (!item || typeof item !== 'object') return 'process scan diagnostic';
  const code = /^[a-z0-9-]{1,64}$/i.test(String(item.code || ''))
    ? `${String(item.code).toLowerCase()}: `
    : '';
  const providerValues = Array.isArray(item.providers)
    ? item.providers
    : item.provider ? [item.provider] : [];
  const providers = providerValues.length > 0
    ? ` (providers: ${[...new Set(providerValues.map(normalizeProvider))].join(', ')})`
    : '';
  return `${code}process scan diagnostic${providers}`;
}

function reportScanDiagnostics(result) {
  const { warnings, errors } = getDiagnostics(result);

  if (warnings.length > 0) {
    console.log(c('yellow', '  Scan warnings:'));
    for (const warning of warnings) {
      console.log(`    ${formatDiagnostic(warning)}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(c('red', '  Process enumeration failed. Scan results are incomplete.'));
    for (const error of errors) {
      console.log(`    ${formatDiagnostic(error)}`);
    }
    console.log();
    return true;
  }

  return false;
}

/**
 * Report dry-run scan results.
 */
function reportDryRun(zombies) {
  if (reportScanDiagnostics(zombies)) {
    console.log(c('yellow', '  Cleanup skipped because zclean could not inspect the process list safely.\n'));
    return;
  }

  if (zombies.length === 0) {
    console.log(c('green', '  No zombie processes found. System is clean.'));
    return;
  }

  console.log(bold(`\n  Found ${c('yellow', String(zombies.length))} stale-runtime candidate${zombies.length === 1 ? '' : 's'}:\n`));

  const totalMem = zombies.reduce((sum, z) => sum + z.mem, 0);
  const candidates = zombies.map((candidate) => ({
    candidate,
    runtime: toPublicRuntimeMetadata(candidate),
  }));
  const eligible = candidates.filter((item) => item.runtime.cleanupEligible);
  const eligibleMem = eligible.reduce((sum, item) => sum + (item.candidate.mem || 0), 0);

  for (const { candidate, runtime } of candidates) {
    console.log(`  ${c('red', 'PID')} ${c('bold', String(candidate.pid).padStart(6))}  ${c('cyan', runtime.provider.padEnd(12))}  ${runtime.classification.padEnd(15)}  ${c('yellow', formatBytes(candidate.mem).padStart(8))}  ${c('gray', formatDuration(candidate.age).padStart(6))}`);
    console.log(`  ${c('gray', '  confidence:')} ${runtime.confidence.level} (${runtime.confidence.score}/100)`);
    console.log(`  ${c('gray', '  evidence:')} ${runtime.evidence.join(', ') || 'none'}`);
    if (!runtime.cleanupEligible) {
      console.log(`  ${c('gray', '  blocked:')} ${runtime.blockedReasons.join(', ')}`);
    }
    console.log();
  }

  console.log(c('yellow', `  Candidate memory: ${formatBytes(totalMem)}`));
  console.log(c('yellow', `  Eligible: ${eligible.length}; blocked: ${candidates.length - eligible.length}; eligible memory: ${formatBytes(eligibleMem)}`));
  if (eligible.length > 0) {
    console.log(c('gray', `\n  Run ${c('white', 'zclean --yes')} to clean up eligible candidates.\n`));
  } else {
    console.log(c('gray', '\n  No candidates currently pass all cleanup safety gates.\n'));
  }
}

/**
 * Report kill results.
 */
function reportKill(results) {
  const { killed, failed, skipped, warning } = results;

  if (killed.length === 0 && failed.length === 0 && skipped.length === 0) {
    console.log(c('green', '  No zombie processes to clean.'));
    return;
  }

  console.log();

  if (warning) {
    console.log(c('yellow', `  ${warning}`));
    console.log();
  }

  if (killed.length > 0) {
    const totalMem = killed.reduce((sum, p) => sum + p.mem, 0);
    console.log(c('green', `  Killed ${killed.length} zombie process${killed.length === 1 ? '' : 'es'}:`));
    for (const p of killed) {
      console.log(`    ${c('green', 'KILLED')} PID ${String(p.pid).padStart(6)}  ${truncate(p.name, 16).padEnd(16)}  ${formatBytes(p.mem).padStart(8)}`);
    }
    console.log(c('green', `\n  Memory freed: ${formatBytes(totalMem)}`));

    // Show cumulative stats if available
    if (results.cumulative) {
      const s = results.cumulative;
      console.log(c('gray', `  This week: ${s.weekKilled} cleaned, ${formatBytes(s.weekMemFreed)} freed`));
      console.log(c('gray', `  All time:  ${s.totalKilled} cleaned, ${formatBytes(s.totalMemFreed)} freed`));
    }
  }

  if (skipped.length > 0) {
    console.log(c('yellow', `\n  Skipped ${skipped.length} (re-verification failed):`));
    for (const p of skipped) {
      console.log(`    ${c('yellow', 'SKIP')}   PID ${String(p.pid).padStart(6)}  ${truncate(p.name, 16).padEnd(16)}  reason: ${sanitizeTerminalText(p.skipReason)}`);
    }
  }

  if (failed.length > 0) {
    console.log(c('red', `\n  Failed to kill ${failed.length}:`));
    for (const p of failed) {
      console.log(`    ${c('red', 'FAIL')}   PID ${String(p.pid).padStart(6)}  ${truncate(p.name, 16).padEnd(16)}  error: ${sanitizeTerminalText(p.error)}`);
    }
  }

  console.log();
}

/**
 * Report current status (for `zclean status`).
 */
function reportStatus(zombies, logs) {
  console.log(bold('\n  zclean status\n'));

  // Current zombies
  if (reportScanDiagnostics(zombies)) {
    console.log(c('red', '  Current zombies: unknown'));
  } else if (zombies.length === 0) {
    console.log(c('green', '  Current zombies: 0'));
  } else {
    console.log(c('yellow', `  Current zombies: ${zombies.length}`));
    const totalMem = zombies.reduce((sum, z) => sum + z.mem, 0);
    console.log(c('yellow', `  Memory held:     ${formatBytes(totalMem)}`));
  }

  // Last cleanup
  const lastCleanup = logs.filter((l) => l.action === 'cleanup-summary').pop();
  if (lastCleanup) {
    console.log(`  Last cleanup:    ${c('gray', lastCleanup.timestamp)}`);
    console.log(`    Killed:        ${lastCleanup.killed}`);
    console.log(`    Memory freed:  ${formatBytes(lastCleanup.totalMemFreed || 0)}`);
  } else {
    console.log(c('gray', '  Last cleanup:    never'));
  }

  console.log();
}

/**
 * Report recent logs (for `zclean logs`).
 */
function reportLogs(logs) {
  if (logs.length === 0) {
    console.log(c('gray', '  No cleanup history yet.\n'));
    return;
  }

  console.log(bold('\n  Recent cleanup history\n'));

  for (const entry of logs.slice(-20)) {
    const time = c('gray', entry.timestamp.replace('T', ' ').substring(0, 19));

    switch (entry.action) {
      case 'kill':
        console.log(`  ${time}  ${c('green', 'KILL')}  PID ${String(entry.pid).padStart(6)}  ${(entry.name || '').padEnd(16)}  ${formatBytes(entry.memFreed || 0)}`);
        break;
      case 'kill-failed':
        console.log(`  ${time}  ${c('red', 'FAIL')}  PID ${String(entry.pid).padStart(6)}  ${(entry.name || '').padEnd(16)}  ${sanitizeTerminalText(entry.error || '')}`);
        break;
      case 'cleanup-summary':
        console.log(`  ${time}  ${c('cyan', 'DONE')}  killed:${entry.killed} failed:${entry.failed} skipped:${entry.skipped}  freed:${formatBytes(entry.totalMemFreed || 0)}`);
        break;
      default:
        console.log(`  ${time}  ${c('gray', entry.action)}`);
    }
  }

  console.log();
}

/**
 * Report current config (for `zclean config`).
 */
function reportConfig(config, configPath) {
  console.log(bold('\n  zclean config\n'));
  console.log(`  Config file: ${c('gray', configPath)}`);
  console.log();

  for (const [key, value] of Object.entries(config)) {
    const displayValue = Array.isArray(value)
      ? (value.length === 0 ? '[]' : JSON.stringify(value))
      : String(value);
    console.log(`  ${c('cyan', key.padEnd(20))} ${sanitizeTerminalText(displayValue)}`);
  }

  console.log();
}

module.exports = {
  reportDryRun,
  reportKill,
  reportStatus,
  reportLogs,
  reportConfig,
  reportScanDiagnostics,
  formatBytes,
  formatDuration,
  C,
  c,
  bold,
};

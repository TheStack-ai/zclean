'use strict';

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

/**
 * Report dry-run scan results.
 */
function reportDryRun(zombies) {
  if (zombies.length === 0) {
    console.log(c('green', '  No zombie processes found. System is clean.'));
    return;
  }

  console.log(bold(`\n  Found ${c('yellow', String(zombies.length))} zombie process${zombies.length === 1 ? '' : 'es'}:\n`));

  const totalMem = zombies.reduce((sum, z) => sum + z.mem, 0);

  for (const z of zombies) {
    console.log(`  ${c('red', 'PID')} ${c('bold', String(z.pid).padStart(6))}  ${c('cyan', z.name.padEnd(16))}  ${c('yellow', formatBytes(z.mem).padStart(8))}  ${c('gray', formatDuration(z.age).padStart(6))}`);
    console.log(`  ${c('gray', '  cmd:')} ${truncate(z.cmd, 72)}`);
    console.log(`  ${c('gray', '  why:')} ${z.reason}`);
    console.log();
  }

  console.log(c('yellow', `  Total memory reclaimable: ${formatBytes(totalMem)}`));
  console.log(c('gray', `\n  Run ${c('white', 'zclean --yes')} to clean up these processes.\n`));
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
      console.log(`    ${c('green', 'KILLED')} PID ${String(p.pid).padStart(6)}  ${p.name.padEnd(16)}  ${formatBytes(p.mem).padStart(8)}`);
    }
    console.log(c('green', `\n  Memory freed: ${formatBytes(totalMem)}`));
  }

  if (skipped.length > 0) {
    console.log(c('yellow', `\n  Skipped ${skipped.length} (re-verification failed):`));
    for (const p of skipped) {
      console.log(`    ${c('yellow', 'SKIP')}   PID ${String(p.pid).padStart(6)}  ${p.name.padEnd(16)}  reason: ${p.skipReason}`);
    }
  }

  if (failed.length > 0) {
    console.log(c('red', `\n  Failed to kill ${failed.length}:`));
    for (const p of failed) {
      console.log(`    ${c('red', 'FAIL')}   PID ${String(p.pid).padStart(6)}  ${p.name.padEnd(16)}  error: ${p.error}`);
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
  if (zombies.length === 0) {
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
        console.log(`  ${time}  ${c('red', 'FAIL')}  PID ${String(entry.pid).padStart(6)}  ${(entry.name || '').padEnd(16)}  ${entry.error || ''}`);
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
    console.log(`  ${c('cyan', key.padEnd(20))} ${displayValue}`);
  }

  console.log();
}

module.exports = {
  reportDryRun,
  reportKill,
  reportStatus,
  reportLogs,
  reportConfig,
  formatBytes,
  formatDuration,
  C,
  c,
  bold,
};

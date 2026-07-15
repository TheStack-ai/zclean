'use strict';

const { appendLog } = require('./config');
const { killProcess, verifyProcess } = require('./process-kill');

/**
 * Safely kill a list of zombie processes.
 *
 * Before killing each process, re-verifies:
 *   1. PID still exists
 *   2. Process start time matches scan time
 *   3. Command line matches scan
 *
 * Kill sequence:
 *   macOS/Linux: SIGTERM -> wait -> SIGKILL
 *   Windows: taskkill -> wait -> taskkill /F
 *
 * @param {Array} zombies — array from scanner.scan()
 * @param {object} config — loaded config
 * @returns {{ killed: Array, failed: Array, skipped: Array }}
 */
function killZombies(zombies, config, dependencies = {}) {
  const verify = dependencies.verifyProcess || verifyProcess;
  const kill = dependencies.killProcess || killProcess;
  const log = dependencies.appendLog || appendLog;
  const timeout = (config.sigterm_timeout || 10) * 1000;
  const limit = config.maxKillBatch || 20;
  const results = { killed: [], failed: [], skipped: [], warning: null };

  const eligible = [];
  for (const proc of zombies) {
    if (proc.cleanupEligible === true && proc.classification === 'confirmed-stale') {
      eligible.push(proc);
    } else {
      results.skipped.push({ ...proc, skipReason: 'cleanup-ineligible' });
    }
  }

  let toKill = eligible;
  if (eligible.length > limit) {
    toKill = eligible.slice(0, limit);
    results.warning = `Found ${eligible.length} eligible zombies, killing ${limit}. Run again for remaining.`;
  }

  for (const proc of toKill) {
    // Re-verify before killing
    const verification = verify(proc);
    if (!verification.valid) {
      results.skipped.push({
        ...proc,
        skipReason: verification.reason,
      });
      continue;
    }

    // Attempt kill
    const killResult = kill(proc, timeout);

    if (killResult.success) {
      results.killed.push(proc);
      // Log for manual recovery
      log({
        action: 'kill',
        pid: proc.pid,
        name: proc.name,
        reason: proc.reason,
        memFreed: proc.mem,
      });
    } else {
      results.failed.push({
        ...proc,
        error: killResult.error,
      });
      log({
        action: 'kill-failed',
        pid: proc.pid,
        name: proc.name,
        error: killResult.error,
      });
    }
  }

  // Log summary
  log({
    action: 'cleanup-summary',
    total: zombies.length,
    killed: results.killed.length,
    failed: results.failed.length,
    skipped: results.skipped.length,
    limited: eligible.length > limit,
    totalMemFreed: results.killed.reduce((sum, p) => sum + p.mem, 0),
  });

  return results;
}

module.exports = { killZombies, verifyProcess, killProcess };

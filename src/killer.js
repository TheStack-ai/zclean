'use strict';

const { execSync } = require('child_process');
const os = require('os');
const { appendLog } = require('./config');
const { normalizePid, readWindowsProcess, windowsProcessExists } = require('./windows-processes');

const platform = os.platform();

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
function killZombies(zombies, config) {
  const timeout = (config.sigterm_timeout || 10) * 1000;
  const limit = config.maxKillBatch || 20;
  const results = { killed: [], failed: [], skipped: [], warning: null };

  // Rate limit: only kill up to maxKillBatch processes
  let toKill = zombies;
  if (zombies.length > limit) {
    toKill = zombies.slice(0, limit);
    results.warning = `Found ${zombies.length} zombies, killing ${limit}. Run again for remaining.`;
  }

  for (const proc of toKill) {
    if (proc.cleanupEligible !== true || proc.classification !== 'confirmed-stale') {
      results.skipped.push({
        ...proc,
        skipReason: 'cleanup-ineligible',
      });
      continue;
    }

    // Re-verify before killing
    const verification = verifyProcess(proc);
    if (!verification.valid) {
      results.skipped.push({
        ...proc,
        skipReason: verification.reason,
      });
      continue;
    }

    // Attempt kill
    const killResult = killProcess(proc.pid, timeout);

    if (killResult.success) {
      results.killed.push(proc);
      // Log for manual recovery
      appendLog({
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
      appendLog({
        action: 'kill-failed',
        pid: proc.pid,
        name: proc.name,
        error: killResult.error,
      });
    }
  }

  // Log summary
  appendLog({
    action: 'cleanup-summary',
    total: zombies.length,
    killed: results.killed.length,
    failed: results.failed.length,
    skipped: results.skipped.length,
    limited: zombies.length > limit,
    totalMemFreed: results.killed.reduce((sum, p) => sum + p.mem, 0),
  });

  return results;
}

/**
 * Re-verify a process before killing it.
 * Ensures we don't kill a recycled PID or wrong process.
 */
function verifyProcess(proc, options = {}) {
  const runtime = runtimeOptions(options);
  if (runtime.platform === 'win32') {
    return verifyProcessWindows(proc, runtime);
  }
  return verifyProcessUnix(proc, runtime);
}

function verifyProcessUnix(proc, runtime = runtimeOptions()) {
  const safePid = normalizePid(proc.pid);
  if (!safePid) return { valid: false, reason: 'invalid-pid' };

  try {
    // Check if PID still exists and get its command line
    const cmd = runtime.execSync(`ps -o command= -p ${safePid}`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!cmd) {
      return { valid: false, reason: 'process-gone' };
    }

    const scanCmd = normalizeCommand(proc.cmd);
    const currentCmd = normalizeCommand(cmd);
    if (scanCmd !== currentCmd) {
      return { valid: false, reason: 'cmd-mismatch' };
    }
    if (!matchesCustomLiteral(proc, currentCmd)) {
      return { valid: false, reason: 'pattern-mismatch' };
    }

    // Verify start time if available
    if (proc.startTime) {
      let lstart;
      try {
        lstart = runtime.execSync(`LC_ALL=C ps -o lstart= -p ${safePid}`, {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
      } catch {
        return { valid: false, reason: 'start-time-unverified' };
      }

      const scanStart = normalizeStartTime(proc.startTime);
      const currentStart = normalizeStartTime(lstart);
      if (!scanStart || !currentStart) {
        return { valid: false, reason: 'start-time-unverified' };
      }
      if (currentStart !== scanStart) {
        return { valid: false, reason: 'start-time-mismatch' };
      }
    }

    return { valid: true, reason: 'verified' };
  } catch {
    return { valid: false, reason: 'process-gone' };
  }
}

function verifyProcessWindows(proc, runtime = runtimeOptions({ platform: 'win32' })) {
  const current = readWindowsProcess(proc.pid, runtime);
  if (!current) {
    return { valid: false, reason: 'process-gone' };
  }

  const scanCmd = normalizeCommand(proc.cmd);
  const currentCmd = normalizeCommand(current.cmd);

  if (scanCmd !== currentCmd) {
    return { valid: false, reason: 'cmd-mismatch' };
  }
  if (!matchesCustomLiteral(proc, currentCmd)) {
    return { valid: false, reason: 'pattern-mismatch' };
  }

  if (proc.startTime) {
    const scanStart = normalizeStartTime(proc.startTime);
    const currentStart = normalizeStartTime(current.startTime);
    if (!scanStart || !currentStart) {
      return { valid: false, reason: 'start-time-unverified' };
    }
    if (currentStart !== scanStart) {
      return { valid: false, reason: 'start-time-mismatch' };
    }
  }

  return { valid: true, reason: 'verified' };
}

function matchesCustomLiteral(proc, currentCmd) {
  if (!proc.matchLiteral) return true;
  return String(currentCmd).toLowerCase().includes(String(proc.matchLiteral).toLowerCase());
}

function normalizeCommand(command) {
  return String(command ?? '').trim();
}

function normalizeStartTime(startTime) {
  const value = String(startTime ?? '').trim();
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Kill a process with graceful shutdown sequence.
 *
 * macOS/Linux: SIGTERM → wait → SIGKILL
 * Windows: taskkill → wait → taskkill /F
 */
function killProcess(pid, timeoutMs, options = {}) {
  const runtime = runtimeOptions(options);
  if (runtime.platform === 'win32') {
    return killProcessWindows(pid, timeoutMs, runtime);
  }
  return killProcessUnix(pid, timeoutMs, runtime);
}

function killProcessUnix(pid, timeoutMs, runtime = runtimeOptions()) {
  try {
    // Send SIGTERM
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Already dead
      return { success: true, method: 'already-dead' };
    }
    return { success: false, error: `SIGTERM failed: ${err.message}` };
  }

  // Wait for graceful shutdown
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // process.kill(pid, 0) throws if process doesn't exist
      process.kill(pid, 0);
      // Still alive — blocking sleep to avoid CPU spin
      try { runtime.execSync('sleep 0.5', { timeout: 2000 }); } catch { /* ignore */ }
    } catch {
      // Process is gone
      return { success: true, method: 'sigterm' };
    }
  }

  // Process survived SIGTERM — send SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
    return { success: true, method: 'sigkill' };
  } catch (err) {
    if (err.code === 'ESRCH') {
      return { success: true, method: 'died-during-kill' };
    }
    return { success: false, error: `SIGKILL failed: ${err.message}` };
  }
}

function killProcessWindows(pid, timeoutMs, runtime = runtimeOptions({ platform: 'win32' })) {
  const safePid = normalizePid(pid);
  if (!safePid) {
    return { success: false, error: `Invalid PID: ${pid}` };
  }

  try {
    // Graceful kill
    runtime.execSync(`taskkill /PID ${safePid}`, { encoding: 'utf-8', timeout: 5000 });
  } catch {
    // Might fail — try force kill directly
  }

  // Wait
  const deadline = runtime.now() + timeoutMs;
  while (runtime.now() < deadline) {
    const exists = windowsProcessExists(safePid, runtime);
    if (exists === false) {
      return { success: true, method: 'taskkill' };
    }
    if (exists === null) break;
    try { runtime.execSync('timeout /T 1 /NOBREAK >nul', { timeout: 3000 }); } catch { /* ignore */ }
  }

  // Force kill
  try {
    runtime.execSync(`taskkill /F /PID ${safePid}`, { encoding: 'utf-8', timeout: 5000 });
    return { success: true, method: 'taskkill-force' };
  } catch (err) {
    return { success: false, error: `Force kill failed: ${err.message}` };
  }
}

function runtimeOptions(options = {}) {
  return {
    execSync: options.execSync || execSync,
    platform: options.platform || platform,
    now: typeof options.now === 'function' ? options.now : () => Date.now(),
  };
}

module.exports = { killZombies, verifyProcess, killProcess };

'use strict';

const { execSync } = require('child_process');
const os = require('os');
const { appendLog } = require('./config');

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
        cmd: proc.cmd,
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
        cmd: proc.cmd,
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
function verifyProcess(proc) {
  if (platform === 'win32') {
    return verifyProcessWindows(proc);
  }
  return verifyProcessUnix(proc);
}

function verifyProcessUnix(proc) {
  try {
    // Check if PID still exists and get its command line
    const cmd = execSync(`ps -o command= -p ${proc.pid}`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!cmd) {
      return { valid: false, reason: 'process-gone' };
    }

    // Verify command line matches (at least partially)
    // Use first 50 chars to handle truncation
    const scanPrefix = proc.cmd.substring(0, 50);
    const currentPrefix = cmd.substring(0, 50);
    if (scanPrefix !== currentPrefix) {
      return { valid: false, reason: 'cmd-mismatch' };
    }

    // Verify start time if available
    if (proc.startTime) {
      try {
        const lstart = execSync(`ps -o lstart= -p ${proc.pid}`, {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
        const currentStart = new Date(lstart).toISOString();
        if (currentStart !== proc.startTime) {
          return { valid: false, reason: 'start-time-mismatch' };
        }
      } catch {
        // Can't verify start time — proceed with caution
      }
    }

    return { valid: true, reason: 'verified' };
  } catch {
    return { valid: false, reason: 'process-gone' };
  }
}

function verifyProcessWindows(proc) {
  try {
    const output = execSync(
      `wmic process where ProcessId=${proc.pid} get CommandLine /value`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    const match = output.match(/CommandLine=(.+)/);
    if (!match) {
      return { valid: false, reason: 'process-gone' };
    }

    const currentCmd = match[1].trim();
    const scanPrefix = proc.cmd.substring(0, 50);
    const currentPrefix = currentCmd.substring(0, 50);

    if (scanPrefix !== currentPrefix) {
      return { valid: false, reason: 'cmd-mismatch' };
    }

    return { valid: true, reason: 'verified' };
  } catch {
    return { valid: false, reason: 'process-gone' };
  }
}

/**
 * Kill a process with graceful shutdown sequence.
 *
 * macOS/Linux: SIGTERM → wait → SIGKILL
 * Windows: taskkill → wait → taskkill /F
 */
function killProcess(pid, timeoutMs) {
  if (platform === 'win32') {
    return killProcessWindows(pid, timeoutMs);
  }
  return killProcessUnix(pid, timeoutMs);
}

function killProcessUnix(pid, timeoutMs) {
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
      try { execSync('sleep 0.5', { timeout: 2000 }); } catch { /* ignore */ }
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

function killProcessWindows(pid, timeoutMs) {
  try {
    // Graceful kill
    execSync(`taskkill /PID ${pid}`, { encoding: 'utf-8', timeout: 5000 });
  } catch {
    // Might fail — try force kill directly
  }

  // Wait
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync(`wmic process where ProcessId=${pid} get ProcessId /value`, {
        encoding: 'utf-8',
        timeout: 3000,
      });
      // Still alive — blocking wait to avoid CPU spin
      try { execSync('timeout /T 1 /NOBREAK >nul', { timeout: 3000 }); } catch { /* ignore */ }
    } catch {
      return { success: true, method: 'taskkill' };
    }
  }

  // Force kill
  try {
    execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8', timeout: 5000 });
    return { success: true, method: 'taskkill-force' };
  } catch (err) {
    return { success: false, error: `Force kill failed: ${err.message}` };
  }
}

module.exports = { killZombies, verifyProcess, killProcess };

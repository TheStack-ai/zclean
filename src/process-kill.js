'use strict';

const { execSync } = require('child_process');
const os = require('os');
const {
  normalizePid,
  readWindowsProcess,
  windowsProcessExists,
} = require('./windows-processes');

const platform = os.platform();

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
    return {
      valid: false,
      reason: unixProcessIsGone(safePid, runtime)
        ? 'process-gone'
        : 'identity-query-failed',
    };
  }
}

function verifyProcessWindows(proc, runtime = runtimeOptions({ platform: 'win32' })) {
  let current;
  try {
    current = readWindowsProcess(proc.pid, runtime);
  } catch {
    return { valid: false, reason: 'identity-query-failed' };
  }
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

function unixProcessIsGone(pid, runtime) {
  try {
    runtime.kill(pid, 0);
    return false;
  } catch (err) {
    return err?.code === 'ESRCH';
  }
}

function killProcess(target, timeoutMs, options = {}) {
  const proc = target && typeof target === 'object' ? target : null;
  if (!proc) {
    return {
      success: false,
      error: 'Process identity is required before a destructive kill.',
    };
  }
  const runtime = runtimeOptions(options);
  const pid = proc.pid;
  if (runtime.platform === 'win32') {
    return killProcessWindows(pid, timeoutMs, runtime, proc);
  }
  return killProcessUnix(pid, timeoutMs, runtime, proc);
}

function killProcessUnix(pid, timeoutMs, runtime = runtimeOptions(), proc = null) {
  const safePid = normalizePid(pid);
  if (!safePid) return { success: false, error: `Invalid PID: ${pid}` };
  const initialIdentity = verifyDestructiveIdentity(proc, runtime);
  if (!initialIdentity.valid) return identityFailure('SIGTERM', initialIdentity);

  try {
    runtime.kill(safePid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      return { success: true, method: 'already-dead' };
    }
    return { success: false, error: `SIGTERM failed: ${err.message}` };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc) {
      const identity = verifyDestructiveIdentity(proc, runtime);
      if (identity.reason === 'process-gone') return { success: true, method: 'sigterm' };
      if (!identity.valid) return identityFailure('SIGKILL', identity);
    }
    try {
      runtime.kill(safePid, 0);
      try { runtime.execSync('sleep 0.5', { timeout: 2000 }); } catch {}
    } catch {
      return { success: true, method: 'sigterm' };
    }
  }

  const forceIdentity = verifyDestructiveIdentity(proc, runtime);
  if (!forceIdentity.valid) {
    if (forceIdentity.reason === 'process-gone') return { success: true, method: 'sigterm' };
    return identityFailure('SIGKILL', forceIdentity);
  }
  try {
    runtime.kill(safePid, 'SIGKILL');
    return { success: true, method: 'sigkill' };
  } catch (err) {
    if (err.code === 'ESRCH') {
      return { success: true, method: 'died-during-kill' };
    }
    return { success: false, error: `SIGKILL failed: ${err.message}` };
  }
}

function killProcessWindows(pid, timeoutMs, runtime = runtimeOptions({ platform: 'win32' }), proc = null) {
  const safePid = normalizePid(pid);
  if (!safePid) {
    return { success: false, error: `Invalid PID: ${pid}` };
  }

  const initialIdentity = verifyDestructiveIdentity(proc, runtime);
  if (!initialIdentity.valid) return identityFailure('taskkill', initialIdentity);

  try {
    runtime.execSync(`taskkill /PID ${safePid}`, { encoding: 'utf-8', timeout: 5000 });
  } catch {
  }

  const deadline = runtime.now() + timeoutMs;
  while (runtime.now() < deadline) {
    if (proc) {
      const identity = verifyDestructiveIdentity(proc, runtime);
      if (identity.reason === 'process-gone') return { success: true, method: 'taskkill' };
      if (!identity.valid) return identityFailure('taskkill /F', identity);
    }
    const exists = windowsProcessExists(safePid, runtime);
    if (exists === false) {
      return { success: true, method: 'taskkill' };
    }
    if (exists === null) break;
    try { runtime.execSync('timeout /T 1 /NOBREAK >nul', { timeout: 3000 }); } catch {}
  }

  const forceIdentity = verifyDestructiveIdentity(proc, runtime);
  if (!forceIdentity.valid) {
    if (forceIdentity.reason === 'process-gone') return { success: true, method: 'taskkill' };
    return identityFailure('taskkill /F', forceIdentity);
  }
  try {
    runtime.execSync(`taskkill /F /PID ${safePid}`, { encoding: 'utf-8', timeout: 5000 });
    return { success: true, method: 'taskkill-force' };
  } catch (err) {
    return { success: false, error: `Force kill failed: ${err.message}` };
  }
}

function verifyDestructiveIdentity(proc, runtime) {
  return proc ? verifyProcess(proc, runtime) : { valid: true, reason: 'not-requested' };
}

function identityFailure(action, verification) {
  return {
    success: false,
    error: `Process identity changed before ${action}: ${verification.reason}`,
  };
}

function runtimeOptions(options = {}) {
  return {
    execSync: options.execSync || execSync,
    kill: options.kill || process.kill.bind(process),
    platform: options.platform || platform,
    now: typeof options.now === 'function' ? options.now : () => Date.now(),
  };
}

module.exports = { killProcess, verifyProcess };

'use strict';

const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();

/**
 * Check if a PID is an orphan process.
 *
 * Orphan definition by platform:
 *   macOS:   PPID === 1 (launchd)
 *   Linux:   PPID === 1 OR PPID === systemd --user PID
 *   Windows: parent process no longer exists
 *
 * Returns { isOrphan: boolean, ppid: number|null, reason: string }
 */
function checkOrphan(pid) {
  try {
    if (platform === 'win32') {
      return checkOrphanWindows(pid);
    } else {
      return checkOrphanUnix(pid);
    }
  } catch {
    // Process may have disappeared during check
    return { isOrphan: false, ppid: null, reason: 'check-failed' };
  }
}

/**
 * Unix (macOS/Linux) orphan check.
 */
function checkOrphanUnix(pid) {
  let ppidStr;
  try {
    ppidStr = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return { isOrphan: false, ppid: null, reason: 'process-gone' };
  }

  const ppid = parseInt(ppidStr, 10);
  if (isNaN(ppid)) {
    return { isOrphan: false, ppid: null, reason: 'invalid-ppid' };
  }

  // macOS: PPID 1 means reparented to launchd
  if (platform === 'darwin' && ppid === 1) {
    return { isOrphan: true, ppid, reason: 'reparented-to-launchd' };
  }

  // Linux: PPID 1 means reparented to init/systemd
  if (platform === 'linux' && ppid === 1) {
    return { isOrphan: true, ppid, reason: 'reparented-to-init' };
  }

  // Linux: also check if reparented to systemd --user
  if (platform === 'linux' && ppid > 1) {
    try {
      const parentCmd = execSync(`ps -o comm= -p ${ppid}`, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (parentCmd === 'systemd') {
        return { isOrphan: true, ppid, reason: 'reparented-to-systemd-user' };
      }
    } catch {
      // Parent might have died between checks
    }
  }

  return { isOrphan: false, ppid, reason: 'has-parent' };
}

/**
 * Windows orphan check — parent process doesn't exist.
 */
function checkOrphanWindows(pid) {
  try {
    // Get parent PID via wmic
    const output = execSync(
      `wmic process where ProcessId=${pid} get ParentProcessId /value`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    const match = output.match(/ParentProcessId=(\d+)/);
    if (!match) {
      return { isOrphan: false, ppid: null, reason: 'no-ppid-info' };
    }

    const ppid = parseInt(match[1], 10);

    // Check if parent process still exists
    try {
      execSync(`wmic process where ProcessId=${ppid} get ProcessId /value`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return { isOrphan: false, ppid, reason: 'has-parent' };
    } catch {
      // Parent doesn't exist — orphan
      return { isOrphan: true, ppid, reason: 'parent-gone' };
    }
  } catch {
    return { isOrphan: false, ppid: null, reason: 'check-failed' };
  }
}

/**
 * Check if a process is inside a tmux or screen session tree.
 * Walks the process tree upward looking for tmux/screen ancestor.
 *
 * Returns true if the process has a tmux or screen ancestor.
 */
function isInTerminalMultiplexer(pid) {
  if (platform === 'win32') return false;

  const visited = new Set();
  let currentPid = pid;

  while (currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid);

    try {
      const info = execSync(`ps -o ppid=,comm= -p ${currentPid}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      // Parse "  PPID COMMAND"
      const parts = info.trim().split(/\s+/);
      if (parts.length < 2) break;

      const parentPid = parseInt(parts[0], 10);
      const comm = parts.slice(1).join(' ');

      // Check for tmux/screen
      if (/^(tmux|screen)/.test(comm)) {
        return true;
      }

      if (isNaN(parentPid) || parentPid <= 1) break;
      currentPid = parentPid;
    } catch {
      break;
    }
  }

  return false;
}

module.exports = { checkOrphan, isInTerminalMultiplexer };

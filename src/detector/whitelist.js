'use strict';

const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

const platform = os.platform();

// Daemon managers that indicate intentionally long-running processes
const DAEMON_MANAGERS = ['pm2', 'forever', 'supervisord', 'supervisor', 'nodemon'];

/**
 * Check if a process should be protected from cleanup.
 *
 * Protection criteria:
 *   1. In user's config whitelist (PID or name pattern)
 *   2. Has a daemon manager ancestor (pm2, forever, supervisord)
 *   3. Running inside a Docker container (Linux: different PID namespace)
 *   4. Launched with nohup
 *   5. VS Code child process (48h grace period)
 *
 * Returns { protected: boolean, reason: string }
 */
function isWhitelisted(proc, config) {
  // 1. Config whitelist — match by PID or name substring
  if (config.whitelist && config.whitelist.length > 0) {
    for (const entry of config.whitelist) {
      if (typeof entry === 'number' && proc.pid === entry) {
        return { protected: true, reason: `config-whitelist-pid:${entry}` };
      }
      if (typeof entry === 'string' && proc.cmd.includes(entry)) {
        return { protected: true, reason: `config-whitelist-pattern:${entry}` };
      }
    }
  }

  // 2. Daemon manager ancestor
  if (hasDaemonAncestor(proc.pid)) {
    return { protected: true, reason: 'daemon-managed' };
  }

  // 3. Docker container (Linux only)
  if (isInDocker(proc.pid)) {
    return { protected: true, reason: 'docker-container' };
  }

  // 4. nohup-launched
  if (isNohup(proc.cmd)) {
    return { protected: true, reason: 'nohup-launched' };
  }

  // 5. VS Code child with grace period
  const vscodeGrace = 48 * 60 * 60 * 1000; // 48 hours
  if (isVSCodeChild(proc.pid) && proc.age < vscodeGrace) {
    return { protected: true, reason: 'vscode-child-grace' };
  }

  return { protected: false, reason: '' };
}

/**
 * Walk process tree upward looking for daemon manager ancestors.
 */
function hasDaemonAncestor(pid) {
  if (platform === 'win32') {
    // Simplified check for Windows — just check parent command
    try {
      const output = execSync(
        `wmic process where ProcessId=${pid} get ParentProcessId /value`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      const match = output.match(/ParentProcessId=(\d+)/);
      if (!match) return false;
      const ppid = parseInt(match[1], 10);
      const parentCmd = execSync(
        `wmic process where ProcessId=${ppid} get CommandLine /value`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      return DAEMON_MANAGERS.some((dm) => parentCmd.toLowerCase().includes(dm));
    } catch {
      return false;
    }
  }

  // Unix: walk up the tree
  const visited = new Set();
  let currentPid = pid;

  while (currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid);
    try {
      const info = execSync(`ps -o ppid=,comm= -p ${currentPid}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      const parts = info.trim().split(/\s+/);
      if (parts.length < 2) break;

      const parentPid = parseInt(parts[0], 10);
      const comm = parts.slice(1).join(' ').toLowerCase();

      if (DAEMON_MANAGERS.some((dm) => comm.includes(dm))) {
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

/**
 * Check if a process is running inside a Docker container.
 * Linux only: compares PID namespace with init (PID 1).
 */
function isInDocker(pid) {
  if (platform !== 'linux') return false;

  try {
    const procNs = fs.readlinkSync(`/proc/${pid}/ns/pid`);
    const initNs = fs.readlinkSync('/proc/1/ns/pid');
    return procNs !== initNs;
  } catch {
    return false;
  }
}

/**
 * Check if the command line suggests nohup launch.
 */
function isNohup(cmdline) {
  return /\bnohup\b/.test(cmdline);
}

/**
 * Check if a process is a child of VS Code.
 */
function isVSCodeChild(pid) {
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

      const parts = info.trim().split(/\s+/);
      if (parts.length < 2) break;

      const parentPid = parseInt(parts[0], 10);
      const comm = parts.slice(1).join(' ').toLowerCase();

      // VS Code process names: code, code-insiders, electron (Code.app)
      if (/\b(code|code-insiders|electron.*code)\b/.test(comm)) {
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

module.exports = { isWhitelisted, hasDaemonAncestor, isInDocker, isNohup, isVSCodeChild };

'use strict';

const fs = require('fs');
const os = require('os');

const platform = os.platform();

// Daemon managers that indicate intentionally long-running processes
const DAEMON_MANAGERS = ['pm2', 'forever', 'supervisord', 'supervisor', 'nodemon'];

/**
 * Check if a process should be protected from cleanup.
 *
 * Now tree-aware: ancestor checks use ProcessTree instead of per-process execSync.
 *
 * @param {object} proc — process info from tree
 * @param {object} config — zclean config
 * @param {import('../process-tree').ProcessTree} [tree] — in-memory process tree
 * @returns {{ protected: boolean, reason: string }}
 */
function isWhitelisted(proc, config, tree) {
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

  // 2. Daemon manager ancestor (tree-based, no execSync)
  if (tree && hasDaemonAncestorTree(proc.pid, tree)) {
    return { protected: true, reason: 'daemon-managed' };
  }

  // 3. Docker container (Linux only — reads /proc, no tree needed)
  if (isInDocker(proc.pid)) {
    return { protected: true, reason: 'docker-container' };
  }

  // 4. nohup-launched
  if (isNohup(proc.cmd)) {
    return { protected: true, reason: 'nohup-launched' };
  }

  // 5. VS Code child with grace period (tree-based)
  const vscodeGrace = 48 * 60 * 60 * 1000; // 48 hours
  if (tree && isVSCodeChildTree(proc.pid, tree) && proc.age < vscodeGrace) {
    return { protected: true, reason: 'vscode-child-grace' };
  }

  return { protected: false, reason: '' };
}

/**
 * Check for daemon manager ancestor via ProcessTree.
 */
function hasDaemonAncestorTree(pid, tree) {
  return tree.hasAncestorMatching(pid, (proc) => {
    const comm = proc.cmd.split(/\s+/)[0].split('/').pop().toLowerCase();
    return DAEMON_MANAGERS.some((dm) => comm.includes(dm));
  });
}

/**
 * Check if running inside a Docker container (Linux only).
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
 * Check for VS Code ancestor via ProcessTree.
 */
function isVSCodeChildTree(pid, tree) {
  return tree.hasAncestorMatching(pid, (proc) => {
    const comm = proc.cmd.split(/\s+/)[0].split('/').pop().toLowerCase();
    return /\b(code|code-insiders|electron.*code)\b/.test(comm);
  });
}

module.exports = { isWhitelisted, isInDocker, isNohup };

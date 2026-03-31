'use strict';

/**
 * Orphan detection — now a thin wrapper around ProcessTree.
 *
 * scanner.js uses ProcessTree directly. This module is kept for
 * backward compatibility if external code imports checkOrphan().
 */

const { ProcessTree } = require('../process-tree');

/**
 * Check if a PID is an orphan process.
 * Builds a fresh ProcessTree — prefer tree.isOrphan(pid) in hot paths.
 *
 * @param {number} pid
 * @returns {{ isOrphan: boolean, ppid: number|null, reason: string }}
 */
function checkOrphan(pid) {
  const tree = ProcessTree.build();
  return tree.isOrphan(pid);
}

/**
 * Check if a PID is inside a terminal multiplexer (tmux/screen).
 * Builds a fresh ProcessTree — prefer tree.hasAncestorMatching() in hot paths.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isInTerminalMultiplexer(pid) {
  const tree = ProcessTree.build();
  return tree.hasAncestorMatching(pid, (proc) => {
    const comm = proc.cmd.split(/\s+/)[0].split('/').pop();
    return comm === 'tmux' || comm === 'screen';
  });
}

module.exports = { checkOrphan, isInTerminalMultiplexer };

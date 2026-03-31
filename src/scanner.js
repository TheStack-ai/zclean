'use strict';

const { ProcessTree } = require('./process-tree');
const { matchPattern, AI_DIR_REGEX, buildAiDirRegex } = require('./detector/patterns');
const { isWhitelisted } = require('./detector/whitelist');
const { parseDuration, parseMemory } = require('./config');

/**
 * Scan for zombie/orphan processes left by AI coding tools.
 *
 * Uses ProcessTree for all process data — single ps/wmic call,
 * zero execSync during scan loop.
 *
 * @param {object} config — loaded zclean config
 * @param {object} opts — { sessionPid?: number }
 * @returns {Array<{pid, name, cmd, ppid, mem, age, startTime, reason, pattern}>}
 */
function scan(config, opts = {}) {
  const tree = ProcessTree.build();
  const aiDirRegex = buildAiDirRegex(config.customAiDirs);
  const zombies = [];

  // Multiplexer detection function for tree queries
  const isMultiplexer = (proc) => {
    const comm = proc.cmd.split(/\s+/)[0].split('/').pop();
    return comm === 'tmux' || comm === 'screen';
  };

  // Iterate all processes in the tree
  for (const [, proc] of tree.byPid) {
    // Match against known AI tool patterns
    const pattern = matchPattern(proc.cmd, config);
    if (!pattern) continue;

    // AI path filter: skip generic patterns if command isn't in an AI tool directory
    if (pattern.aiPathRequired && !aiDirRegex.test(proc.cmd)) continue;

    // Check orphan status via tree (no execSync)
    const orphanResult = tree.isOrphan(proc.pid);

    // If pattern requires orphan status and process isn't orphaned, skip
    if (pattern.orphanOnly && !orphanResult.isOrphan) continue;

    // tmux/screen protection — but NOT for orphans (PPID=1).
    // If a process is orphaned, it's already detached from any tmux session,
    // so the multiplexer check is irrelevant. This fixes the tmux orphan bug.
    if (!orphanResult.isOrphan && tree.hasAncestorMatching(proc.pid, isMultiplexer)) continue;

    // Check whitelist (now tree-aware — no execSync)
    const whitelistResult = isWhitelisted(proc, config, tree);
    if (whitelistResult.protected) continue;

    // Check maxOrphanAge if defined on the pattern
    if (pattern.maxOrphanAge) {
      const maxAge = parseDuration(pattern.maxOrphanAge);
      if (maxAge && proc.age < maxAge) continue;
    }

    // Check memory threshold for node-ai-path pattern
    if (pattern.memThreshold) {
      const threshold = parseMemory(pattern.memThreshold);
      if (threshold && proc.mem < threshold) {
        // Also check if age exceeds maxOrphanAge
        if (pattern.maxOrphanAge) {
          const maxAge = parseDuration(pattern.maxOrphanAge);
          if (maxAge && proc.age < maxAge) continue;
        } else {
          continue;
        }
      }
    }

    // Session affinity via tree (no execSync)
    if (opts.sessionPid) {
      proc.sessionRelated = tree.hasAncestorMatching(proc.pid, (p) => p.pid === opts.sessionPid);
    }

    // Build reason string
    const reasons = [];
    reasons.push(`pattern:${pattern.name}`);
    if (orphanResult.isOrphan) reasons.push(`orphan:${orphanResult.reason}`);
    if (proc.age > parseDuration(config.maxAge || '24h')) reasons.push('age-exceeded');
    if (parseMemory(config.memoryThreshold) && proc.mem > parseMemory(config.memoryThreshold)) {
      reasons.push('memory-exceeded');
    }

    zombies.push({
      pid: proc.pid,
      name: pattern.name,
      cmd: proc.cmd,
      ppid: orphanResult.ppid,
      mem: proc.mem || 0,
      age: proc.age,
      startTime: proc.startTime,
      reason: reasons.join(', '),
      pattern: pattern.name,
    });
  }

  return zombies;
}

module.exports = { scan };

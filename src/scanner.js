'use strict';

const { ProcessTree } = require('./process-tree');
const { createPatternMatcher, AI_DIR_REGEX, buildAiDirRegex } = require('./detector/patterns');
const { isWhitelisted } = require('./detector/whitelist');
const { parseDuration, parseMemory } = require('./config');
const { classifyRuntimeCandidate } = require('./runtime-classifier');

/**
 * Scan for zombie/orphan processes left by AI coding tools.
 *
 * Uses ProcessTree for all process data — single ps/wmic call,
 * zero execSync during scan loop.
 *
 * @param {object} config — loaded zclean config
 * @param {object} opts — { sessionPid?: number }
 * @returns {Array<{pid, name, cmd, ppid, mem, age, startTime, reason, pattern, provider, classification, confidence, evidence, cleanupEligible, blockedReasons}>}
 */
function scan(config, opts = {}) {
  const tree = opts.tree || ProcessTree.build();
  const aiDirRegex = buildAiDirRegex(config.customAiDirs);
  const matchConfiguredPattern = createPatternMatcher(config);
  const zombies = [];
  const warnings = Array.isArray(tree.warnings) ? [...tree.warnings] : [];
  const errors = Array.isArray(tree.errors) ? [...tree.errors] : [];
  const sessionPid = normalizePid(opts.sessionPid);
  const session = sessionPid
    ? { pid: sessionPid, filtered: true, matched: 0, excluded: 0, unattributed: 0 }
    : null;

  // Multiplexer detection function for tree queries
  const isMultiplexer = (proc) => {
    const comm = proc.cmd.split(/\s+/)[0].split('/').pop();
    return comm === 'tmux' || comm === 'screen';
  };

  // Iterate all processes in the tree
  for (const [, proc] of tree.byPid) {
    // Match against known AI tool patterns
    const pattern = matchConfiguredPattern(proc.cmd);
    if (!pattern) continue;

    // AI path filter: skip generic patterns if command isn't in an AI tool directory
    if (pattern.aiPathRequired && !aiDirRegex.test(proc.cmd)) continue;

    // Check orphan status via tree (no execSync)
    const orphanResult = tree.isOrphan(proc.pid);
    const sessionRelated = sessionPid
      ? tree.hasAncestorMatching(proc.pid, (p) => p.pid === sessionPid)
      : false;

    if (sessionRelated && !orphanResult.isOrphan) {
      session.excluded++;
      continue;
    }

    if (pattern.strictOrphan && !orphanResult.isOrphan) continue;

    // If pattern requires orphan status and process isn't orphaned, skip
    if (pattern.orphanOnly && !orphanResult.isOrphan) continue;

    if (sessionPid && !sessionRelated) {
      if (orphanResult.isOrphan) {
        session.unattributed++;
      } else {
        session.excluded++;
      }
      continue;
    }
    if (sessionRelated) session.matched++;

    // tmux/screen protection — but NOT for orphans (PPID=1).
    // If a process is orphaned, it's already detached from any tmux session,
    // so the multiplexer check is irrelevant. This fixes the tmux orphan bug.
    if (!orphanResult.isOrphan && tree.hasAncestorMatching(proc.pid, isMultiplexer)) continue;

    // Check whitelist (now tree-aware — no execSync)
    const whitelistResult = isWhitelisted(proc, config, tree);
    if (whitelistResult.protected) continue;

    const threshold = evaluateThresholds(pattern, config, proc);
    if (!threshold.passed) continue;

    const runtimeClassification = classifyRuntimeCandidate({
      pattern,
      command: proc.cmd,
      customAiDirs: config.customAiDirs,
      orphan: orphanResult.isOrphan,
      orphanReason: orphanResult.reason,
      age: proc.age,
      ageGraceMs: threshold.ageGraceMs,
      startTime: proc.startTime,
    });

    // Build reason string
    const reasons = [];
    reasons.push(`pattern:${pattern.name}`);
    if (sessionRelated) reasons.push(`session-pid:${sessionPid}`);
    if (orphanResult.isOrphan) reasons.push(`orphan:${orphanResult.reason}`);
    if (threshold.ageExceeded) reasons.push('age-exceeded');
    if (threshold.memoryExceeded) reasons.push('memory-exceeded');

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
      matchLiteral: pattern.literal || null,
      ...runtimeClassification,
    });
  }

  if (session && session.unattributed > 0) {
    warnings.push({
      code: 'session-attribution-gap',
      sessionPid,
      count: session.unattributed,
      message: `${session.unattributed} candidate process${session.unattributed === 1 ? '' : 'es'} could not be proven related to session PID ${sessionPid}`,
    });
  }

  return attachDiagnostics(zombies, { warnings, errors, session });
}

function normalizePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function evaluateThresholds(pattern, config, proc) {
  const maxAgeValue = getPatternMaxAge(pattern, config);
  const memoryValue = getPatternMemoryThreshold(pattern, config);
  const maxAge = maxAgeValue ? parseDuration(maxAgeValue) : null;
  const memoryThreshold = memoryValue ? parseMemory(memoryValue) : null;
  const ageExceeded = Boolean(maxAge && proc.age >= maxAge);
  const memoryExceeded = Boolean(memoryThreshold && proc.mem >= memoryThreshold);

  let passed = true;
  if (maxAge && memoryThreshold) passed = ageExceeded || memoryExceeded;
  else if (maxAge) passed = ageExceeded;
  else if (memoryThreshold) passed = memoryExceeded;

  return {
    passed,
    ageExceeded,
    memoryExceeded,
    ageGraceMs: maxAge,
  };
}

function getPatternMaxAge(pattern, config) {
  if (!pattern.maxOrphanAge) return null;
  if (pattern.aiPathRequired && config.maxAge) return config.maxAge;
  return pattern.maxOrphanAge;
}

function getPatternMemoryThreshold(pattern, config) {
  if (!pattern.memThreshold) return null;
  return config.memoryThreshold || pattern.memThreshold;
}

function attachDiagnostics(zombies, diagnostics) {
  zombies.warnings = diagnostics.warnings || [];
  zombies.errors = diagnostics.errors || [];
  zombies.enumerationFailed = hasScanErrors(zombies);
  if (diagnostics.session) zombies.session = diagnostics.session;
  return zombies;
}

function hasScanErrors(result) {
  return Array.isArray(result?.errors) && result.errors.length > 0;
}

module.exports = { scan, hasScanErrors };

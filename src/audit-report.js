'use strict';

const { hasScanErrors } = require('./scanner');
const {
  buildCandidateReview,
  calculateScore,
  groupCandidateSourcesByPattern,
  groupCandidatesByPattern,
  pickCandidate,
  riskLevel,
  sortCandidatesByRisk,
} = require('./audit-candidates');
const { buildHistory } = require('./audit-history');
const { buildNextActions, buildRecommendations } = require('./audit-actions');
const { sanitizeDiagnostics } = require('./process-diagnostic');

function buildAuditReport(...args) {
  const input = normalizeBuildInput(args);
  const config = input.config || {};
  const zombies = Array.isArray(input.zombies) ? input.zombies : [];
  const logs = Array.isArray(input.logs) ? input.logs : [];
  const stats = input.stats || {};
  const generatedAt = normalizeTime(input.now);
  const commandName = input.commandName || 'audit';
  const warnings = sanitizeDiagnostics(input.zombies?.warnings);
  const errors = sanitizeDiagnostics(input.zombies?.errors);
  const enumerationComplete = !hasScanErrors(input.zombies || []);
  const candidates = zombies.map((item) => buildCandidateReview(item));
  const eligibleCandidates = candidates.filter((item) => item.cleanupEligible);
  const eligibleCount = eligibleCandidates.length;
  const blockedCount = candidates.length - eligibleCount;
  const reclaimableBytes = eligibleCandidates.reduce(
    (sum, item) => sum + (item.memoryBytes || 0),
    0
  );
  const topCandidates = sortCandidatesByRisk(candidates);
  const history = buildHistory(logs, stats);
  const status = errors.length > 0 ? 'blocked' : zombies.length > 0 ? 'attention' : 'clean';
  const recommendationInput = {
    zombieCount: zombies.length,
    eligibleCount,
    blockedCount,
    enumerationComplete,
    errors,
    warnings,
    commandName,
  };

  return {
    schemaVersion: 1,
    generatedAt,
    kind: 'ai-coding-runtime-hygiene',
    notGeneralCleaner: true,
    profile: buildProfile(),
    differentiation: 'zclean audits AI coding runtime leftovers and safe workspace cache candidates; it does not uninstall apps, draw disk maps, or sweep the whole system.',
    summary: {
      status,
      zombieCount: zombies.length,
      eligibleCount,
      blockedCount,
      reclaimableBytes,
      warningCount: warnings.length,
      errorCount: errors.length,
    },
    risk: {
      score: calculateScore(candidates, warnings, errors),
      level: status === 'blocked' ? 'unknown' : riskLevel(candidates.length, warnings.length),
      enumerationComplete,
    },
    candidates: {
      count: zombies.length,
      eligibleCount,
      blockedCount,
      memoryReclaimable: reclaimableBytes,
      byPattern: groupCandidatesByPattern(candidates),
      largestCandidate: pickCandidate(candidates, 'memoryBytes'),
      oldestCandidate: pickCandidate(candidates, 'ageMs'),
    },
    candidateSources: {
      byPattern: groupCandidateSourcesByPattern(candidates),
    },
    safety: buildSafety(config),
    proGradeReview: {
      safeToClean: enumerationComplete && eligibleCount > 0,
      eligibleCount,
      blockedCount,
      candidates,
      topCandidates,
      guardrails: buildGuardrails(config),
    },
    diagnostics: {
      warnings,
      errors,
    },
    history,
    nextActions: buildNextActions(recommendationInput),
    recommendations: buildRecommendations(recommendationInput),
  };
}

function normalizeBuildInput(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && Object.prototype.hasOwnProperty.call(args[0], 'zombies')) {
    return args[0];
  }

  const [config = {}, zombies = [], logs = [], stats = {}, options = {}] = args;
  return {
    config,
    zombies,
    logs,
    stats,
    now: options.now,
    commandName: options.commandName,
  };
}

function normalizeTime(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function buildProfile() {
  return {
    tool: 'zclean',
    focus: 'ai-coding-runtime-hygiene',
    localOnly: true,
    telemetry: false,
    positioning: 'zclean is not a general Mac cleaner; it reviews AI coding runtime leftovers, safe workspace caches, and only cleans when explicitly asked.',
  };
}

function buildSafety(config) {
  return {
    cleanupRequiresYes: true,
    whitelistCount: Array.isArray(config.whitelist) ? config.whitelist.length : 0,
    customAiDirsCount: Array.isArray(config.customAiDirs) ? config.customAiDirs.length : 0,
    dryRunDefault: config.dryRunDefault !== false,
  };
}

function buildGuardrails(config) {
  return {
    dryRunDefault: config.dryRunDefault !== false,
    cleanupRequiresYes: true,
    maxKillBatch: config.maxKillBatch || null,
    whitelistCount: Array.isArray(config.whitelist) ? config.whitelist.length : 0,
    customAiDirCount: Array.isArray(config.customAiDirs) ? config.customAiDirs.length : 0,
    localOnly: true,
    telemetry: false,
  };
}

module.exports = {
  buildAuditReport,
};

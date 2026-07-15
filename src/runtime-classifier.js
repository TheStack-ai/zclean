'use strict';

const {
  DIRECT_PROVIDER_PATTERNS,
  GENERIC_PATTERNS,
  PROVIDER_DIRECTORIES,
  normalizeClassification,
  normalizeOrphanReason,
  normalizeProvider,
  normalizeStartTime,
  patternName,
  sanitizePatternName,
} = require('./runtime-vocabulary');
const {
  normalizeConfidence,
  sanitizeBlockedReasons,
  sanitizeEvidence,
  toPublicRuntimeMetadata,
} = require('./runtime-metadata');

const DEFAULT_RUNTIME_GRACE_MS = 5 * 60 * 1000;
const GENERIC_RUNTIME_GRACE_MS = 24 * 60 * 60 * 1000;

function classifyRuntimeCandidate(input = {}) {
  const rawPattern = patternName(input.pattern || input.name);
  const publicPattern = sanitizePatternName(rawPattern);
  const directProvider = DIRECT_PROVIDER_PATTERNS.get(rawPattern) || null;
  const providerContext = findProviderContext(input.command ?? input.cmd, input.customAiDirs);
  const customPattern = rawPattern.startsWith('custom:');
  const genericPattern = customPattern || GENERIC_PATTERNS.has(rawPattern) || !directProvider;
  const provider = normalizeProvider(
    providerContext?.provider || directProvider || (customPattern ? 'custom' : 'unknown')
  );
  const strongProviderPattern = Boolean(directProvider || providerContext);
  const orphan = input.orphan === true || input.isOrphan === true;
  const age = normalizeAge(input.age ?? input.ageMs);
  const configuredGrace = normalizePositiveNumber(input.ageGraceMs);
  const requiredAge = Math.max(
    genericPattern ? GENERIC_RUNTIME_GRACE_MS : DEFAULT_RUNTIME_GRACE_MS,
    configuredGrace || 0
  );
  const ageGraceMet = age >= requiredAge;
  const startTimeVerified = Boolean(normalizeStartTime(input.startTime));

  const blockedReasons = [];
  if (!strongProviderPattern) blockedReasons.push('provider-pattern-not-strong');
  if (!orphan) blockedReasons.push('not-orphan');
  if (!ageGraceMet) blockedReasons.push('age-grace-not-met');
  if (!startTimeVerified) blockedReasons.push('start-time-unverified');

  const cleanupEligible = blockedReasons.length === 0;
  const classification = cleanupEligible
    ? 'confirmed-stale'
    : strongProviderPattern && orphan ? 'suspected' : 'unattributed';
  const confidence = buildConfidence({
    strongProviderPattern,
    orphan,
    ageGraceMet,
    startTimeVerified,
    genericPattern,
  });
  const evidence = [`runtime-pattern:${publicPattern}`, `provider:${provider}`];

  if (directProvider) evidence.push(`provider-pattern:${publicPattern}`);
  else if (providerContext) evidence.push(`provider-context:${providerContext.source}`);
  if (orphan) evidence.push(`orphan:${normalizeOrphanReason(input.orphanReason)}`);
  if (ageGraceMet) evidence.push('age-grace-met');
  if (startTimeVerified) evidence.push('start-time:verified');

  return {
    provider,
    classification,
    confidence,
    evidence,
    cleanupEligible,
    blockedReasons,
  };
}

function findProviderContext(command, customAiDirs) {
  const value = String(command ?? '');
  for (const [directory, provider] of PROVIDER_DIRECTORIES) {
    const matcher = new RegExp(`(?:^|[\\s/\\\\])${escapeRegExp(directory)}(?:[/\\\\]|$)`, 'i');
    if (matcher.test(value)) return { provider, source: 'built-in-ai-dir' };
  }

  for (const directory of Array.isArray(customAiDirs) ? customAiDirs : []) {
    const literal = String(directory ?? '').trim();
    if (literal.length >= 2 && matchesDirectoryContext(value, literal)) {
      return { provider: 'custom', source: 'custom-ai-dir' };
    }
  }
  return null;
}

function matchesDirectoryContext(command, directory) {
  const matcher = new RegExp(
    `(?:^|[\\s/\\\\\\\"'=])${escapeRegExp(directory)}(?:[/\\\\]|$)`,
    'i'
  );
  return matcher.test(command);
}

function buildConfidence(signals) {
  let score = 0;
  if (signals.strongProviderPattern) score += 35;
  if (signals.orphan) score += 25;
  if (signals.ageGraceMet) score += 20;
  if (signals.startTimeVerified) score += 20;
  if (signals.genericPattern) score -= 10;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    level: score >= 85 ? 'high' : score >= 55 ? 'medium' : 'low',
  };
}

function normalizeAge(value) {
  const age = Number(value);
  return Number.isFinite(age) && age >= 0 ? age : 0;
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  DEFAULT_RUNTIME_GRACE_MS,
  GENERIC_RUNTIME_GRACE_MS,
  classifyRuntime: classifyRuntimeCandidate,
  classifyRuntimeCandidate,
  normalizeClassification,
  normalizeConfidence,
  normalizeProvider,
  sanitizeBlockedReasons,
  sanitizeEvidence,
  sanitizePatternName,
  toPublicRuntimeMetadata,
};

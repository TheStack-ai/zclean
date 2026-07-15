'use strict';

const DEFAULT_RUNTIME_GRACE_MS = 5 * 60 * 1000;
const GENERIC_RUNTIME_GRACE_MS = 24 * 60 * 60 * 1000;

const DIRECT_PROVIDER_PATTERNS = new Map([
  ['claude', 'claude'],
  ['claude-session', 'claude'],
  ['claude-subagent', 'claude'],
  ['codex', 'codex'],
  ['codex-exec', 'codex'],
  ['codex-sandbox', 'codex'],
  ['gemini-cli', 'gemini'],
  ['aider', 'aider'],
  ['mcp-server', 'mcp'],
]);

const PROVIDER_DIRECTORIES = [
  ['.claude', 'claude'],
  ['.codex', 'codex'],
  ['.gemini', 'gemini'],
  ['.aider', 'aider'],
  ['.cursor', 'cursor'],
  ['.windsurf', 'windsurf'],
  ['.continue', 'continue'],
  ['.cline', 'cline'],
  ['.roo', 'roo'],
  ['.kilocode', 'kilocode'],
  ['.augment', 'augment'],
  ['.copilot', 'copilot'],
  ['.trae', 'trae'],
  ['.goose', 'goose'],
];

const GENERIC_PATTERNS = new Set([
  'agent-browser',
  'playwright',
  'esbuild',
  'vite',
  'next-dev',
  'webpack',
  'npm-exec',
  'node-ai-path',
  'tsx',
  'ts-node',
  'bun',
  'deno',
]);

const KNOWN_PATTERNS = new Set([
  ...DIRECT_PROVIDER_PATTERNS.keys(),
  ...GENERIC_PATTERNS,
]);

const KNOWN_PROVIDERS = new Set([
  ...DIRECT_PROVIDER_PATTERNS.values(),
  ...PROVIDER_DIRECTORIES.map(([, provider]) => provider),
  'custom',
  'unknown',
]);

const CLASSIFICATIONS = new Set(['confirmed-stale', 'suspected', 'unattributed']);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);
const ORPHAN_REASONS = new Set([
  'parent-gone',
  'reparented-to-init',
  'reparented-to-launchd',
  'reparented-to-systemd-user',
  'verified',
]);
const BLOCKED_REASONS = new Set([
  'provider-pattern-not-strong',
  'not-orphan',
  'age-grace-not-met',
  'start-time-unverified',
  'classification-incomplete',
]);

function classifyRuntimeCandidate(input = {}) {
  const rawPattern = patternName(input.pattern || input.name);
  const publicPattern = sanitizePatternName(rawPattern);
  const directProvider = DIRECT_PROVIDER_PATTERNS.get(rawPattern) || null;
  const providerContext = findProviderContext(
    input.command ?? input.cmd,
    input.customAiDirs
  );
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
    : strongProviderPattern && orphan
      ? 'suspected'
      : 'unattributed';
  const confidence = buildConfidence({
    strongProviderPattern,
    orphan,
    ageGraceMet,
    startTimeVerified,
    genericPattern,
  });
  const evidence = [`runtime-pattern:${publicPattern}`, `provider:${provider}`];

  if (directProvider) {
    evidence.push(`provider-pattern:${publicPattern}`);
  } else if (providerContext) {
    evidence.push(`provider-context:${providerContext.source}`);
  }
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
    if (matcher.test(value)) {
      return { provider, source: 'built-in-ai-dir' };
    }
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
    `(?:^|[\\s/\\\\\"'=])${escapeRegExp(directory)}(?:[/\\\\]|$)`,
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

function toPublicRuntimeMetadata(candidate = {}) {
  const explicitlyEligible = candidate.cleanupEligible === true;
  const classification = normalizeClassification(
    candidate.classification,
    explicitlyEligible ? 'confirmed-stale' : 'unattributed'
  );
  const cleanupEligible = explicitlyEligible && classification === 'confirmed-stale';
  const blockedReasons = cleanupEligible
    ? []
    : sanitizeBlockedReasons(candidate.blockedReasons);

  if (!cleanupEligible && blockedReasons.length === 0) {
    blockedReasons.push('classification-incomplete');
  }

  return {
    provider: normalizeProvider(candidate.provider),
    classification,
    confidence: normalizeConfidence(candidate.confidence),
    evidence: sanitizeEvidence(candidate.evidence),
    cleanupEligible,
    blockedReasons,
  };
}

function sanitizePatternName(value) {
  const normalized = patternName(value);
  if (normalized.startsWith('custom:')) return 'custom';
  return KNOWN_PATTERNS.has(normalized) ? normalized : 'unknown';
}

function normalizeProvider(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return KNOWN_PROVIDERS.has(normalized) ? normalized : 'unknown';
}

function normalizeClassification(value, fallback = 'unattributed') {
  const normalized = String(value ?? '').trim().toLowerCase();
  return CLASSIFICATIONS.has(normalized) ? normalized : fallback;
}

function normalizeConfidence(value) {
  const numericScore = Number(value?.score);
  const score = Number.isFinite(numericScore)
    ? Math.max(0, Math.min(100, Math.round(numericScore)))
    : 0;
  const requestedLevel = String(value?.level ?? '').trim().toLowerCase();
  const level = CONFIDENCE_LEVELS.has(requestedLevel)
    ? requestedLevel
    : score >= 85 ? 'high' : score >= 55 ? 'medium' : 'low';
  return { score, level };
}

function sanitizeEvidence(values) {
  const sanitized = [];
  for (const item of Array.isArray(values) ? values : []) {
    const value = String(item ?? '').trim().toLowerCase();
    if (value === 'age-grace-met' || value === 'start-time:verified') {
      sanitized.push(value);
      continue;
    }
    if (value.startsWith('runtime-pattern:')) {
      sanitized.push(`runtime-pattern:${sanitizePatternName(value.slice(16))}`);
      continue;
    }
    if (value.startsWith('provider-pattern:')) {
      sanitized.push(`provider-pattern:${sanitizePatternName(value.slice(17))}`);
      continue;
    }
    if (value.startsWith('provider:')) {
      sanitized.push(`provider:${normalizeProvider(value.slice(9))}`);
      continue;
    }
    if (value === 'provider-context:built-in-ai-dir' || value === 'provider-context:custom-ai-dir') {
      sanitized.push(value);
      continue;
    }
    if (value.startsWith('orphan:')) {
      sanitized.push(`orphan:${normalizeOrphanReason(value.slice(7))}`);
    }
  }
  return [...new Set(sanitized)];
}

function sanitizeBlockedReasons(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter((value) => BLOCKED_REASONS.has(value)))];
}

function normalizeStartTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeOrphanReason(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ORPHAN_REASONS.has(normalized) ? normalized : 'verified';
}

function patternName(value) {
  if (value && typeof value === 'object') return patternName(value.name);
  return String(value ?? '').trim().toLowerCase();
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

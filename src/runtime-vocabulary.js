'use strict';

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

const KNOWN_PATTERNS = new Set([...DIRECT_PROVIDER_PATTERNS.keys(), ...GENERIC_PATTERNS]);
const KNOWN_PROVIDERS = new Set([
  ...DIRECT_PROVIDER_PATTERNS.values(),
  ...PROVIDER_DIRECTORIES.map(([, provider]) => provider),
  'custom',
  'unknown',
]);
const CLASSIFICATIONS = new Set(['confirmed-stale', 'suspected', 'unattributed']);
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

function patternName(value) {
  if (value && typeof value === 'object') return patternName(value.name);
  return String(value ?? '').trim().toLowerCase();
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

module.exports = {
  BLOCKED_REASONS,
  DIRECT_PROVIDER_PATTERNS,
  GENERIC_PATTERNS,
  PROVIDER_DIRECTORIES,
  normalizeClassification,
  normalizeOrphanReason,
  normalizeProvider,
  normalizeStartTime,
  patternName,
  sanitizePatternName,
};

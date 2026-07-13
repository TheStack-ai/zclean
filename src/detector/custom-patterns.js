'use strict';

const { parseDuration } = require('../config');

const CUSTOM_PATTERN_MIN = 3;
const CUSTOM_PATTERN_MAX = 80;
const SAFE_CUSTOM_MAX_AGE = '24h';
const GENERIC_CUSTOM_PATTERNS = new Set([
  'bash', 'bun', 'bunx', 'cargo', 'chrome', 'chromium', 'cmd', 'corepack', 'cscript', 'deno', 'dotnet', 'esbuild', 'fish',
  'go', 'java', 'javaw', 'node', 'nodejs', 'npm', 'npx', 'perl', 'php', 'pip', 'pip3', 'pipx', 'pnpm',
  'powershell', 'powershell_ise', 'pwsh', 'py', 'pyw', 'python', 'python3', 'pythonw', 'ruby', 'server', 'sh', 'sleep', 'ts-node', 'tsx',
  'uv', 'vite', 'worker', 'wscript', 'yarn', 'zsh',
]);

function getCustomPatternError(value) {
  if (typeof value !== 'string') return '--pattern must be a literal between 3 and 80 characters.';
  const literal = value.trim();
  if (literal.length < CUSTOM_PATTERN_MIN || literal.length > CUSTOM_PATTERN_MAX) {
    return '--pattern must be a literal between 3 and 80 characters.';
  }
  if (/[\p{Cc}\p{Cf}]/u.test(literal)) {
    return '--pattern must contain printable characters only.';
  }
  const lower = literal.toLowerCase();
  const genericFragment = [...GENERIC_CUSTOM_PATTERNS].some((name) => name.includes(lower));
  const genericExecutable = lower.split(/[\s/\\'"`]+/).some(isGenericExecutableToken);
  if (genericFragment || genericExecutable) {
    return '--pattern must be specific; generic runtime names are not allowed.';
  }
  return null;
}

function isGenericExecutableToken(token) {
  const basename = token
    .replace(/^[^a-z0-9]+|[^a-z0-9.]+$/g, '')
    .replace(/\.(?:exe|cmd|bat|com)$/i, '');
  const executableName = basename
    .replace(/\.(?:cjs|mjs|js)$/i, '')
    .replace(/-cli$/i, '');
  return GENERIC_CUSTOM_PATTERNS.has(executableName)
    || isVersionedGenericRuntime(executableName);
}

function isVersionedGenericRuntime(value) {
  const match = value.match(/^([a-z][a-z_-]*?)(?:\d[\d.]*(?:[a-z][a-z0-9]*)?)$/);
  return Boolean(match && GENERIC_CUSTOM_PATTERNS.has(match[1]));
}

function normalizeCustomPattern(value) {
  if (getCustomPatternError(value)) return null;
  return value.trim();
}

function getCustomPatterns(config) {
  if (!Array.isArray(config?.customPatterns)) return [];
  return [...new Set(config.customPatterns.map(normalizeCustomPattern).filter(Boolean))];
}

function createCustomPattern(literal, config) {
  const configuredAge = config?.maxAge;
  const maxOrphanAge = parseDuration(configuredAge) > 0
    ? configuredAge
    : SAFE_CUSTOM_MAX_AGE;
  return {
    name: `custom:${literal}`,
    literal,
    minAge: 0,
    maxOrphanAge,
    orphanOnly: true,
    strictOrphan: true,
  };
}

module.exports = {
  createCustomPattern,
  getCustomPatternError,
  getCustomPatterns,
  normalizeCustomPattern,
};

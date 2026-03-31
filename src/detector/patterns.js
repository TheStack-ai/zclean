'use strict';

/**
 * Process patterns to detect AI tool zombies.
 *
 * Each pattern has:
 *   name          — human-readable identifier
 *   match         — RegExp to test against full command line
 *   minAge        — minimum age (ms) before considering it a zombie (0 = any age)
 *   maxOrphanAge  — if set, orphan processes older than this are zombies (duration string)
 *   memThreshold  — if set, only flag if RSS exceeds this (bytes string like "500MB")
 *   orphanOnly    — if true, only flag orphaned processes (default: true for most)
 *   aiPathRequired — if true, cmdline must also match AI_DIR_REGEX to be flagged
 */

/** Centralized list of AI tool config directories */
const AI_TOOL_DIRS = [
  '.claude', '.cursor', '.windsurf', '.continue', '.cline',
  '.roo', '.kilocode', '.augment', '.codex', '.copilot',
  '.aider', '.gemini', '.trae', '.goose',
];

/**
 * Build a regex that matches any AI tool directory in a path.
 * Matches "{dir}/" or "{dir}\" for each directory.
 * @param {string[]} [customDirs] — additional directories from config
 * @returns {RegExp}
 */
function buildAiDirRegex(customDirs) {
  const allDirs = customDirs && customDirs.length > 0
    ? [...AI_TOOL_DIRS, ...customDirs]
    : AI_TOOL_DIRS;

  const escaped = allDirs.map((d) => d.replace(/\./g, '\\.'));
  return new RegExp(`(?:${escaped.join('|')})[/\\\\]`);
}

/** Default regex (no custom dirs) */
const AI_DIR_REGEX = buildAiDirRegex();

const PATTERNS = [
  // MCP servers — any orphaned MCP server is suspect
  {
    name: 'mcp-server',
    match: /mcp-server/,
    minAge: 0,
    maxOrphanAge: '1h',
    orphanOnly: true,
  },

  // Headless browsers spawned by agents
  {
    name: 'agent-browser',
    match: /agent-browser|chrome-headless-shell/,
    minAge: 0,
    orphanOnly: true,
  },

  // Playwright driver processes
  {
    name: 'playwright',
    match: /playwright[/\\]driver/,
    minAge: 0,
    orphanOnly: true,
  },

  // Claude session processes (claude --session-id)
  {
    name: 'claude-session',
    match: /claude\s+--session-id/,
    minAge: 0,
    orphanOnly: true,
  },

  // Claude subagent processes
  {
    name: 'claude-subagent',
    match: /claude\s+--print/,
    minAge: 0,
    orphanOnly: true,
  },

  // Codex exec processes
  {
    name: 'codex-exec',
    match: /codex\s+exec/,
    minAge: 0,
    orphanOnly: true,
  },

  // Codex sandbox processes
  {
    name: 'codex-sandbox',
    match: /codex-sandbox/,
    minAge: 0,
    orphanOnly: true,
  },

  // Aider processes
  {
    name: 'aider',
    match: /python.*aider|(?:^|\s|\/)aider\b/,
    minAge: 0,
    orphanOnly: true,
  },

  // Gemini CLI processes
  {
    name: 'gemini-cli',
    match: /\bgemini\b/,
    minAge: 0,
    orphanOnly: true,
  },

  // Build tools — only if orphaned for 24h+ AND in AI path
  {
    name: 'esbuild',
    match: /esbuild/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
  {
    name: 'vite',
    match: /vite/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
  {
    name: 'next-dev',
    match: /next\s+dev/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
  {
    name: 'webpack',
    match: /webpack/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },

  // npx/npm exec — orphaned, AI path required
  {
    name: 'npm-exec',
    match: /npm\s+exec|npx\s/,
    minAge: 0,
    orphanOnly: true,
    aiPathRequired: true,
  },

  // Node processes with AI tool paths — orphan + age/memory gated
  // match: node running from AI dirs, MCP servers, or agent paths
  // aiPathRequired adds a second gate via AI_DIR_REGEX
  {
    name: 'node-ai-path',
    match: /node\b.*(?:[/\\]mcp[/\\]|[/\\]agent[/\\]|[/\\]server[/\\])/,
    minAge: 0,
    maxOrphanAge: '24h',
    memThreshold: '500MB',
    orphanOnly: true,
    aiPathRequired: true,
  },

  // TypeScript runners — orphan + AI path required
  {
    name: 'tsx',
    match: /\btsx\b/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
  {
    name: 'ts-node',
    match: /ts-node/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
  {
    name: 'bun',
    match: /\bbun\b/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
  {
    name: 'deno',
    match: /\bdeno\b/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
    aiPathRequired: true,
  },
];

/**
 * Match a command line against known patterns.
 * Returns the first matching pattern or null.
 *
 * @param {string} cmdline — process command line
 * @param {object} [config] — optional config with customAiDirs
 * @returns {object|null} matched pattern or null
 */
function matchPattern(cmdline, config) {
  const aiRegex = config && config.customAiDirs && config.customAiDirs.length > 0
    ? buildAiDirRegex(config.customAiDirs)
    : AI_DIR_REGEX;

  for (const pattern of PATTERNS) {
    if (pattern.match.test(cmdline)) {
      // If pattern requires AI path context, check it
      if (pattern.aiPathRequired && !aiRegex.test(cmdline)) {
        continue;
      }
      return pattern;
    }
  }
  return null;
}

module.exports = { PATTERNS, AI_TOOL_DIRS, AI_DIR_REGEX, buildAiDirRegex, matchPattern };

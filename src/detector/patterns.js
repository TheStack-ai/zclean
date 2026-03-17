'use strict';

/**
 * Process patterns to detect AI tool zombies.
 *
 * Each pattern has:
 *   name       — human-readable identifier
 *   match      — RegExp to test against full command line
 *   minAge     — minimum age (ms) before considering it a zombie (0 = any age)
 *   maxOrphanAge — if set, orphan processes older than this are zombies (duration string)
 *   memThreshold — if set, only flag if RSS exceeds this (bytes string like "500MB")
 *   orphanOnly — if true, only flag orphaned processes (default: true for most)
 */
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

  // Build tools — only if orphaned for 24h+
  {
    name: 'esbuild',
    match: /esbuild/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
  {
    name: 'vite',
    match: /vite/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
  {
    name: 'next-dev',
    match: /next\s+dev/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
  {
    name: 'webpack',
    match: /webpack/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },

  // npx/npm exec — orphaned
  {
    name: 'npm-exec',
    match: /npm\s+exec|npx\s/,
    minAge: 0,
    orphanOnly: true,
  },

  // Node processes with AI tool paths — orphan + age/memory gated
  {
    name: 'node-ai-path',
    match: /node\b.*(?:\.claude[/\\]|[/\\]mcp[/\\]|[/\\]agent[/\\])/,
    minAge: 0,
    maxOrphanAge: '24h',
    memThreshold: '500MB',
    orphanOnly: true,
  },

  // TypeScript runners — orphan + AI tool related
  {
    name: 'tsx',
    match: /\btsx\b/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
  {
    name: 'ts-node',
    match: /ts-node/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
  {
    name: 'bun',
    match: /\bbun\b.*(?:\.claude|mcp|agent)/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
  {
    name: 'deno',
    match: /\bdeno\b.*(?:\.claude|mcp|agent)/,
    minAge: 0,
    maxOrphanAge: '24h',
    orphanOnly: true,
  },
];

/**
 * Match a command line against known patterns.
 * Returns the first matching pattern or null.
 */
function matchPattern(cmdline) {
  for (const pattern of PATTERNS) {
    if (pattern.match.test(cmdline)) {
      return pattern;
    }
  }
  return null;
}

module.exports = { PATTERNS, matchPattern };

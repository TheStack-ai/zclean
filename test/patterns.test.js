'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PATTERNS, AI_TOOL_DIRS, AI_DIR_REGEX, buildAiDirRegex, matchPattern } = require('../src/detector/patterns');

describe('AI_TOOL_DIRS', () => {
  it('contains exactly 14 directories', () => {
    assert.equal(AI_TOOL_DIRS.length, 14);
  });

  it('includes core AI tool directories', () => {
    for (const dir of ['.claude', '.cursor', '.windsurf', '.codex', '.copilot', '.gemini']) {
      assert.ok(AI_TOOL_DIRS.includes(dir), `missing ${dir}`);
    }
  });
});

describe('AI_DIR_REGEX', () => {
  it('matches .claude/ path', () => {
    assert.ok(AI_DIR_REGEX.test('/home/user/.claude/tools/server.js'));
  });

  it('matches .cursor/ path', () => {
    assert.ok(AI_DIR_REGEX.test('/Users/dd/.cursor/mcp/server.js'));
  });

  it('does not match normal path without AI dir', () => {
    assert.equal(AI_DIR_REGEX.test('/home/user/projects/myapp/server.js'), false);
  });

  it('does not match partial directory name', () => {
    // .claudeX/ should not match because regex requires / or \ after dir name
    assert.equal(AI_DIR_REGEX.test('/home/user/.claudeX/foo'), false);
  });
});

describe('buildAiDirRegex', () => {
  it('includes custom directories', () => {
    const regex = buildAiDirRegex(['.myai']);
    assert.ok(regex.test('/home/user/.myai/server.js'));
  });

  it('still matches built-in directories with custom dirs', () => {
    const regex = buildAiDirRegex(['.myai']);
    assert.ok(regex.test('/home/user/.claude/foo'));
  });

  it('returns default regex when no custom dirs', () => {
    const regex = buildAiDirRegex();
    assert.ok(regex.test('/path/.cursor/bar'));
  });
});

describe('matchPattern', () => {
  it('claude --print → claude-subagent', () => {
    const result = matchPattern('claude --print "hello"');
    assert.ok(result);
    assert.equal(result.name, 'claude-subagent');
  });

  it('claude --session-id → claude-session', () => {
    const result = matchPattern('claude --session-id abc123');
    assert.ok(result);
    assert.equal(result.name, 'claude-session');
  });

  it('mcp-server → mcp-server', () => {
    const result = matchPattern('node /path/to/mcp-server/index.js');
    assert.ok(result);
    assert.equal(result.name, 'mcp-server');
  });

  it('codex exec → codex-exec', () => {
    const result = matchPattern('codex exec --task "build"');
    assert.ok(result);
    assert.equal(result.name, 'codex-exec');
  });

  it('unrelated command → null', () => {
    assert.equal(matchPattern('vim /etc/hosts'), null);
  });
});

describe('aiPathRequired — false positives', () => {
  it('tsx watch (no AI path) → null', () => {
    assert.equal(matchPattern('tsx watch src/index.ts'), null);
  });

  it('npx prisma generate (no AI path) → null', () => {
    assert.equal(matchPattern('npx prisma generate'), null);
  });

  it('npx jest (no AI path) → null', () => {
    assert.equal(matchPattern('npx jest --coverage'), null);
  });

  it('esbuild bundle (no AI path) → null', () => {
    assert.equal(matchPattern('esbuild src/index.ts --bundle'), null);
  });

  it('vite dev (no AI path) → null', () => {
    assert.equal(matchPattern('vite --port 3000'), null);
  });

  it('bun run (no AI path) → null', () => {
    assert.equal(matchPattern('bun run dev'), null);
  });

  it('deno run (no AI path) → null', () => {
    assert.equal(matchPattern('deno run --allow-net server.ts'), null);
  });
});

describe('aiPathRequired — true positives', () => {
  it('tsx .claude/tools/server.ts → tsx', () => {
    const result = matchPattern('tsx .claude/tools/server.ts');
    assert.ok(result);
    assert.equal(result.name, 'tsx');
  });

  it('npx .cursor/mcp/run.js → npm-exec', () => {
    const result = matchPattern('npx .cursor/mcp/run.js');
    assert.ok(result);
    assert.equal(result.name, 'npm-exec');
  });

  it('esbuild .windsurf/build/out.js → esbuild', () => {
    const result = matchPattern('esbuild .windsurf/build/out.js');
    assert.ok(result);
    assert.equal(result.name, 'esbuild');
  });

  it('bun .claude/agent/worker.ts → bun', () => {
    const result = matchPattern('bun .claude/agent/worker.ts');
    assert.ok(result);
    assert.equal(result.name, 'bun');
  });

  it('deno run .codex/server.ts → deno', () => {
    const result = matchPattern('deno run .codex/server.ts');
    assert.ok(result);
    assert.equal(result.name, 'deno');
  });
});

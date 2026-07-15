'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PATTERNS,
  AI_TOOL_DIRS,
  AI_DIR_REGEX,
  buildAiDirRegex,
  getCustomPatternError,
  matchPattern,
} = require('../src/detector/patterns');

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

  it('matches custom directories with either path separator', () => {
    const regex = buildAiDirRegex(['custom-ai']);
    assert.ok(regex.test('/home/user/custom-ai/server.js'));
    assert.ok(regex.test('C:\\Users\\dd\\custom-ai\\server.js'));
  });

  it('treats every RegExp metacharacter in a custom directory as literal', () => {
    const directory = '.*+?^${}()|[]\\';
    const regex = buildAiDirRegex([directory]);
    assert.ok(regex.test(`/home/user/${directory}/server.js`));
  });

  it('still matches built-in directories with custom dirs', () => {
    const regex = buildAiDirRegex(['.myai']);
    assert.ok(regex.test('/home/user/.claude/foo'));
  });

  it('returns default regex when no custom dirs', () => {
    const regex = buildAiDirRegex();
    assert.ok(regex.test('/path/.cursor/bar'));
  });

  it('matches custom directories only at path-segment boundaries', () => {
    const regex = buildAiDirRegex(['ain']);

    assert.equal(regex.test('/home/user/main/server.js'), false);
    assert.equal(regex.test('/home/user/ain/server.js'), true);
  });
});

describe('customAiDirs regex safety', () => {
  for (const [directory, unrelatedCommand] of [
    ['.*', 'tsx /home/user/project/server.ts'],
    ['(', 'tsx /home/user/project/server.ts'],
    ['a|b', 'tsx /home/user/a/server.ts'],
    ['[', 'tsx /home/user/project/server.ts'],
    ['\\', 'tsx /home/user/project/server.ts'],
  ]) {
    it(`does not expand scanning scope for literal directory ${JSON.stringify(directory)}`, () => {
      assert.equal(matchPattern(unrelatedCommand, { customAiDirs: [directory] }), null);
    });
  }
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

  it('matches configured custom patterns as case-insensitive literals', () => {
    const result = matchPattern('node My-Agent-Worker.js', {
      customPatterns: ['my-agent-worker'],
    });

    assert.ok(result);
    assert.equal(result.name, 'custom:my-agent-worker');
    assert.equal(result.orphanOnly, true);
  });

  it('does not interpret custom patterns as regular expressions', () => {
    assert.equal(matchPattern('node worker.js', { customPatterns: ['worker.*'] }), null);
  });

  it('ignores unsafe custom pattern values from config', () => {
    assert.equal(matchPattern('node a.js', { customPatterns: ['a', '', 42] }), null);
  });

  it('rejects generic runtime names as custom patterns', () => {
    assert.equal(matchPattern('node service.js', { customPatterns: ['node'] }), null);
    assert.equal(matchPattern('python worker.py', { customPatterns: ['python'] }), null);
  });

  it('rejects custom patterns that begin with a generic runtime', () => {
    assert.equal(matchPattern('node /srv/service.js', { customPatterns: ['node /'] }), null);
    assert.equal(matchPattern('python -m worker', { customPatterns: ['python -m'] }), null);
  });

  it('rejects fragments that are contained inside generic runtime names', () => {
    assert.match(getCustomPatternError('ode'), /specific/i);
    assert.match(getCustomPatternError('ython'), /specific/i);
  });

  it('rejects generic runtime executable and path forms', () => {
    for (const pattern of [
      'node.exe',
      'python.exe',
      'python3.12',
      'pythonw.exe',
      'pythonw3.12.exe',
      'python3.13t',
      'pythonw3.13t.exe',
      'ruby3.2',
      'php8.3',
      'java17',
      'node20',
      'go1.22',
      'py.exe',
      'pipx',
      'cmd.exe',
      'wscript.exe',
      'cscript.exe',
      'powershell_ise.exe',
      'javaw.exe',
      'npm',
      'npx',
      'npm-cli.js',
      'npx-cli.js',
      'npm-cli',
      'npm-cli.exe',
      'npx-cli.cmd',
      'pnpm-cli.exe',
      'C:\\tools\\pnpm-cli.exe',
      'pnpm.cjs',
      'yarn.js',
      'corepack.cjs',
      'tsx',
      '/usr/bin/node',
      'C:\\tools\\python3.exe',
      '"C:\\Program Files\\nodejs\\node.exe"',
    ]) {
      assert.match(getCustomPatternError(pattern), /specific/i, pattern);
    }
  });

  it('rejects Unicode control and format characters', () => {
    assert.match(getCustomPatternError('safe\u202eworker'), /printable/i);
    assert.match(getCustomPatternError('safe\u0085worker'), /printable/i);
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

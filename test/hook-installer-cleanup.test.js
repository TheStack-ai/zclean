'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const hook = require('../src/installer/hook');

const LEGACY_COMMAND = '/usr/local/bin/zclean --yes --session-pid=$PPID';

describe('legacy Claude hook cleanup contract', () => {
  it('exports inspection and removal without installation behavior', () => {
    assert.deepEqual(Object.keys(hook).sort(), [
      'inspectLegacyHook',
      'removeHook',
      'removeLegacyHook',
    ]);
  });

  it('reports an absent optional settings file without creating it', (t) => {
    const fixture = createFixture(t);

    const inspected = hook.inspectLegacyHook({ settingsPath: fixture.settingsPath });
    const removed = hook.removeLegacyHook({ settingsPath: fixture.settingsPath });

    assertResult(inspected, 'absent');
    assertResult(removed, 'absent');
    assert.equal(fs.existsSync(fixture.settingsPath), false);
  });

  it('reports invalid optional JSON and leaves its bytes untouched', (t) => {
    const fixture = createFixture(t);
    const original = '{"hooks":{"Stop":[';
    writeFile(fixture.settingsPath, original);

    const inspected = hook.inspectLegacyHook({ settingsPath: fixture.settingsPath });
    const removed = hook.removeLegacyHook({ settingsPath: fixture.settingsPath });

    assertResult(inspected, 'invalid');
    assertResult(removed, 'invalid');
    assert.equal(fs.readFileSync(fixture.settingsPath, 'utf8'), original);
  });

  it('reports valid unrelated settings as unchanged without rewriting them', (t) => {
    const fixture = createFixture(t);
    const original = [
      '{',
      '  "note": "zclean is mentioned here",',
      '  "hooks": {',
      '    "Stop": [{ "type": "command", "command": "echo zclean" }]',
      '  }',
      '}',
      '',
    ].join('\n');
    writeFile(fixture.settingsPath, original);

    const inspected = hook.inspectLegacyHook({ settingsPath: fixture.settingsPath });
    const removed = hook.removeLegacyHook({ settingsPath: fixture.settingsPath });

    assertResult(inspected, 'unchanged');
    assertResult(removed, 'unchanged');
    assert.equal(fs.readFileSync(fixture.settingsPath, 'utf8'), original);
  });

  it('removes only exact generated legacy wrappers and preserves user-authored variants', (t) => {
    const fixture = createFixture(t);
    const retainedNestedHooks = [
      { type: 'command', command: 'echo zclean' },
      { type: 'prompt', prompt: 'keep the zclean string' },
    ];
    const retainedStopEntries = [
      { type: 'command', command: 'relative/zclean --yes --session-pid=$PPID' },
      { type: 'command', command: '/usr/local/bin/not-zclean --yes --session-pid=$PPID' },
      { type: 'command', command: '/usr/local/bin/zclean --yes' },
      { type: 'command', command: '/usr/local/bin/zclean --yes --session-pid=$PPID --extra' },
      { type: 'command', command: '/usr/local/bin/zclean --session-pid=$PPID --yes' },
      { type: 'command', command: '/usr/local/bin/zclean --yes --session-pid=$PPID && echo unsafe' },
    ];
    const settings = {
      note: 'preserve zclean text',
      hooks: {
        PreToolUse: [{ matcher: 'zclean', hooks: [{ type: 'command', command: 'echo keep' }] }],
        Stop: [
          {
            matcher: '',
            note: 'preserve wrapper metadata',
            hooks: [{ type: 'command', command: LEGACY_COMMAND }, ...retainedNestedHooks],
          },
          {
            matcher: '',
            hooks: [{
              type: 'command',
              command: "'/Users/example/Library/Application Support/zclean.js' --yes --session-pid=$PPID",
            }],
          },
          {
            matcher: '',
            hooks: [{
              type: 'command',
              command: '"C:\\Program Files\\nodejs\\zclean.cmd" --yes --session-pid=$PPID',
            }],
          },
          { type: 'command', command: '/opt/homebrew/bin/zclean --yes --session-pid=$PPID' },
          ...retainedStopEntries,
        ],
      },
    };
    writeFile(fixture.settingsPath, JSON.stringify(settings, null, 2) + '\n');
    const beforeInspection = fs.readFileSync(fixture.settingsPath, 'utf8');

    const inspected = hook.inspectLegacyHook({ settingsPath: fixture.settingsPath });

    assertResult(inspected, 'legacy');
    assert.equal(fs.readFileSync(fixture.settingsPath, 'utf8'), beforeInspection);

    const removed = hook.removeLegacyHook({ settingsPath: fixture.settingsPath });
    const written = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));

    assertResult(removed, 'removed');
    assert.deepEqual(written, {
      note: settings.note,
      hooks: {
        PreToolUse: settings.hooks.PreToolUse,
        Stop: [
          {
            matcher: '',
            note: 'preserve wrapper metadata',
            hooks: [{ type: 'command', command: LEGACY_COMMAND }, ...retainedNestedHooks],
          },
          { type: 'command', command: '/opt/homebrew/bin/zclean --yes --session-pid=$PPID' },
          ...retainedStopEntries,
        ],
      },
    });
  });

  it('keeps removeHook as a state-preserving compatibility alias', (t) => {
    assert.equal(typeof hook.removeLegacyHook, 'function');
    const fixture = createFixture(t);
    writeFile(fixture.settingsPath, settingsWithLegacyHook());

    const result = hook.removeHook({ settingsPath: fixture.settingsPath });

    assertResult(result, 'removed');
  });
});

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-hook-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    settingsPath: path.join(root, '.claude', 'settings.json'),
  };
}

function writeFile(file, contents, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { encoding: 'utf8', mode });
  fs.chmodSync(file, mode);
}

function settingsWithLegacyHook() {
  return JSON.stringify({
    hooks: {
      Stop: [{
        matcher: '',
        hooks: [{ type: 'command', command: LEGACY_COMMAND }],
      }],
    },
  }, null, 2) + '\n';
}

function assertResult(result, state) {
  assert.equal(result.state, state);
  assert.equal(typeof result.message, 'string');
  assert.deepEqual(Object.keys(result).sort(), ['message', 'state']);
}

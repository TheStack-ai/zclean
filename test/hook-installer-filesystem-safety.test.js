'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const hook = require('../src/installer/hook');

const LEGACY_COMMAND = '/usr/local/bin/zclean --yes --session-pid=$PPID';

describe('legacy Claude hook filesystem safety', () => {
  it('writes through a same-directory temp file, renames it, and preserves mode', (t) => {
    const fixture = createFixture(t);
    const tempName = '.settings.json.atomic-test.tmp';
    const tempPath = path.join(path.dirname(fixture.settingsPath), tempName);
    const events = [];
    writeFile(fixture.settingsPath, settingsWithLegacyHook(), 0o640);
    const injectedFs = Object.create(fs);
    injectedFs.writeFileSync = (file, ...args) => {
      if (file === tempPath) events.push('write');
      return fs.writeFileSync(file, ...args);
    };
    injectedFs.renameSync = (from, to) => {
      events.push(`rename:${path.dirname(from) === path.dirname(to)}`);
      return fs.renameSync(from, to);
    };

    const result = hook.removeLegacyHook({
      fs: injectedFs,
      settingsPath: fixture.settingsPath,
      tempName,
    });

    assertResult(result, 'removed');
    assert.deepEqual(events, ['write', 'rename:true']);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(fixture.settingsPath).mode & 0o777, 0o640);
    }
    assert.equal(fs.existsSync(tempPath), false);
  });

  it('cleans the temp file and preserves original bytes when atomic rename fails', (t) => {
    const fixture = createFixture(t);
    const tempName = '.settings.json.rename-failure.tmp';
    const tempPath = path.join(path.dirname(fixture.settingsPath), tempName);
    const original = settingsWithLegacyHook();
    writeFile(fixture.settingsPath, original, 0o600);
    const injectedFs = Object.create(fs);
    injectedFs.renameSync = () => {
      throw new Error('injected rename failure');
    };

    const result = hook.removeLegacyHook({
      fs: injectedFs,
      settingsPath: fixture.settingsPath,
      tempName,
    });

    assertResult(result, 'error');
    assert.equal(fs.readFileSync(fixture.settingsPath, 'utf8'), original);
    assert.equal(fs.existsSync(tempPath), false);
  });

  it('does not replace a symlinked settings file or mutate its target', (t) => {
    const fixture = createFixture(t);
    const targetPath = path.join(fixture.root, 'dotfiles', 'claude-settings.json');
    const original = settingsWithLegacyHook();
    writeFile(targetPath, original, 0o600);
    fs.mkdirSync(path.dirname(fixture.settingsPath), { recursive: true });
    try {
      fs.symlinkSync(targetPath, fixture.settingsPath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip(`file symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const result = hook.removeLegacyHook({ settingsPath: fixture.settingsPath });

    assertResult(result, 'error');
    assert.equal(fs.lstatSync(fixture.settingsPath).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), original);
  });

  it('does not overwrite a concurrent settings update before rename', (t) => {
    const fixture = createFixture(t);
    const tempName = '.settings.json.concurrent-update.tmp';
    const tempPath = path.join(path.dirname(fixture.settingsPath), tempName);
    const concurrent = `${JSON.stringify({ userUpdate: true }, null, 2)}\n`;
    writeFile(fixture.settingsPath, settingsWithLegacyHook(), 0o600);
    const injectedFs = Object.create(fs);
    injectedFs.writeFileSync = (file, ...args) => {
      const value = fs.writeFileSync(file, ...args);
      if (file === tempPath) fs.writeFileSync(fixture.settingsPath, concurrent, 'utf8');
      return value;
    };

    const result = hook.removeLegacyHook({
      fs: injectedFs,
      settingsPath: fixture.settingsPath,
      tempName,
    });

    assertResult(result, 'error');
    assert.equal(fs.readFileSync(fixture.settingsPath, 'utf8'), concurrent);
    assert.equal(fs.existsSync(tempPath), false);
  });

  it('reports filesystem inspection errors explicitly', () => {
    const injectedFs = {
      existsSync() {
        return true;
      },
      readFileSync() {
        throw new Error('injected read failure');
      },
    };

    const result = hook.inspectLegacyHook({
      fs: injectedFs,
      settingsPath: '/virtual/.claude/settings.json',
    });

    assertResult(result, 'error');
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

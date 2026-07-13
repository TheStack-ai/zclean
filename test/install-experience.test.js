'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const postinstallPath = path.join(repoRoot, 'scripts', 'postinstall.js');
const brandPath = path.join(repoRoot, 'src', 'cli-brand.js');
const pkg = require('../package.json');

describe('install experience', () => {
  it('packages a foreground-safe postinstall banner', () => {
    assert.equal(pkg.scripts.postinstall, 'node scripts/postinstall.js');
    assert.ok(pkg.files.includes('scripts/postinstall.js'));
  });

  it('prints the image-like wordmark and next command without side effects', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-postinstall-'));
    try {
      const result = spawnSync(process.execPath, [postinstallPath], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, NO_COLOR: '1' },
        encoding: 'utf-8',
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /███████\s+██████/);
      assert.match(result.stdout, /AI CODING RUNTIME HYGIENE/);
      assert.match(result.stdout, /zclean init/);
      assert.match(result.stdout, /dry-run/i);
      assert.equal(result.stderr, '');
      assert.equal(fs.existsSync(path.join(home, '.zclean')), false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('renders a precise three-step init status rail', () => {
    assert.ok(fs.existsSync(brandPath), 'expected src/cli-brand.js');
    const { renderInit } = require(brandPath);
    const output = renderInit({
      version: pkg.version,
      steps: [
        { index: '01', label: 'CONFIG', state: 'READY', detail: '~/사용자/프로젝트/설정/config.json' },
        { index: '02', label: 'CLAUDE HOOK', state: 'INSTALLED', detail: 'SessionEnd cleanup hook' },
        { index: '03', label: 'SCHEDULER', state: 'ACTIVE', detail: 'Hourly runtime hygiene check' },
      ],
      warningCount: 0,
    });

    assert.match(output, /Z \/ CLEAN/);
    assert.match(output, /01\s+CONFIG\s+READY/);
    assert.match(output, /02\s+CLAUDE HOOK\s+INSTALLED/);
    assert.match(output, /03\s+SCHEDULER\s+ACTIVE/);
    assert.match(output, /SYSTEM READY/);
    assert.match(output, /zclean audit/);
    assert.match(output, /zclean doctor/);

    const frameLines = output.split('\n').filter((line) => /^  \||^  \+-/.test(line));
    assert.deepEqual([...new Set(frameLines.map(displayWidth))], [59]);
  });

  it('removes terminal control sequences from init details', () => {
    const { renderInit } = require(brandPath);
    const output = renderInit({
      version: pkg.version,
      steps: [
        { index: '01', label: 'CONFIG', state: 'WARNING', detail: '\x1b]8;;https://evil.test\x07click\x1b]8;;\x07\x1b[31mred\x1b[0m' },
      ],
      warningCount: 1,
    });

    assert.doesNotMatch(output, /\x1b|\x07|evil\.test/);
    assert.match(output, /clickred/);
  });

  it('runs the packaged postinstall lifecycle from an actual tarball', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-packed-install-'));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      const packageDir = path.join(root, 'package');
      const prefix = path.join(root, 'prefix');
      fs.mkdirSync(packageDir, { recursive: true });
      const packed = spawnSync(npm, ['pack', '--pack-destination', packageDir, '--json'], {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      assert.equal(packed.status, 0, packed.stderr);
      const tarball = path.join(packageDir, JSON.parse(packed.stdout)[0].filename);
      const installed = spawnSync(npm, [
        'install', '--global', '--prefix', prefix, tarball,
        '--foreground-scripts', '--cache', path.join(root, 'cache'),
      ], {
        env: { ...process.env, HOME: path.join(root, 'home'), NO_COLOR: '1' },
        encoding: 'utf-8',
      });

      assert.equal(installed.status, 0, installed.stderr);
      assert.match(installed.stdout, /Z \/ CLEAN/);
      assert.match(installed.stdout, /zclean init/);
      assert.equal(fs.existsSync(path.join(root, 'home', '.zclean')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function displayWidth(value) {
  return [...value].reduce((width, char) => {
    const code = char.codePointAt(0);
    return width + (code >= 0x1100 ? 2 : 1);
  }, 0);
}

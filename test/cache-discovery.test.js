'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCacheReport, scanCacheTargets } = require('../src/cache');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('workspace cache discovery', () => {
  it('finds supported workspace cache directories without scanning arbitrary files', () => {
    const fixture = makeFixture();
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      const candidates = scanCacheTargets(workspace);
      const relativePaths = candidates.map((item) => item.relativePath).sort();

      assert.deepEqual(relativePaths, [
        '.next/cache',
        '.turbo',
        'node_modules/.cache',
        'packages/app/.vite',
        'src/__pycache__',
      ]);
      assert.ok(candidates.every((item) => item.bytes > 0));
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('reports a normal temp workspace as safe without serializing private paths', () => {
    const fixture = makeFixture();
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      const report = buildCacheReport({ root: workspace });
      const serialized = JSON.stringify(report);

      assert.equal(report.status, 'safe');
      assert.equal(report.safe, true);
      assert.equal(report.ok, true);
      assert.equal(report.exitCode, 0);
      assert.deepEqual(report.errors, []);
      assert.equal(report.summary.status, 'safe');
      assert.equal(report.summary.count, 5);
      assert.equal(Array.isArray(report._privateCandidates), true);
      assert.equal(serialized.includes(workspace), false);
      assert.equal(serialized.includes('_privateCandidates'), false);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('rejects filesystem and drive roots before scanning', () => {
    const roots = [path.parse(path.resolve(process.cwd())).root];
    if (process.platform !== 'win32') roots.push('C:\\');

    for (const root of roots) {
      const report = assertRejectedRoot(root, 'cache-root-filesystem-root');
      assert.equal(report.workspace, null);
      assert.equal(report.summary.count, 0);
    }
  });

  it('rejects the user home directory', () => {
    const home = os.homedir();
    const report = assertRejectedRoot(home, 'cache-root-home-directory');

    assert.equal(JSON.stringify(report).includes(home), false);
  });

  it('rejects missing and non-directory roots with structured errors', () => {
    const fixture = makeFixture();
    try {
      const missingRoot = path.join(fixture.root, 'missing-workspace');
      const fileRoot = path.join(fixture.root, 'workspace-file');
      fs.writeFileSync(fileRoot, 'not-a-directory', 'utf-8');

      const missingReport = assertRejectedRoot(missingRoot, 'cache-root-missing');
      const fileReport = assertRejectedRoot(fileRoot, 'cache-root-not-directory');

      assert.equal(JSON.stringify(missingReport).includes(missingRoot), false);
      assert.equal(JSON.stringify(fileReport).includes(fileRoot), false);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('rejects a workspace root that is a symbolic link or junction', (t) => {
    const fixture = makeFixture();
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      const linkedRoot = path.join(fixture.root, 'linked-workspace');
      try {
        fs.symlinkSync(workspace, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (err) {
        if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EACCES')) {
          t.skip(`directory links unavailable: ${err.code}`);
          return;
        }
        throw err;
      }

      const report = assertRejectedRoot(linkedRoot, 'cache-root-symbolic-link');

      assert.equal(report.summary.count, 0);
      assert.equal(fs.existsSync(path.join(workspace, '.turbo', 'state.json')), true);
      assert.equal(JSON.stringify(report).includes(linkedRoot), false);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('retains canonical root, path and stable identity metadata from the scan', () => {
    const fixture = makeFixture();
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      const candidate = scanCacheTargets(workspace)
        .find((item) => item.relativePath === '.turbo');

      assert.ok(candidate);
      assert.equal(candidate.canonicalRoot, fs.realpathSync(workspace));
      assert.equal(candidate.canonicalPath, fs.realpathSync(candidate.absolutePath));
      assert.deepEqual(candidate.identity, stableIdentity(candidate.absolutePath));
      assert.deepEqual(candidate.rootIdentity, stableIdentity(candidate.canonicalRoot));
    } finally {
      cleanupFixture(fixture);
    }
  });
});

function createWorkspaceCaches(root) {
  const workspace = path.join(root, 'workspace');
  writeFile(path.join(workspace, '.next', 'cache', 'page.bin'), 'next-cache');
  writeFile(path.join(workspace, '.turbo', 'state.json'), 'turbo-cache');
  writeFile(path.join(workspace, 'node_modules', '.cache', 'vite', 'index'), 'vite-cache');
  writeFile(path.join(workspace, 'packages', 'app', '.vite', 'deps.js'), 'vite-cache');
  writeFile(path.join(workspace, 'src', '__pycache__', 'mod.pyc'), 'python-cache');
  writeFile(path.join(workspace, 'src', 'not-cache', 'data.txt'), 'keep');
  return workspace;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

function stableIdentity(target) {
  const stat = fs.lstatSync(target, { bigint: true });
  if (stat.ino === 0n) return null;
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}

function assertRejectedRoot(root, code) {
  const candidates = scanCacheTargets(root);
  assert.equal(Array.isArray(candidates), true);
  assert.equal(candidates.safe, false);
  assert.equal(candidates.errors.length, 1);
  assert.equal(candidates.errors[0].code, code);

  const report = buildCacheReport({ root });
  assert.equal(report.status, 'blocked');
  assert.equal(report.safe, false);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.summary.status, 'blocked');
  assert.equal(report.summary.errorCount, 1);
  assert.equal(report.errors[0].code, code);
  return report;
}

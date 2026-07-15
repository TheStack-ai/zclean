'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cleanCacheTargets, runCache, scanCacheTargets } = require('../src/cache');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('workspace cache cleanup safety', () => {
  it('skips a cache directory replaced after scan and preserves both directories', () => {
    const fixture = makeFixture();
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const cachePath = path.join(workspace, '.turbo');
      const originalPath = path.join(fixture.root, 'original-cache');
      writeFile(path.join(cachePath, 'original.txt'), 'original-cache');

      const candidates = scanCacheTargets(workspace);
      fs.renameSync(cachePath, originalPath);
      writeFile(path.join(cachePath, 'replacement.txt'), 'replacement-cache');

      const result = cleanCacheTargets(candidates);

      assertSkippedWithoutDeletion(result, 'cache-path-identity-changed');
      assert.equal(fs.readFileSync(path.join(originalPath, 'original.txt'), 'utf-8'), 'original-cache');
      assert.equal(fs.readFileSync(path.join(cachePath, 'replacement.txt'), 'utf-8'), 'replacement-cache');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('does not delete a replacement directory swapped in at the quarantine rename', () => {
    const fixture = makeFixture();
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const cachePath = path.join(workspace, '.turbo');
      const movedCachePath = path.join(fixture.root, 'moved-cache');
      const valuablePath = path.join(workspace, 'valuable-data');
      const valuableFile = path.join(valuablePath, 'important.txt');
      writeFile(path.join(cachePath, 'state.json'), 'cache-data');
      writeFile(valuableFile, 'valuable-data');
      const candidates = scanCacheTargets(workspace);
      const scannedCachePath = candidates.find((candidate) => candidate.relativePath === '.turbo').absolutePath;

      let swapped = false;
      const result = cleanCacheTargets(candidates, {
        renameSync(source, destination) {
          if (!swapped && source === scannedCachePath) {
            swapped = true;
            fs.renameSync(scannedCachePath, movedCachePath);
            fs.renameSync(valuablePath, scannedCachePath);
          }
          fs.renameSync(source, destination);
        },
      });

      assert.equal(swapped, true);
      assertSkippedWithoutDeletion(result, 'cache-quarantine-identity-changed');
      assert.equal(fs.readFileSync(path.join(cachePath, 'important.txt'), 'utf8'), 'valuable-data');
      assert.equal(fs.readFileSync(path.join(movedCachePath, 'state.json'), 'utf8'), 'cache-data');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('does not recursively delete unrelated data replacing the verified quarantine path', () => {
    const fixture = makeFixture();
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const cachePath = path.join(workspace, '.turbo');
      const movedCachePath = path.join(fixture.root, 'moved-cache');
      const unrelatedPath = path.join(workspace, 'unrelated-data');
      writeFile(path.join(cachePath, 'state.json'), 'cache-data');
      writeFile(path.join(unrelatedPath, 'state.json'), 'must-survive');
      const candidates = scanCacheTargets(workspace);
      const scannedCachePath = candidates.find((candidate) => candidate.relativePath === '.turbo').absolutePath;
      let quarantinedPath = null;
      let swapped = false;
      let recursiveRemovalRequested = false;

      const result = cleanCacheTargets(candidates, {
        renameSync(source, destination) {
          fs.renameSync(source, destination);
          if (source === scannedCachePath) quarantinedPath = destination;
        },
        rmSync(target, options) {
          recursiveRemovalRequested ||= Boolean(options?.recursive);
          if (!swapped) {
            swapped = true;
            fs.renameSync(quarantinedPath, movedCachePath);
            fs.renameSync(unrelatedPath, quarantinedPath);
          }
          fs.rmSync(target, options);
        },
      });

      assert.equal(swapped, true);
      assert.equal(fs.readFileSync(path.join(cachePath, 'state.json'), 'utf-8'), 'must-survive');
      assert.equal(recursiveRemovalRequested, false);
      assert.equal(result.deleted.length, 0);
      assert.equal(result.failed.length, 1);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('skips a cache path whose type changes after scan', () => {
    const fixture = makeFixture();
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const cachePath = path.join(workspace, '.turbo');
      writeFile(path.join(cachePath, 'state.json'), 'original-cache');

      const candidates = scanCacheTargets(workspace);
      fs.rmSync(cachePath, { recursive: true });
      fs.writeFileSync(cachePath, 'replacement-file', 'utf-8');

      const result = cleanCacheTargets(candidates);

      assertSkippedWithoutDeletion(result, 'cache-path-type-changed');
      assert.equal(fs.readFileSync(cachePath, 'utf-8'), 'replacement-file');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('skips a cache path replaced by an escaping directory symlink', (t) => {
    const fixture = makeFixture();
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const cachePath = path.join(workspace, '.turbo');
      const outsidePath = path.join(fixture.root, 'outside-symlink-target');
      const outsideFile = path.join(outsidePath, 'outside.txt');
      writeFile(path.join(cachePath, 'state.json'), 'original-cache');
      writeFile(outsideFile, 'outside-data');

      const candidates = scanCacheTargets(workspace);
      fs.rmSync(cachePath, { recursive: true });
      try {
        fs.symlinkSync(outsidePath, cachePath, 'dir');
      } catch (err) {
        if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EACCES')) {
          t.skip(`directory symlinks unavailable: ${err.code}`);
          return;
        }
        throw err;
      }

      const result = cleanCacheTargets(candidates);

      assertSkippedWithoutDeletion(result, 'cache-path-outside-root');
      assert.equal(fs.lstatSync(cachePath).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(outsideFile, 'utf-8'), 'outside-data');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('does not scan or delete a node_modules cache reached through a Windows junction', () => {
    const fixture = makeFixture();
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const nodeModules = path.join(workspace, 'node_modules');
      const junctionPath = path.join(nodeModules, '.cache');
      const outsidePath = path.join(fixture.root, 'outside-junction-target');
      const outsideFile = path.join(outsidePath, 'outside.txt');
      fs.mkdirSync(nodeModules, { recursive: true });
      writeFile(outsideFile, 'outside-data');
      fs.symlinkSync(outsidePath, junctionPath, 'junction');

      const candidates = scanCacheTargets(workspace);
      const result = cleanCacheTargets(candidates);

      assert.deepEqual(candidates, []);
      assert.equal(result.deleted.length, 0);
      assert.equal(result.failed.length, 0);
      assert.equal(result.skipped.length, 0);
      assert.equal(fs.lstatSync(junctionPath).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(outsideFile, 'utf-8'), 'outside-data');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('reports cleanup failures and exposes a non-success outcome without absolute paths', () => {
    const fixture = makeFixture();
    const output = [];
    const originalLog = console.log;
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      console.log = (...values) => output.push(values.join(' '));

      const report = runCache({
        root: workspace,
        yes: true,
        appendLog() {},
        rmSync(target) {
          const error = new Error(`cannot remove ${target}`);
          error.code = 'EACCES';
          throw error;
        },
      });

      assert.equal(report.status, 'incomplete');
      assert.equal(report.safe, false);
      assert.equal(report.ok, false);
      assert.equal(report.exitCode, 1);
      assert.equal(report.summary.failed, 5);
      assert.equal(report.summary.errorCount, 5);
      assert.equal(report.failed.length, 5);
      assert.equal(report.errors.length, 5);
      assert.ok(report.failed.every((item) => item.error.code === 'cache-delete-failed'));
      assert.ok(report.failed.every((item) => item.error.causeCode === 'EACCES'));
      assert.equal(JSON.stringify(report).includes(workspace), false);
      assert.equal(output.join('\n').includes(workspace), false);
      assert.equal(output.join('\n').includes('FAIL'), true);
      assert.equal(fs.existsSync(path.join(workspace, '.next', 'cache')), true);
    } finally {
      console.log = originalLog;
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

function assertSkippedWithoutDeletion(result, code) {
  assert.equal(result.deleted.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.skipped[0].reason, { code });
}

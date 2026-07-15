'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildCacheReport,
  cleanCacheTargets,
  runCache,
  scanCacheTargets,
} = require('../src/cache');
const {
  cleanupFixture,
  makeFixture,
  parseStdoutJson,
  runCli,
} = require('./cli-helpers');

describe('workspace cache hygiene', () => {
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

  it('does not delete a replacement directory swapped in after the final precheck', () => {
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

      const result = cleanCacheTargets(candidates, {
        rmSync(target, options) {
          if (fs.existsSync(cachePath) && !fs.existsSync(movedCachePath)) {
            fs.renameSync(cachePath, movedCachePath);
            fs.renameSync(valuablePath, cachePath);
          }
          fs.rmSync(target, options);
        },
      });

      assert.equal(result.ok, true);
      assert.equal(fs.existsSync(valuableFile), true);
      assert.equal(fs.readFileSync(valuableFile, 'utf8'), 'valuable-data');
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

  it('prints safe cache JSON without deleting unless --yes is passed', () => {
    const fixture = makeFixture();
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      const result = runCli(['cache', `--path=${workspace}`, '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);

      const report = parseStdoutJson(result);
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.kind, 'workspace-cache-hygiene');
      assert.equal(report.dryRun, true);
      assert.equal(report.status, 'safe');
      assert.equal(report.safe, true);
      assert.equal(report.ok, true);
      assert.equal(report.exitCode, 0);
      assert.deepEqual(report.errors, []);
      assert.equal(report.workspace, path.basename(workspace));
      assert.equal(report.summary.count, 5);
      assert.equal(JSON.stringify(report).includes(workspace), false);
      assert.equal(Object.prototype.hasOwnProperty.call(report, '_privateCandidates'), false);
      assert.ok(fs.existsSync(path.join(workspace, '.next', 'cache')));
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('removes supported workspace caches only when --yes is passed', () => {
    const fixture = makeFixture();
    try {
      const workspace = createWorkspaceCaches(fixture.root);
      const keepFile = path.join(workspace, 'src', 'keep.txt');
      fs.writeFileSync(keepFile, 'do not delete', 'utf-8');

      const result = runCli(['cache', `--path=${workspace}`, '--yes', '--json'], { fixture });
      assert.equal(result.status, 0, result.stderr);

      const report = parseStdoutJson(result);
      assert.equal(report.dryRun, false);
      assert.equal(report.status, 'safe');
      assert.equal(report.safe, true);
      assert.equal(report.ok, true);
      assert.equal(report.exitCode, 0);
      assert.deepEqual(report.errors, []);
      assert.equal(report.summary.deleted, 5);
      assert.equal(report.summary.failed, 0);
      assert.equal(report.summary.skipped, 0);
      assert.deepEqual(report.skipped, []);
      assert.equal(fs.existsSync(path.join(workspace, '.next', 'cache')), false);
      assert.equal(fs.existsSync(path.join(workspace, 'node_modules', '.cache')), false);
      assert.equal(fs.existsSync(keepFile), true);
      assert.equal(JSON.stringify(report).includes(workspace), false);
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

function assertSkippedWithoutDeletion(result, code) {
  assert.equal(result.deleted.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.skipped[0].reason, { code });
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

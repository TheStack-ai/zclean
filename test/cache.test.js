'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scanCacheTargets } = require('../src/cache');
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
      assert.equal(report.summary.deleted, 5);
      assert.equal(report.summary.failed, 0);
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

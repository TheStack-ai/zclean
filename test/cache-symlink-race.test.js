'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanCacheTargets, scanCacheTargets } = require('../src/cache');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

it('does not follow a quarantined child replaced by an external directory symlink', (t) => {
  const fixture = makeFixture();
  try {
    const workspace = path.join(fixture.root, 'workspace');
    const cachePath = path.join(workspace, '.turbo');
    const outsidePath = path.join(fixture.root, 'outside-data');
    const outsideFile = path.join(outsidePath, 'important.txt');
    writeFile(path.join(cachePath, 'nested', 'state.json'), 'cache-data');
    writeFile(outsideFile, 'must-survive');
    const candidates = scanCacheTargets(workspace);
    let quarantinedPath = null;
    let swapped = false;

    const result = cleanCacheTargets(candidates, {
      renameSync(source, destination) {
        fs.renameSync(source, destination);
        if (!quarantinedPath) quarantinedPath = destination;
      },
      lstatSync(target) {
        const stat = fs.lstatSync(target);
        if (!swapped && quarantinedPath && target !== quarantinedPath && stat.isDirectory()) {
          fs.rmSync(target, { recursive: true });
          try {
            fs.symlinkSync(outsidePath, target, 'dir');
          } catch (error) {
            if (process.platform === 'win32'
              && (error.code === 'EPERM' || error.code === 'EACCES')) {
              t.skip(`directory symlinks unavailable: ${error.code}`);
              return stat;
            }
            throw error;
          }
          swapped = true;
        }
        return stat;
      },
    });

    assert.equal(swapped, true);
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'must-survive');
    assert.equal(result.failed.length, 1);
  } finally {
    cleanupFixture(fixture);
  }
});

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

it('does not remove a directory replacing a staged cache child', () => {
  const fixture = makeFixture();
  try {
    const workspace = path.join(fixture.root, 'workspace');
    const cachePath = path.join(workspace, '.turbo');
    const movedCachePath = path.join(fixture.root, 'moved-cache-child');
    const unrelatedPath = path.join(fixture.root, 'unrelated-data');
    writeFile(path.join(cachePath, 'nested', 'state.json'), 'cache-data');
    writeFile(path.join(unrelatedPath, 'important.txt'), 'must-survive');
    const candidates = scanCacheTargets(workspace);
    let stagedPath = null;
    let swapped = false;

    const result = cleanCacheTargets(candidates, {
      renameSync(source, destination) {
        fs.renameSync(source, destination);
        if (path.basename(path.dirname(destination)).startsWith('.zclean-delete-')) {
          stagedPath = destination;
        }
      },
      lstatSync(target) {
        const stat = fs.lstatSync(target);
        if (!swapped && stagedPath && target === stagedPath && stat.isDirectory()) {
          fs.renameSync(target, movedCachePath);
          fs.renameSync(unrelatedPath, target);
          swapped = true;
        }
        return stat;
      },
    });

    assert.equal(swapped, true);
    assert.equal(fs.readFileSync(path.join(stagedPath, 'important.txt'), 'utf8'), 'must-survive');
    assert.equal(result.deleted.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].error.code, 'cache-recovery-failed');
  } finally {
    cleanupFixture(fixture);
  }
});

it('does not recursively delete a directory swapped in by the removal adapter', () => {
  const fixture = makeFixture();
  try {
    const workspace = path.join(fixture.root, 'workspace');
    const cachePath = path.join(workspace, '.turbo');
    const movedCachePath = path.join(fixture.root, 'moved-staged-cache');
    const unrelatedPath = path.join(fixture.root, 'late-unrelated-data');
    const unrelatedFile = path.join(unrelatedPath, 'important.bin');
    writeFile(path.join(cachePath, 'nested', 'state.json'), 'cache-data');
    writeFile(unrelatedFile, 'must-survive-late-swap');
    const candidates = scanCacheTargets(workspace);
    let swapped = false;

    const result = cleanCacheTargets(candidates, {
      rmSync(target, options) {
        if (!swapped && options?.recursive) {
          fs.renameSync(target, movedCachePath);
          fs.renameSync(unrelatedPath, target);
          swapped = true;
        }
        fs.rmSync(target, options);
      },
    });

    assert.equal(swapped, false);
    assert.equal(fs.readFileSync(unrelatedFile, 'utf8'), 'must-survive-late-swap');
    assert.equal(result.deleted.length, 1);
    assert.equal(result.failed.length, 0);
  } finally {
    cleanupFixture(fixture);
  }
});

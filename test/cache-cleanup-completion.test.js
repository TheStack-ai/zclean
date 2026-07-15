'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanCacheTargets, scanCacheTargets } = require('../src/cache');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('workspace cache cleanup completion', () => {
  it('removes every private staging path after repeated successful cleanup', () => {
    const fixture = makeFixture();
    const workspace = path.join(fixture.root, 'workspace');

    try {
      for (let run = 0; run < 3; run++) {
        const cacheFile = path.join(workspace, '.turbo', `state-${run}.bin`);
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, `cache-${run}`);

        const result = cleanCacheTargets(scanCacheTargets(workspace));

        assert.equal(result.ok, true);
        assert.equal(result.deleted.length, 1);
        assert.equal(result.failed.length, 0);
        assert.deepEqual(privateStagingNames(workspace), []);
      }
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('fails without truncating when a hard link appears while the staged file opens', (t) => {
    const fixture = makeFixture();
    const workspace = path.join(fixture.root, 'workspace');
    const cacheFile = path.join(workspace, '.turbo', 'state.bin');
    const outsideFile = path.join(fixture.root, 'outside.bin');

    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, 'must-survive-racing-link');
      try {
        fs.linkSync(cacheFile, outsideFile);
        fs.unlinkSync(outsideFile);
      } catch (error) {
        if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error.code)) {
          t.skip(`hard links unavailable: ${error.code}`);
          return;
        }
        throw error;
      }

      let linked = false;
      const result = cleanCacheTargets(scanCacheTargets(workspace), {
        openSync(target, flags) {
          fs.linkSync(target, outsideFile);
          linked = true;
          return fs.openSync(target, flags);
        },
      });

      assert.equal(linked, true);
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.equal(result.deleted.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(fs.readFileSync(cacheFile, 'utf8'), 'must-survive-racing-link');
      assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'must-survive-racing-link');
    } finally {
      cleanupFixture(fixture);
    }
  });

  it('fails without truncating when a hard link appears during path detachment', (t) => {
    const fixture = makeFixture();
    const workspace = path.join(fixture.root, 'workspace');
    const cacheFile = path.join(workspace, '.turbo', 'state.bin');
    const outsideFile = path.join(fixture.root, 'outside-detached.bin');

    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, 'must-survive-detach-race');
      try {
        fs.linkSync(cacheFile, outsideFile);
        fs.unlinkSync(outsideFile);
      } catch (error) {
        if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error.code)) {
          t.skip(`hard links unavailable: ${error.code}`);
          return;
        }
        throw error;
      }

      let linked = false;
      const result = cleanCacheTargets(scanCacheTargets(workspace), {
        unlinkSync(target) {
          if (!linked) {
            fs.linkSync(target, outsideFile);
            linked = true;
          }
          fs.unlinkSync(target);
        },
      });

      assert.equal(linked, true);
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.equal(result.deleted.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'must-survive-detach-race');
      assert.deepEqual(privateStagingNames(workspace), []);
    } finally {
      cleanupFixture(fixture);
    }
  });
});

function privateStagingNames(workspace) {
  return fs.readdirSync(workspace)
    .filter((name) => name.startsWith('.zclean-quarantine-') || name.startsWith('.zclean-delete-'));
}

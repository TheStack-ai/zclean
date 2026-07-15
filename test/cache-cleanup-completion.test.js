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
});

function privateStagingNames(workspace) {
  return fs.readdirSync(workspace)
    .filter((name) => name.startsWith('.zclean-quarantine-') || name.startsWith('.zclean-delete-'));
}

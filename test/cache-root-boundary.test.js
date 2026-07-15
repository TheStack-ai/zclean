'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCacheReport, runCache } = require('../src/cache');
const { cleanupFixture, makeFixture } = require('./cli-helpers');

describe('cache root boundary', () => {
  it('blocks explicit empty and non-string roots before cleanup', () => {
    const fixture = makeFixture();
    const originalCwd = process.cwd();
    const originalLog = console.log;
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const sentinel = path.join(workspace, '.turbo', 'state.json');
      const invalidRoots = ['', '   ', null, false, 0, true, {}];
      writeFile(sentinel, 'must-survive');
      process.chdir(workspace);
      console.log = () => {};

      for (const root of invalidRoots) {
        writeFile(sentinel, 'must-survive');

        const preview = buildCacheReport({ root, yes: true });
        const report = runCache({ root, yes: true, appendLog() {} });

        assert.equal(fs.existsSync(sentinel), true, `explicit root ${String(root)} deleted cwd data`);
        assertBlockedRootReport(preview);
        assertBlockedRootReport(report);
      }
    } finally {
      console.log = originalLog;
      process.chdir(originalCwd);
      cleanupFixture(fixture);
    }
  });

  it('uses cwd intentionally when root is undefined', () => {
    const fixture = makeFixture();
    const originalCwd = process.cwd();
    const originalLog = console.log;
    try {
      const workspace = path.join(fixture.root, 'workspace');
      const sentinel = path.join(workspace, '.turbo', 'state.json');
      writeFile(sentinel, 'cache-data');
      process.chdir(workspace);
      console.log = () => {};

      const preview = buildCacheReport({ root: undefined });
      const report = runCache({ root: undefined, yes: true, appendLog() {} });

      assert.equal(preview.safe, true);
      assert.equal(preview.summary.count, 1);
      assert.equal(report.exitCode, 0);
      assert.equal(report.summary.deleted, 1);
      assert.equal(fs.existsSync(sentinel), false);
    } finally {
      console.log = originalLog;
      process.chdir(originalCwd);
      cleanupFixture(fixture);
    }
  });
});

function assertBlockedRootReport(report) {
  assert.equal(report.status, 'blocked');
  assert.equal(report.safe, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.errors[0]?.code, 'cache-root-invalid');
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

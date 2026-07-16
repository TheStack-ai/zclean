'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const bin = path.join(__dirname, '..', 'bin', 'zclean.js');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-cli-test-'));
  const home = path.join(root, 'home');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ZCLEAN_CONFIG_DIR: path.join(root, 'config'),
    NO_COLOR: '1',
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.mkdirSync(env.ZCLEAN_CONFIG_DIR, { recursive: true });
  return { root, env, home: env.HOME, configDir: env.ZCLEAN_CONFIG_DIR };
}

function cleanupFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function runCli(args, options = {}) {
  const fixture = options.fixture || makeFixture();

  try {
    return spawnSync(process.execPath, [bin, ...args], {
      env: fixture.env,
      encoding: 'utf-8',
      timeout: 10000,
    });
  } finally {
    if (!options.fixture) cleanupFixture(fixture);
  }
}

function parseStdoutJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    assert.fail(`stdout was not valid JSON: ${err.message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

module.exports = {
  cleanupFixture,
  makeFixture,
  parseStdoutJson,
  runCli,
};

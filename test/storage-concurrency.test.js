'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { describe, it } = require('node:test');
const { appendPrivateFile, writePrivateFile } = require('../src/storage-security');
const { loadConfig } = require('../src/config');

describe('private storage concurrency', () => {
  it('opens history with append semantics', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-history-append-flags-'));
    const file = path.join(root, 'history.jsonl');
    const originalOpen = fs.openSync;
    const observedFlags = [];

    try {
      fs.openSync = function patchedOpen(target, flags, ...rest) {
        if (target === file) observedFlags.push(flags);
        return originalOpen.call(fs, target, flags, ...rest);
      };
      appendPrivateFile(file, '{"action":"test"}\n');
    } finally {
      fs.openSync = originalOpen;
      fs.rmSync(root, { recursive: true, force: true });
    }

    assert.ok(observedFlags.some((flags) => (flags & fs.constants.O_APPEND) !== 0));
  });

  it('keeps all records from concurrent writers', { timeout: 15000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-history-concurrent-'));
    const configModule = path.join(__dirname, '..', 'src', 'config.js');
    const writers = 8;
    const recordsPerWriter = 12;
    const script = [
      'process.env.ZCLEAN_CONFIG_DIR = process.argv[1];',
      `const { appendLog } = require(${JSON.stringify(configModule)});`,
      `for (let i = 0; i < ${recordsPerWriter}; i++) {`,
      "  appendLog({ action: 'concurrent-test', writer: process.argv[2], index: i });",
      '}',
    ].join('\n');

    try {
      const exits = await Promise.all(Array.from({ length: writers }, (_, writer) => (
        runChild(process.execPath, ['-e', script, root, String(writer)])
      )));
      assert.deepEqual(exits, Array(writers).fill(0));

      const lines = fs.readFileSync(path.join(root, 'history.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
      const identities = new Set(lines.map((entry) => `${entry.writer}:${entry.index}`));
      assert.equal(lines.length, writers * recordsPerWriter);
      assert.equal(identities.size, writers * recordsPerWriter);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to write after the private directory identity changes', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-storage-dir-swap-'));
    const directory = path.join(parent, 'private');
    const moved = path.join(parent, 'private-original');
    const file = path.join(directory, 'config.json');
    const originalOpen = fs.openSync;
    let swapped = false;
    fs.mkdirSync(directory);

    try {
      fs.openSync = function patchedOpen(target, flags, ...rest) {
        if (!swapped && String(target).includes('.config.json.') && (flags & fs.constants.O_CREAT)) {
          swapped = true;
          fs.renameSync(directory, moved);
          fs.mkdirSync(directory);
          fs.writeFileSync(path.join(directory, 'important.txt'), 'keep-me');
        }
        return originalOpen.call(fs, target, flags, ...rest);
      };

      assert.throws(
        () => writePrivateFile(file, '{"safe":true}\n'),
        (error) => error?.code === 'ZCLEAN_UNSAFE_STORAGE'
      );
      assert.equal(fs.existsSync(file), false);
      assert.equal(fs.readFileSync(path.join(directory, 'important.txt'), 'utf8'), 'keep-me');
    } finally {
      fs.openSync = originalOpen;
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('fails closed instead of ignoring an unreadable config and its whitelist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-invalid-config-'));
    const originalConfigDir = process.env.ZCLEAN_CONFIG_DIR;
    process.env.ZCLEAN_CONFIG_DIR = root;
    fs.writeFileSync(
      path.join(root, 'config.json'),
      '{"whitelist":["critical-process"],"broken":',
      'utf8'
    );

    try {
      assert.throws(
        () => loadConfig(),
        (error) => error?.code === 'ZCLEAN_INVALID_CONFIG'
      );
    } finally {
      if (originalConfigDir === undefined) delete process.env.ZCLEAN_CONFIG_DIR;
      else process.env.ZCLEAN_CONFIG_DIR = originalConfigDir;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates a config identity change instead of falling back to defaults', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-config-read-swap-'));
    const file = path.join(root, 'config.json');
    const originalFile = path.join(root, 'config-original.json');
    const originalConfigDir = process.env.ZCLEAN_CONFIG_DIR;
    const originalOpen = fs.openSync;
    let fileOpens = 0;
    process.env.ZCLEAN_CONFIG_DIR = root;
    fs.writeFileSync(file, JSON.stringify({ whitelist: ['critical-process'] }));

    try {
      fs.openSync = function patchedOpen(target, flags, ...rest) {
        if (target === file) {
          fileOpens += 1;
          if (fileOpens === 2) {
            fs.renameSync(file, originalFile);
            fs.writeFileSync(file, JSON.stringify({ whitelist: [] }));
          }
        }
        return originalOpen.call(fs, target, flags, ...rest);
      };

      assert.throws(
        () => loadConfig(),
        (error) => error?.code === 'ZCLEAN_UNSAFE_STORAGE'
      );
      assert.equal(fileOpens, 2);
    } finally {
      fs.openSync = originalOpen;
      if (originalConfigDir === undefined) delete process.env.ZCLEAN_CONFIG_DIR;
      else process.env.ZCLEAN_CONFIG_DIR = originalConfigDir;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function runChild(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
}

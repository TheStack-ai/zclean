'use strict';

const fs = require('node:fs');
const path = require('node:path');

function writeJsonAtomic(filePath, value, options = {}) {
  const runtimeFs = options.fs || fs;
  const directory = path.dirname(filePath);
  const tempName = options.tempName || createTempName(path.basename(filePath));
  if (!tempName || path.basename(tempName) !== tempName) {
    return { ok: false, error: new Error('Atomic JSON temp name must stay in the destination directory.') };
  }
  const tempPath = path.join(directory, tempName);
  let initial;

  try {
    initial = readDestination(runtimeFs, filePath);
    if (initial && initial.type !== 'file') {
      throw new Error('Atomic JSON destination must be a regular file.');
    }
    if (options.expectedSource !== undefined
      && (!initial || initial.source !== options.expectedSource)) {
      throw new Error('Atomic JSON destination changed before write.');
    }

    const mode = initial ? initial.mode : 0o600;
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    runtimeFs.writeFileSync(tempPath, serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode,
    });
    runtimeFs.chmodSync(tempPath, mode);

    const current = readDestination(runtimeFs, filePath);
    if (!sameDestination(initial, current)) {
      throw new Error('Atomic JSON destination identity changed before rename.');
    }
    if (options.expectedSource !== undefined
      && (!current || current.source !== options.expectedSource)) {
      throw new Error('Atomic JSON destination content changed before rename.');
    }

    runtimeFs.renameSync(tempPath, filePath);
    return { ok: true };
  } catch (error) {
    try {
      if (runtimeFs.existsSync(tempPath)) runtimeFs.unlinkSync(tempPath);
    } catch {}
    return { ok: false, error };
  }
}

function readDestination(runtimeFs, filePath) {
  if (!runtimeFs.existsSync(filePath)) return null;
  const stat = runtimeFs.lstatSync(filePath, { bigint: true });
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: Number(stat.mode & 0o777n),
    source: runtimeFs.readFileSync(filePath, 'utf8'),
    type: stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other',
  };
}

function sameDestination(left, right) {
  if (left === null || right === null) return left === right;
  return left.type === right.type && left.dev === right.dev && left.ino === right.ino;
}

function createTempName(basename) {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `.${basename}.zclean-${nonce}.tmp`;
}

module.exports = { writeJsonAtomic };

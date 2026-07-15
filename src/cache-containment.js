'use strict';

const fs = require('node:fs');
const path = require('node:path');

function canonicalDirectoryState(value) {
  let canonicalPath;
  try {
    canonicalPath = fs.realpathSync(value);
  } catch {
    return null;
  }

  const state = readPathState(canonicalPath);
  if (state.lstatError || state.realpathError || state.type !== 'directory') return null;
  if (!samePath(state.canonicalPath, canonicalPath)) return null;
  return state;
}

function containedDirectoryState(value, canonicalRoot) {
  const state = readPathState(value);
  if (state.lstatError || state.realpathError || state.type !== 'directory') return null;
  if (!isInsideRoot(canonicalRoot, state.canonicalPath)) return null;
  return state;
}

function preDeleteSkipReason(candidate) {
  if (!hasScanMetadata(candidate)) return { code: 'cache-scan-metadata-missing' };

  const rootState = readPathState(candidate.canonicalRoot);
  if (rootState.lstatError) {
    return { code: rootState.lstatError.code === 'ENOENT' ? 'cache-root-missing' : 'cache-root-lstat-unverified' };
  }
  if (rootState.type !== 'directory') return { code: 'cache-root-type-changed' };
  if (rootState.realpathError) return { code: 'cache-root-realpath-unverified' };
  if (!samePath(rootState.canonicalPath, candidate.canonicalRoot)) {
    return { code: 'cache-root-canonical-changed' };
  }
  if (!sameIdentity(candidate.rootIdentity, rootState.identity)) {
    return { code: 'cache-root-identity-changed' };
  }

  const state = readPathState(candidate.absolutePath);
  if (state.lstatError) {
    return { code: state.lstatError.code === 'ENOENT' ? 'cache-path-missing' : 'cache-path-lstat-unverified' };
  }
  if (state.realpathError) {
    if (state.type !== candidate.type) return { code: 'cache-path-type-changed' };
    return { code: 'cache-path-realpath-unverified' };
  }
  if (!isInsideRoot(candidate.canonicalRoot, state.canonicalPath)) {
    return { code: 'cache-path-outside-root' };
  }
  if (state.type !== candidate.type) return { code: 'cache-path-type-changed' };
  if (!samePath(state.canonicalPath, candidate.canonicalPath)) {
    return { code: 'cache-path-canonical-changed' };
  }
  if (!sameIdentity(candidate.identity, state.identity)) {
    return { code: 'cache-path-identity-changed' };
  }
  return null;
}

function directorySize(dir, canonicalRoot) {
  const state = containedDirectoryState(dir, canonicalRoot);
  if (!state) return 0;

  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(state.canonicalPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const file = path.join(state.canonicalPath, entry.name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) total += directorySize(file, canonicalRoot);
      else if (stat.isFile()) total += stat.size;
    } catch {}
  }
  return total;
}

function readPathState(value) {
  let stat = null;
  let lstatError = null;
  let canonicalPath = null;
  let realpathError = null;

  try {
    stat = fs.lstatSync(value, { bigint: true });
  } catch (error) {
    lstatError = error;
  }
  try {
    canonicalPath = fs.realpathSync(value);
  } catch (error) {
    realpathError = error;
  }

  return {
    canonicalPath,
    identity: stat ? stableIdentity(stat) : null,
    lstatError,
    realpathError,
    type: stat ? pathType(stat) : null,
  };
}

function hasScanMetadata(candidate) {
  if (!candidate || typeof candidate.absolutePath !== 'string' || typeof candidate.canonicalRoot !== 'string') {
    return false;
  }
  if (typeof candidate.canonicalPath !== 'string' || candidate.type !== 'directory') return false;
  if (!validIdentity(candidate.identity) || !validIdentity(candidate.rootIdentity)) return false;
  if (!isInsideRoot(candidate.canonicalRoot, path.resolve(candidate.absolutePath))) return false;
  return isInsideRoot(candidate.canonicalRoot, candidate.canonicalPath);
}

function validIdentity(identity) {
  return identity === null || (
    identity
    && typeof identity.dev === 'string'
    && typeof identity.ino === 'string'
  );
}

function stableIdentity(stat) {
  if ((typeof stat.dev !== 'bigint' && typeof stat.dev !== 'number')
    || (typeof stat.ino !== 'bigint' && typeof stat.ino !== 'number')
    || stat.ino === 0n
    || stat.ino === 0) {
    return null;
  }
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}

function sameIdentity(scanned, current) {
  if (scanned === null) return true;
  return current !== null && scanned.dev === current.dev && scanned.ino === current.ino;
}

function pathType(stat) {
  if (stat.isSymbolicLink()) return 'symbolic-link';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  return 'other';
}

function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string' && path.relative(left, right) === '';
}

function isInsideRoot(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') return false;
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

module.exports = {
  canonicalDirectoryState,
  containedDirectoryState,
  directorySize,
  preDeleteSkipReason,
};

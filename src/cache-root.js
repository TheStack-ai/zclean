'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalDirectoryState } = require('./cache-containment');

function validateCacheRoot(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return invalidRoot('cache-root-invalid', 'Workspace cache root must be a directory path.');
  }

  let resolvedRoot;
  try {
    resolvedRoot = path.resolve(value);
  } catch {
    return invalidRoot('cache-root-invalid', 'Workspace cache root must be a directory path.');
  }

  if (isFilesystemRoot(value, resolvedRoot)) {
    return invalidRoot('cache-root-filesystem-root', 'Filesystem and drive roots cannot be used for workspace cache hygiene.');
  }

  let stat;
  try {
    stat = fs.lstatSync(resolvedRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return invalidRoot('cache-root-missing', 'Workspace cache root does not exist.');
    }
    return invalidRoot('cache-root-unreadable', 'Workspace cache root could not be inspected safely.', error);
  }

  if (stat.isSymbolicLink()) {
    return invalidRoot('cache-root-symbolic-link', 'Workspace cache root cannot be a symbolic link or junction.');
  }
  if (!stat.isDirectory()) {
    return invalidRoot('cache-root-not-directory', 'Workspace cache root is not a directory.');
  }

  const rootState = canonicalDirectoryState(resolvedRoot);
  if (!rootState) {
    return invalidRoot('cache-root-unresolved', 'Workspace cache root could not be resolved safely.');
  }
  if (isFilesystemRoot(rootState.canonicalPath, rootState.canonicalPath)) {
    return invalidRoot('cache-root-filesystem-root', 'Filesystem and drive roots cannot be used for workspace cache hygiene.');
  }
  if (samePath(rootState.canonicalPath, canonicalHomeDirectory())) {
    return invalidRoot('cache-root-home-directory', 'The user home directory cannot be used for workspace cache hygiene.');
  }

  return { ok: true, rootState };
}

function structuredError(code, message, cause) {
  const error = { code, message };
  if (cause && typeof cause.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code)) {
    error.causeCode = cause.code;
  }
  return error;
}

function invalidRoot(code, message, cause) {
  return { ok: false, error: structuredError(code, message, cause) };
}

function canonicalHomeDirectory() {
  try {
    return fs.realpathSync(os.homedir());
  } catch {
    return path.resolve(os.homedir());
  }
}

function isFilesystemRoot(requestedRoot, resolvedRoot) {
  if (samePath(path.parse(resolvedRoot).root, resolvedRoot)) return true;
  const windowsRoot = path.win32.parse(requestedRoot).root;
  return windowsRoot !== '' && path.win32.relative(windowsRoot, requestedRoot) === '';
}

function samePath(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && path.relative(left, right) === '';
}

module.exports = { structuredError, validateCacheRoot };

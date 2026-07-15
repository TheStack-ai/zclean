'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  containedDirectoryState,
  directorySize,
} = require('./cache-containment');
const { structuredError, validateCacheRoot } = require('./cache-root');

const EXACT_CACHE_PATHS = new Set([
  '.next/cache',
  '.nuxt',
  '.turbo',
  '.vite',
  '.parcel-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  'node_modules/.cache',
]);
const CACHE_DIR_NAMES = new Set(['__pycache__']);
const CACHE_DIR_NAMES_ANYWHERE = new Set([
  '.nuxt',
  '.turbo',
  '.vite',
  '.parcel-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
]);
const SKIP_DIR_NAMES = new Set(['.git', '.hg', '.svn', '.omo', '.zclean']);
const MAX_SCAN_DEPTH = 5;

function scanCacheTargets(root) {
  const requestedRoot = root === undefined ? process.cwd() : root;
  const validation = validateCacheRoot(requestedRoot);
  if (!validation.ok) return attachScanState([], [validation.error], null);

  const { rootState } = validation;
  const found = [];
  const errors = [];
  walk(rootState, rootState.canonicalPath, 0, found, errors);
  found.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return attachScanState(found, errors, rootState);
}

function walk(rootState, current, depth, found, errors) {
  if (depth > MAX_SCAN_DEPTH) return;

  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch (error) {
    errors.push(scanReadError(rootState.canonicalPath, current, error));
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;

    const absolutePath = path.join(current, entry.name);
    const state = containedDirectoryState(absolutePath, rootState.canonicalPath);
    if (!state) continue;

    const relativePath = toPosix(path.relative(rootState.canonicalPath, state.canonicalPath));
    if (isCachePath(relativePath, entry.name)) {
      found.push(toPrivateCandidate({ absolutePath, relativePath, rootState, state }));
      continue;
    }

    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    if (entry.name === 'node_modules') {
      addNodeModulesCache(absolutePath, rootState, found);
      continue;
    }

    walk(rootState, state.canonicalPath, depth + 1, found, errors);
  }
}

function addNodeModulesCache(nodeModulesPath, rootState, found) {
  const absolutePath = path.join(nodeModulesPath, '.cache');
  if (!isPlainDirectory(absolutePath)) return;
  const state = containedDirectoryState(absolutePath, rootState.canonicalPath);
  if (!state) return;
  found.push(toPrivateCandidate({
    absolutePath,
    relativePath: toPosix(path.relative(rootState.canonicalPath, state.canonicalPath)),
    rootState,
    state,
  }));
}

function toPrivateCandidate({ absolutePath, relativePath, rootState, state }) {
  return {
    id: cacheId(relativePath, path.basename(relativePath)),
    absolutePath,
    relativePath,
    type: state.type,
    bytes: directorySize(absolutePath, rootState.canonicalPath),
    canonicalRoot: rootState.canonicalPath,
    canonicalPath: state.canonicalPath,
    rootIdentity: rootState.identity,
    identity: state.identity,
  };
}

function isCachePath(relativePath, name) {
  return EXACT_CACHE_PATHS.has(relativePath)
    || relativePath.endsWith('/.next/cache')
    || relativePath.endsWith('/node_modules/.cache')
    || CACHE_DIR_NAMES.has(name)
    || CACHE_DIR_NAMES_ANYWHERE.has(name);
}

function cacheId(relativePath, name) {
  if (relativePath === 'node_modules/.cache') return 'node_modules-cache';
  if (name === '__pycache__') return 'python-bytecode-cache';
  return relativePath.replace(/[/.]+/g, '-').replace(/^-|-$/g, '') || 'cache';
}

function attachScanState(candidates, errors, rootState) {
  Object.defineProperties(candidates, {
    errors: { value: errors, enumerable: false },
    safe: { value: errors.length === 0, enumerable: false },
    rootState: { value: rootState, enumerable: false },
  });
  return candidates;
}

function scanReadError(root, current, cause) {
  return {
    ...structuredError(
      'cache-scan-read-failed',
      'A workspace directory could not be read safely.',
      cause
    ),
    relativePath: toPosix(path.relative(root, current)) || '.',
  };
}

function isPlainDirectory(value) {
  try {
    const stat = fs.lstatSync(value);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

module.exports = { scanCacheTargets };

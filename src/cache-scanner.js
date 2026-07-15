'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  directorySize,
  inspectContainedDirectory,
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
    if (isSkippedDirectory(entry.name)) continue;

    const absolutePath = path.join(current, entry.name);
    const inspection = inspectContainedDirectory(absolutePath, rootState.canonicalPath);
    if (inspection.error) {
      errors.push(scanInspectionError(rootState.canonicalPath, absolutePath, inspection.error));
      continue;
    }
    const { state } = inspection;
    if (!state) continue;

    const relativePath = toPosix(path.relative(rootState.canonicalPath, state.canonicalPath));
    if (isCachePath(relativePath, entry.name)) {
      found.push(toPrivateCandidate({ absolutePath, relativePath, rootState, state, errors }));
      continue;
    }

    if (entry.name === 'node_modules') {
      addNodeModulesCache(absolutePath, rootState, found, errors);
      continue;
    }

    walk(rootState, state.canonicalPath, depth + 1, found, errors);
  }
}

function isSkippedDirectory(name) {
  return SKIP_DIR_NAMES.has(name)
    || name.startsWith('.zclean-quarantine-')
    || name.startsWith('.zclean-delete-');
}

function addNodeModulesCache(nodeModulesPath, rootState, found, errors) {
  const absolutePath = path.join(nodeModulesPath, '.cache');
  const inspection = inspectContainedDirectory(absolutePath, rootState.canonicalPath);
  if (inspection.error) {
    if (inspection.error.cause?.code !== 'ENOENT') {
      errors.push(scanInspectionError(rootState.canonicalPath, absolutePath, inspection.error));
    }
    return;
  }
  const { state } = inspection;
  if (!state) return;
  found.push(toPrivateCandidate({
    absolutePath,
    relativePath: toPosix(path.relative(rootState.canonicalPath, state.canonicalPath)),
    rootState,
    state,
    errors,
  }));
}

function toPrivateCandidate({ absolutePath, relativePath, rootState, state, errors }) {
  return {
    id: cacheId(relativePath, path.basename(relativePath)),
    absolutePath,
    relativePath,
    type: state.type,
    bytes: directorySize(absolutePath, rootState.canonicalPath, (failure) => {
      errors.push(scanInspectionError(rootState.canonicalPath, failure.path, failure));
    }),
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

function scanInspectionError(root, current, failure) {
  return {
    ...structuredError(
      'cache-scan-inspection-failed',
      `A workspace cache path could not be inspected safely (${failure.operation}).`,
      failure.cause
    ),
    relativePath: toPosix(path.relative(root, current)) || '.',
  };
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

module.exports = { scanCacheTargets };

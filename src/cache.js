'use strict';

const fs = require('fs');
const path = require('path');
const { appendLog } = require('./config');
const { c, bold, formatBytes } = require('./reporter');

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

function runCache(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const yes = Boolean(options.yes);
  const report = buildCacheReport({ root, yes });

  if (yes && report._privateCandidates.length > 0) {
    const result = cleanCacheTargets(report._privateCandidates);
    report.summary.deleted = result.deleted.length;
    report.summary.failed = result.failed.length;
    report.deleted = result.deleted.map(toPublicCandidate);
    report.failed = result.failed.map((item) => ({
      ...toPublicCandidate(item),
      error: item.error,
    }));
    appendLog({
      action: 'cache-cleanup-summary',
      deleted: report.summary.deleted,
      failed: report.summary.failed,
      totalBytes: report.summary.totalBytes,
    });
  } else if (!yes && report.candidates.length > 0) {
    appendLog({ action: 'cache-dry-run', found: report.candidates.length, totalBytes: report.summary.totalBytes });
  }

  if (options.json) {
    writeJson(report);
  } else {
    reportCacheText(report);
  }

  return report;
}

function buildCacheReport(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const candidates = scanCacheTargets(root);
  const totalBytes = candidates.reduce((sum, item) => sum + item.bytes, 0);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    kind: 'workspace-cache-hygiene',
    dryRun: !options.yes,
    workspace: path.basename(root) || '.',
    scope: 'safe workspace cache paths only; no app uninstall or whole-disk sweep',
    candidates: candidates.map(toPublicCandidate),
    summary: {
      count: candidates.length,
      totalBytes,
      deleted: 0,
      failed: 0,
    },
    _privateCandidates: candidates,
  };
}

function scanCacheTargets(root) {
  if (!isDirectory(root)) return [];
  const found = [];
  walk(root, root, 0, found);
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function walk(root, current, depth, found) {
  if (depth > MAX_SCAN_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;

    const absolutePath = path.join(current, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));
    const isNodeModules = entry.name === 'node_modules';

    if (isCachePath(relativePath, entry.name)) {
      found.push({
        id: cacheId(relativePath, entry.name),
        absolutePath,
        relativePath,
        type: 'directory',
        bytes: directorySize(absolutePath),
      });
      continue;
    }

    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    if (isNodeModules) {
      const nodeCache = path.join(absolutePath, '.cache');
      if (isDirectory(nodeCache)) {
        found.push({
          id: 'node_modules-cache',
          absolutePath: nodeCache,
          relativePath: toPosix(path.relative(root, nodeCache)),
          type: 'directory',
          bytes: directorySize(nodeCache),
        });
      }
      continue;
    }

    walk(root, absolutePath, depth + 1, found);
  }
}

function cleanCacheTargets(candidates) {
  const deleted = [];
  const failed = [];
  for (const candidate of [...candidates].sort((a, b) => b.relativePath.length - a.relativePath.length)) {
    try {
      fs.rmSync(candidate.absolutePath, { recursive: true, force: true });
      deleted.push(candidate);
    } catch (err) {
      failed.push({ ...candidate, error: err.message });
    }
  }
  return { deleted, failed };
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

function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) total += directorySize(file);
      else if (stat.isFile()) total += stat.size;
    } catch {}
  }
  return total;
}

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function toPublicCandidate(candidate) {
  return {
    id: candidate.id,
    relativePath: candidate.relativePath,
    type: candidate.type,
    bytes: candidate.bytes,
  };
}

function writeJson(report) {
  const publicReport = { ...report };
  delete publicReport._privateCandidates;
  console.log(JSON.stringify(publicReport, null, 2));
}

function reportCacheText(report) {
  console.log(bold('\n  zclean cache') + c('gray', ' - workspace cache hygiene\n'));
  console.log(`  Workspace:   ${report.workspace}`);
  console.log(`  Mode:        ${report.dryRun ? 'dry-run' : 'clean'}`);
  console.log(`  Candidates:  ${report.summary.count}`);
  console.log(`  Reclaimable: ${formatBytes(report.summary.totalBytes)}`);
  console.log();

  if (report.candidates.length === 0) {
    console.log(c('green', '  No supported workspace cache paths found.\n'));
    return;
  }

  for (const item of report.candidates.slice(0, 20)) {
    console.log(`  ${c('cyan', item.relativePath.padEnd(28))} ${formatBytes(item.bytes).padStart(10)}`);
  }
  if (report.candidates.length > 20) {
    console.log(c('gray', `  ... ${report.candidates.length - 20} more`));
  }
  console.log();

  if (report.dryRun) {
    console.log(c('gray', '  Run zclean cache --yes to remove these cache directories.\n'));
    return;
  }

  if (report.summary.failed > 0) {
    console.log(c('yellow', `  Removed ${report.summary.deleted}; failed ${report.summary.failed}.\n`));
  } else {
    console.log(c('green', `  Removed ${report.summary.deleted} cache director${report.summary.deleted === 1 ? 'y' : 'ies'}.\n`));
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

module.exports = {
  buildCacheReport,
  cleanCacheTargets,
  runCache,
  scanCacheTargets,
};

'use strict';

const path = require('node:path');
const { c, bold, formatBytes } = require('./reporter');
const { scanCacheTargets } = require('./cache-scanner');

function buildCacheReport(options = {}) {
  const root = options.root === undefined ? process.cwd() : options.root;
  const candidates = scanCacheTargets(root);
  const errors = Array.isArray(candidates.errors)
    ? candidates.errors.map((error) => ({ ...error }))
    : [];
  const safe = candidates.safe !== false;
  const totalBytes = candidates.reduce((sum, item) => sum + item.bytes, 0);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    kind: 'workspace-cache-hygiene',
    dryRun: !options.yes,
    workspace: safe && candidates.rootState
      ? path.basename(candidates.rootState.canonicalPath) || '.'
      : null,
    scope: 'safe workspace cache paths only; no app uninstall or whole-disk sweep',
    status: safe ? 'safe' : 'blocked',
    safe,
    ok: safe,
    exitCode: safe ? 0 : 1,
    errors,
    candidates: candidates.map(toPublicCandidate),
    deleted: [],
    failed: [],
    skipped: [],
    summary: {
      status: safe ? 'safe' : 'blocked',
      count: candidates.length,
      totalBytes,
      deleted: 0,
      failed: 0,
      skipped: 0,
      errorCount: errors.length,
    },
  };

  Object.defineProperty(report, '_privateCandidates', {
    value: candidates,
    enumerable: false,
  });
  return report;
}

function toPublicCandidate(candidate) {
  return {
    id: candidate.id,
    relativePath: candidate.relativePath,
    type: candidate.type,
    bytes: candidate.bytes,
  };
}

function writeCacheJson(report) {
  console.log(JSON.stringify(report, null, 2));
}

function reportCacheText(report) {
  console.log(bold('\n  zclean cache') + c('gray', ' - workspace cache hygiene\n'));
  console.log(`  Workspace:   ${report.workspace || '(rejected)'}`);
  console.log(`  Mode:        ${report.dryRun ? 'dry-run' : 'clean'}`);
  console.log(`  Status:      ${report.status}`);
  console.log(`  Candidates:  ${report.summary.count}`);
  console.log(`  Reclaimable: ${formatBytes(report.summary.totalBytes)}`);
  console.log();

  if (report.status === 'blocked') {
    console.log(c('red', '  Cache operation blocked by workspace safety checks.'));
    for (const error of report.errors) {
      console.log(`  ${c('red', error.code)}: ${error.message}`);
    }
    console.log();
    return;
  }

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

  if (report.summary.failed > 0 || report.summary.skipped > 0) {
    console.log(c('yellow', `  Removed ${report.summary.deleted}; skipped ${report.summary.skipped}; failed ${report.summary.failed}.\n`));
    for (const item of report.failed) {
      const cause = item.error.causeCode ? ` (${item.error.causeCode})` : '';
      console.log(`  ${c('red', 'FAIL')} ${item.relativePath}: ${item.error.message}${cause}`);
    }
    for (const item of report.skipped) {
      console.log(`  ${c('yellow', 'SKIP')} ${item.relativePath}: ${item.reason.code}`);
    }
    console.log();
    return;
  }

  console.log(c('green', `  Removed ${report.summary.deleted} cache director${report.summary.deleted === 1 ? 'y' : 'ies'}.\n`));
}

module.exports = {
  buildCacheReport,
  reportCacheText,
  toPublicCandidate,
  writeCacheJson,
};

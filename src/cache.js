'use strict';

const { appendLog } = require('./config');
const { cleanCacheTargets } = require('./cache-cleaner');
const {
  buildCacheReport,
  reportCacheText,
  toPublicCandidate,
  writeCacheJson,
} = require('./cache-report');
const { scanCacheTargets } = require('./cache-scanner');

function runCacheCommand(flags = {}) {
  return runCache({
    root: flags.path === undefined ? process.cwd() : flags.path,
    yes: Boolean(flags.yes || flags.y),
    json: Boolean(flags.json),
  });
}

function runCache(options = {}) {
  const yes = Boolean(options.yes);
  const log = typeof options.appendLog === 'function' ? options.appendLog : appendLog;
  const root = options.root === undefined ? process.cwd() : options.root;
  const report = buildCacheReport({ root, yes });

  if (yes && report.safe && report._privateCandidates.length > 0) {
    applyCleanupResult(report, cleanCacheTargets(report._privateCandidates, {
      unlinkSync: options.unlinkSync,
    }));
    log({
      action: 'cache-cleanup-summary',
      deleted: report.summary.deleted,
      failed: report.summary.failed,
      skipped: report.summary.skipped,
      totalBytes: report.summary.totalBytes,
    });
  } else if (!yes && report.safe && report.candidates.length > 0) {
    log({
      action: 'cache-dry-run',
      found: report.candidates.length,
      totalBytes: report.summary.totalBytes,
    });
  }

  if (options.json) writeCacheJson(report);
  else reportCacheText(report);
  return report;
}

function applyCleanupResult(report, result) {
  report.summary.deleted = result.deleted.length;
  report.summary.failed = result.failed.length;
  report.summary.skipped = result.skipped.length;
  report.deleted = result.deleted.map(toPublicCandidate);
  report.failed = result.failed.map((item) => ({
    ...toPublicCandidate(item),
    error: item.error,
  }));
  report.skipped = result.skipped.map((item) => ({
    ...toPublicCandidate(item),
    reason: item.reason,
  }));
  report.errors.push(...result.failed.map((item) => ({
    ...item.error,
    relativePath: item.relativePath,
  })));
  report.ok = result.ok;
  report.exitCode = result.exitCode;
  report.status = result.ok ? 'safe' : 'incomplete';
  report.safe = report.errors.length === 0;
  report.summary.status = report.status;
  report.summary.errorCount = report.errors.length;
}

module.exports = {
  buildCacheReport,
  cleanCacheTargets,
  runCache,
  runCacheCommand,
  scanCacheTargets,
};

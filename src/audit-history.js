'use strict';

const { sanitizeDiagnosticText } = require('./process-diagnostic');

function buildHistory(logs, stats) {
  const lastCleanup = logs.filter((entry) => entry.action === 'cleanup-summary').pop() || null;
  return {
    totalKilled: stats.totalKilled || 0,
    totalMemFreed: stats.totalMemFreed || 0,
    weekKilled: stats.weekKilled || 0,
    weekMemFreed: stats.weekMemFreed || 0,
    lastRun: stats.lastRun || (lastCleanup ? lastCleanup.timestamp : null),
    lastDryRun: findLastTimestamp(logs, 'dry-run'),
    recentFailures: findRecentFailures(logs),
    recent: summarizeLogs(logs),
  };
}

function findLastTimestamp(logs, action) {
  const entry = logs.filter((item) => item.action === action && item.timestamp).pop();
  return entry ? entry.timestamp : null;
}

function findRecentFailures(logs) {
  return logs
    .filter((entry) => entry.action === 'scan-failed' || entry.action === 'kill-failed' || (entry.action === 'cleanup-summary' && entry.failed > 0))
    .slice(-5)
    .map((entry) => ({
      timestamp: entry.timestamp || null,
      action: entry.action,
      pid: entry.pid || null,
      message: sanitizeHistoryMessage(entry.message || entry.error),
      failed: entry.failed || 0,
    }));
}

function sanitizeHistoryMessage(value) {
  return value ? sanitizeDiagnosticText(value) : null;
}

function summarizeLogs(logs) {
  const summary = {
    dryRuns: 0,
    scans: 0,
    scanFailures: 0,
    cleanupSummaries: 0,
    failedKills: 0,
  };

  for (const entry of logs) {
    switch (entry.action) {
      case 'dry-run':
        summary.dryRuns++;
        break;
      case 'scan':
        summary.scans++;
        break;
      case 'scan-failed':
        summary.scanFailures++;
        break;
      case 'cleanup-summary':
        summary.cleanupSummaries++;
        break;
      case 'kill-failed':
        summary.failedKills++;
        break;
    }
  }

  return summary;
}

module.exports = {
  buildHistory,
};

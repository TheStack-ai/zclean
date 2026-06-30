'use strict';

const { scan } = require('./scanner');
const { readLogs, getCumulativeStats } = require('./config');
const { buildAuditReport } = require('./audit-report');
const { reportAudit } = require('./audit-printer');

function runAudit(config, options = {}) {
  const scanOptions = options.sessionPid ? { sessionPid: options.sessionPid } : {};
  const zombies = options.scanResult || scan(config, scanOptions);
  const logs = options.logs || readLogs(100);
  const stats = options.stats || getCumulativeStats() || {};
  const report = buildAuditReport({
    config,
    zombies,
    logs,
    stats,
    now: options.now,
    commandName: options.commandName,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    reportAudit(report, { commandName: options.commandName });
  }

  return report;
}

module.exports = {
  runAudit,
  buildAuditReport,
  reportAudit,
};

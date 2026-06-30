'use strict';

const { c, bold } = require('../reporter');

function renderDoctorText(report, write) {
  write(bold('\n  zclean doctor\n\n'));
  for (const check of report.checks) {
    write(formatCheckLine(check));
  }
  write(c('cyan', '  Stats:') + `     ${report.stats.totalKilled} cleaned all time, ${report.stats.weekKilled} this week\n`);
  write('\n');
  if (report.overallStatus === 'ok') {
    write(c('green', '  All checks passed.\n\n'));
    return;
  }
  write(c('yellow', `  ${report.issueCount} issue${report.issueCount === 1 ? '' : 's'} found. Run \`zclean init\` to fix.\n\n`));
}

function formatCheckLine(check) {
  const labels = {
    config: 'Config',
    'process-scan': 'Process scan',
    hook: 'Hook',
    scheduler: 'Scheduler',
    'last-run': 'Last run',
  };
  const colors = {
    ok: 'green',
    warning: 'yellow',
    error: 'red',
  };
  const label = `${labels[check.id] || check.id}:`;
  const padding = ' '.repeat(Math.max(1, 14 - label.length));
  return c(colors[check.status] || 'gray', `  ${label}`) + `${padding}${check.message}\n`;
}

module.exports = { renderDoctorText };

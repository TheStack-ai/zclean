'use strict';

const { buildDoctorReport } = require('./doctor/checks');
const { renderDoctorText } = require('./doctor/render');

function runDoctor(config, options = {}) {
  const report = buildDoctorReport(config, options);
  const exitCode = report.overallStatus === 'ok' ? 0 : 1;
  const write = typeof options.write === 'function'
    ? options.write
    : (chunk) => process.stdout.write(chunk);

  if (options.json) {
    write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    renderDoctorText(report, write);
  }

  return { ...report, exitCode };
}

module.exports = { runDoctor };

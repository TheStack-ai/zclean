'use strict';

const { parseElapsed } = require('./process-elapsed');
const { providerDiagnostic } = require('./process-diagnostic');

function readPSProcesses(runtime) {
  let output;
  try {
    output = runtime.execSync('LC_ALL=C ps -eo pid=,ppid=,rss=,etime=,lstart=,command=', {
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    return {
      processes: [],
      errors: [providerDiagnostic('ps', 'process-enumeration-provider-failed', error)],
    };
  }

  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return {
      processes: [],
      errors: [providerDiagnostic(
        'ps',
        'process-enumeration-provider-empty',
        'ps returned no process rows.'
      )],
    };
  }

  const processes = [];
  let unparsedLineCount = 0;
  for (const line of lines) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/
    );
    if (!match) {
      unparsedLineCount += 1;
      continue;
    }

    const pid = parseInt(match[1], 10);
    if (pid === runtime.currentPid) continue;
    processes.push({
      pid,
      ppid: parseInt(match[2], 10),
      cmd: match[6],
      mem: parseInt(match[3], 10) * 1024,
      age: parseElapsed(match[4]),
      startTime: parseStartTime(match[5]),
    });
  }

  const errors = unparsedLineCount > 0
    ? [providerDiagnostic(
      'ps',
      'process-enumeration-provider-partial',
      `ps returned ${unparsedLineCount} unparsed process row${unparsedLineCount === 1 ? '' : 's'} out of ${lines.length}.`
    )]
    : [];
  return { processes, errors };
}

function parseStartTime(value) {
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

module.exports = { readPSProcesses };

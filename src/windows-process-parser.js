'use strict';

const { providerDiagnostic } = require('./process-diagnostic');

function normalizePid(pid) {
  const parsed = Number(pid);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseWMICOutput(output, runtime) {
  return parseWMICResult(output, runtime).processes;
}

function parseWMICResult(output, runtime) {
  const processes = [];
  let headers = null;
  let unparsedRowCount = 0;
  let totalRowCount = 0;

  for (const line of output.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = parseCsvLine(trimmed);
    if (!headers) {
      headers = parts.map((header) => header.trim().toLowerCase());
      continue;
    }

    totalRowCount += 1;
    if (parts.length < headers.length) {
      unparsedRowCount += 1;
      continue;
    }

    const indexOf = (name) => headers.indexOf(name);
    const column = (name) => (indexOf(name) >= 0 ? parts[indexOf(name)] : '');
    const pid = normalizePid(column('processid'));
    const ppid = Number(column('parentprocessid'));
    const cmd = String(column('commandline') || '').trim();
    if (!pid || !Number.isInteger(ppid) || ppid < 0) {
      unparsedRowCount += 1;
      continue;
    }
    if (pid === runtime.currentPid) continue;

    processes.push(processFromWindowsFields({
      pid,
      ppid,
      cmd,
      workingSet: Number(column('workingsetsize')),
      creationDate: column('creationdate'),
      runtime,
    }));
  }

  return { processes, totalRowCount, unparsedRowCount };
}

function parseCIMOutput(output, runtime) {
  return parseCIMResult(output, runtime).processes;
}

function parseCIMResult(output, runtime) {
  const parsedRows = parseJsonRowsResult(output);
  const processes = [];
  let unparsedRowCount = parsedRows.invalid ? 1 : 0;

  for (const row of parsedRows.rows) {
    const pid = normalizePid(readField(row, 'ProcessId'));
    const ppid = Number(readField(row, 'ParentProcessId'));
    const cmd = String(readField(row, 'CommandLine') || '').trim();
    if (!pid || !Number.isInteger(ppid) || ppid < 0) {
      unparsedRowCount += 1;
      continue;
    }
    if (pid === runtime.currentPid) continue;

    processes.push(processFromWindowsFields({
      pid,
      ppid,
      cmd,
      workingSet: Number(readField(row, 'WorkingSetSize')),
      creationDate: readField(row, 'CreationDate'),
      runtime,
    }));
  }

  return {
    processes,
    totalRowCount: parsedRows.rows.length,
    unparsedRowCount,
  };
}

function processFromWindowsFields(fields) {
  const startTime = parseWindowsDate(fields.creationDate);
  const startMs = startTime ? new Date(startTime).getTime() : 0;
  const now = typeof fields.runtime.now === 'function' ? fields.runtime.now() : fields.runtime.now;
  return {
    pid: fields.pid,
    ppid: fields.ppid,
    cmd: fields.cmd,
    mem: Number.isFinite(fields.workingSet) ? fields.workingSet : 0,
    age: startMs && Number.isFinite(now) ? now - startMs : 0,
    startTime,
  };
}

function parseJsonRows(output) {
  return parseJsonRowsResult(output).rows;
}

function parseJsonRowsResult(output) {
  const normalized = String(output || '').trim();
  if (!normalized) return { rows: [], invalid: false };
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) return { rows: parsed, invalid: false };
    if (parsed && typeof parsed === 'object') return { rows: [parsed], invalid: false };
  } catch {
    return { rows: [], invalid: true };
  }
  return { rows: [], invalid: true };
}

function parseWindowsDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{14}/.test(raw)) {
    const year = raw.substring(0, 4);
    const month = raw.substring(4, 6);
    const day = raw.substring(6, 8);
    const hours = raw.substring(8, 10);
    const minutes = raw.substring(10, 12);
    const seconds = raw.substring(12, 14);
    const date = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readField(row, name) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const lower = name.toLowerCase();
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === lower);
  return key ? row[key] : undefined;
}

function partialParseDiagnostics(provider, parsed) {
  if (!parsed.unparsedRowCount) return [];
  return [providerDiagnostic(
    provider,
    'process-enumeration-provider-partial',
    `${provider.toUpperCase()} returned ${parsed.unparsedRowCount} unparsed process row${parsed.unparsedRowCount === 1 ? '' : 's'} out of ${parsed.totalRowCount}.`
  )];
}

function parseCsvLine(line) {
  const parts = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

module.exports = {
  normalizePid,
  parseCIMOutput,
  parseCIMResult,
  parseJsonRows,
  parseJsonRowsResult,
  parseWindowsDate,
  parseWMICOutput,
  parseWMICResult,
  partialParseDiagnostics,
  readField,
};

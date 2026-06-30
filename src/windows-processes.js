'use strict';

function normalizePid(pid) {
  const parsed = Number(pid);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readWMICProcesses(runtime) {
  let output;
  try {
    output = runtime.execSync(
      'wmic process get ProcessId,ParentProcessId,CommandLine,WorkingSetSize,CreationDate /format:csv',
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (err) {
    return {
      processes: [],
      warnings: [providerDiagnostic('wmic', 'process-enumeration-provider-failed', err)],
    };
  }

  const processes = parseWMICOutput(String(output || ''), runtime);
  return {
    processes,
    warnings: processes.length > 0 ? [] : [providerDiagnostic(
      'wmic',
      'process-enumeration-provider-empty',
      'WMIC returned no process rows.'
    )],
  };
}

function readCIMProcesses(runtime) {
  let output;
  try {
    output = runtime.execSync(
      'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize,CreationDate | ConvertTo-Json -Compress"',
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (err) {
    return {
      processes: [],
      warnings: [providerDiagnostic('cim', 'process-enumeration-provider-failed', err)],
    };
  }

  const processes = parseCIMOutput(String(output || ''), runtime);
  return {
    processes,
    warnings: processes.length > 0 ? [] : [providerDiagnostic(
      'cim',
      'process-enumeration-provider-empty',
      'CIM returned no process rows.'
    )],
  };
}

function readWindowsProcess(pid, runtime) {
  const safePid = normalizePid(pid);
  if (!safePid) return null;

  let output;
  try {
    output = runtime.execSync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${safePid}' | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress"`,
      { encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 1024 }
    );
  } catch {
    return null;
  }

  const rows = parseJsonRows(String(output || ''));
  const row = rows.find((item) => Number(readField(item, 'ProcessId')) === safePid);
  if (!row) return null;

  return {
    pid: safePid,
    cmd: String(readField(row, 'CommandLine') || ''),
    startTime: parseWindowsDate(readField(row, 'CreationDate')),
  };
}

function windowsProcessExists(pid, runtime) {
  const safePid = normalizePid(pid);
  if (!safePid) return false;

  try {
    const output = runtime.execSync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${safePid}' | Select-Object ProcessId | ConvertTo-Json -Compress"`,
      { encoding: 'utf-8', timeout: 3000, maxBuffer: 1024 * 1024 }
    );
    return parseJsonRows(String(output || '')).some((row) => Number(readField(row, 'ProcessId')) === safePid);
  } catch {
    return null;
  }
}

function parseWMICOutput(output, runtime) {
  const processes = [];
  let headers = null;

  for (const line of output.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = parseCsvLine(trimmed);
    if (!headers) {
      headers = parts.map((h) => h.trim().toLowerCase());
      continue;
    }

    if (parts.length < headers.length) continue;

    const idx = (name) => headers.indexOf(name);
    const col = (name) => (idx(name) >= 0 ? parts[idx(name)] : '');
    const pid = Number(col('processid'));
    const cmd = String(col('commandline') || '').trim();
    if (!Number.isFinite(pid) || pid === runtime.currentPid || !cmd) continue;

    processes.push(processFromWindowsFields({
      pid,
      ppid: Number(col('parentprocessid')),
      cmd,
      workingSet: Number(col('workingsetsize')),
      creationDate: col('creationdate'),
      runtime,
    }));
  }

  return processes;
}

function parseCIMOutput(output, runtime) {
  const rows = parseJsonRows(output);
  const processes = [];

  for (const row of rows) {
    const pid = Number(readField(row, 'ProcessId'));
    const cmd = String(readField(row, 'CommandLine') || '').trim();
    if (!Number.isFinite(pid) || pid === runtime.currentPid || !cmd) continue;

    processes.push(processFromWindowsFields({
      pid,
      ppid: Number(readField(row, 'ParentProcessId')),
      cmd,
      workingSet: Number(readField(row, 'WorkingSetSize')),
      creationDate: readField(row, 'CreationDate'),
      runtime,
    }));
  }

  return processes;
}

function processFromWindowsFields(fields) {
  const startTime = parseWindowsDate(fields.creationDate);
  const startMs = startTime ? new Date(startTime).getTime() : 0;
  const now = typeof fields.runtime.now === 'function' ? fields.runtime.now() : fields.runtime.now;

  return {
    pid: fields.pid,
    ppid: Number.isFinite(fields.ppid) ? fields.ppid : 0,
    cmd: fields.cmd,
    mem: Number.isFinite(fields.workingSet) ? fields.workingSet : 0,
    age: startMs && Number.isFinite(now) ? now - startMs : 0,
    startTime,
  };
}

function parseJsonRows(output) {
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {
    return [];
  }
  return [];
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

function parseCsvLine(line) {
  const parts = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

function providerDiagnostic(provider, code, err) {
  return {
    code,
    provider,
    message: err instanceof Error ? err.message : String(err || ''),
  };
}

module.exports = {
  normalizePid,
  readCIMProcesses,
  readWMICProcesses,
  readWindowsProcess,
  windowsProcessExists,
  parseCIMOutput,
  parseWindowsDate,
};

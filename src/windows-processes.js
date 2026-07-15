'use strict';

const { providerDiagnostic } = require('./process-diagnostic');
const {
  normalizePid,
  parseCIMOutput,
  parseCIMResult,
  parseJsonRowsResult,
  parseWindowsDate,
  parseWMICResult,
  partialParseDiagnostics,
  readField,
} = require('./windows-process-parser');

function readWMICProcesses(runtime) {
  try {
    runtime.execSync('where wmic', {
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return { processes: [], warnings: [], errors: [] };
  }

  let output;
  try {
    output = runtime.execSync(
      'wmic process get ProcessId,ParentProcessId,CommandLine,WorkingSetSize,CreationDate /format:csv',
      {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (err) {
    return {
      processes: [],
      warnings: [providerDiagnostic('wmic', 'process-enumeration-provider-failed', err)],
      errors: [],
    };
  }

  const parsed = parseWMICResult(String(output || ''), runtime);
  return {
    processes: parsed.processes,
    warnings: parsed.processes.length > 0 ? [] : [providerDiagnostic(
      'wmic',
      'process-enumeration-provider-empty',
      'WMIC returned no process rows.'
    )],
    errors: partialParseDiagnostics('wmic', parsed),
  };
}

function readCIMProcesses(runtime) {
  let output;
  try {
    output = runtime.execSync(
      'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,WorkingSetSize,CreationDate | ConvertTo-Json -Compress"',
      {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (err) {
    return {
      processes: [],
      warnings: [providerDiagnostic('cim', 'process-enumeration-provider-failed', err)],
      errors: [],
    };
  }

  const parsed = parseCIMResult(String(output || ''), runtime);
  return {
    processes: parsed.processes,
    warnings: parsed.processes.length > 0 ? [] : [providerDiagnostic(
      'cim',
      'process-enumeration-provider-empty',
      'CIM returned no process rows.'
    )],
    errors: partialParseDiagnostics('cim', parsed),
  };
}

function readWindowsProcess(pid, runtime) {
  const safePid = normalizePid(pid);
  if (!safePid) return null;

  const output = runtime.execSync(
    `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${safePid}' | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress"`,
    {
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const parsed = parseJsonRowsResult(String(output || ''));
  if (parsed.invalid) {
    throw new Error('CIM returned invalid process identity data.');
  }
  if (parsed.rows.length === 0) return null;
  if (parsed.rows.length !== 1) {
    throw new Error('CIM returned incomplete process identity data.');
  }
  const row = parsed.rows[0];
  if (Number(readField(row, 'ProcessId')) !== safePid) {
    throw new Error('CIM returned incomplete process identity data.');
  }

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
      {
        encoding: 'utf-8',
        timeout: 3000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const parsed = parseJsonRowsResult(String(output || ''));
    if (parsed.invalid) return null;
    if (parsed.rows.length === 0) return false;
    if (parsed.rows.length !== 1) return null;
    return Number(readField(parsed.rows[0], 'ProcessId')) === safePid ? true : null;
  } catch {
    return null;
  }
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

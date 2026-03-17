'use strict';

const { execSync } = require('child_process');
const os = require('os');
const { matchPattern } = require('./detector/patterns');
const { checkOrphan, isInTerminalMultiplexer } = require('./detector/orphan');
const { isWhitelisted } = require('./detector/whitelist');
const { parseDuration, parseMemory } = require('./config');

const platform = os.platform();

/**
 * Scan for zombie/orphan processes left by AI coding tools.
 *
 * Returns an array of process objects:
 *   { pid, name, cmd, ppid, mem, age, startTime, reason, pattern }
 *
 * @param {object} config — loaded zclean config
 * @param {object} opts — { sessionPid?: number } for session-aware filtering
 */
function scan(config, opts = {}) {
  const processes = listProcesses();
  const zombies = [];

  for (const proc of processes) {
    // Match against known AI tool patterns
    const pattern = matchPattern(proc.cmd);
    if (!pattern) continue;

    // Check orphan status
    const orphanResult = checkOrphan(proc.pid);
    proc.ppid = orphanResult.ppid;

    // If pattern requires orphan status and process isn't orphaned, skip
    if (pattern.orphanOnly && !orphanResult.isOrphan) continue;

    // Skip processes in tmux/screen sessions (they're likely intentional)
    if (isInTerminalMultiplexer(proc.pid)) continue;

    // Check whitelist
    const whitelistResult = isWhitelisted(proc, config);
    if (whitelistResult.protected) continue;

    // Check maxOrphanAge if defined on the pattern
    if (pattern.maxOrphanAge) {
      const maxAge = parseDuration(pattern.maxOrphanAge);
      if (maxAge && proc.age < maxAge) continue;
    }

    // Check memory threshold for node-ai-path pattern
    if (pattern.memThreshold) {
      const threshold = parseMemory(pattern.memThreshold);
      const configThreshold = parseMemory(config.memoryThreshold);
      // Use whichever is set — pattern threshold is the gate, but either can trigger
      if (threshold && proc.mem < threshold) {
        // Also check if age exceeds maxOrphanAge
        if (pattern.maxOrphanAge) {
          const maxAge = parseDuration(pattern.maxOrphanAge);
          if (maxAge && proc.age < maxAge) continue;
        } else {
          continue;
        }
      }
    }

    // Session affinity: if --session-pid was provided, prefer processes
    // that were children of that session
    if (opts.sessionPid) {
      // Still include non-session orphans, but note affinity
      proc.sessionRelated = isSessionRelated(proc.pid, opts.sessionPid);
    }

    // Build reason string
    const reasons = [];
    reasons.push(`pattern:${pattern.name}`);
    if (orphanResult.isOrphan) reasons.push(`orphan:${orphanResult.reason}`);
    if (proc.age > parseDuration(config.maxAge || '24h')) reasons.push('age-exceeded');
    if (parseMemory(config.memoryThreshold) && proc.mem > parseMemory(config.memoryThreshold)) {
      reasons.push('memory-exceeded');
    }

    zombies.push({
      pid: proc.pid,
      name: pattern.name,
      cmd: proc.cmd,
      ppid: proc.ppid,
      mem: proc.mem,
      age: proc.age,
      startTime: proc.startTime,
      reason: reasons.join(', '),
      pattern: pattern.name,
    });
  }

  return zombies;
}

/**
 * List all processes with their details.
 * Cross-platform: macOS/Linux use `ps`, Windows uses `wmic`.
 *
 * Returns array of { pid, cmd, mem, age, startTime }
 */
function listProcesses() {
  if (platform === 'win32') {
    return listProcessesWindows();
  }
  return listProcessesUnix();
}

/**
 * Unix process listing via `ps aux`.
 */
function listProcessesUnix() {
  let output;
  try {
    // ps aux with etime for age calculation
    // Columns: PID, RSS (KB), ELAPSED, STARTED, COMMAND
    output = execSync('ps -eo pid=,rss=,etime=,lstart=,command=', {
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return [];
  }

  const processes = [];
  const lines = output.trim().split('\n');
  const myPid = process.pid;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse the fixed-width fields
    // Format: "  PID   RSS     ELAPSED             LSTART                    COMMAND"
    const match = trimmed.match(
      /^\s*(\d+)\s+(\d+)\s+([\d:.-]+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/
    );
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const rssKB = parseInt(match[2], 10);
    const elapsed = match[3];
    const lstart = match[4];
    const cmd = match[5];

    // Skip our own process
    if (pid === myPid) continue;

    // Parse elapsed time (format: [[DD-]HH:]MM:SS)
    const ageMs = parseElapsed(elapsed);

    // Parse start time
    let startTime = null;
    try {
      startTime = new Date(lstart).toISOString();
    } catch {
      // Ignore parse errors
    }

    processes.push({
      pid,
      cmd,
      mem: rssKB * 1024, // Convert KB to bytes
      age: ageMs,
      startTime,
    });
  }

  return processes;
}

/**
 * Windows process listing via wmic.
 */
function listProcessesWindows() {
  let output;
  try {
    output = execSync(
      'wmic process get ProcessId,CommandLine,WorkingSetSize,CreationDate /format:csv',
      { encoding: 'utf-8', timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch {
    return [];
  }

  const processes = [];
  const lines = output.trim().split('\n');
  const myPid = process.pid;

  for (const line of lines) {
    const parts = line.trim().split(',');
    if (parts.length < 5) continue;

    // CSV format: Node, CommandLine, CreationDate, ProcessId, WorkingSetSize
    const cmd = parts[1];
    const creationDate = parts[2];
    const pid = parseInt(parts[3], 10);
    const workingSet = parseInt(parts[4], 10);

    if (isNaN(pid) || pid === myPid || !cmd) continue;

    // Parse WMI datetime: YYYYMMDDHHMMSS.MMMMMM+UUU
    let ageMs = 0;
    let startTime = null;
    if (creationDate) {
      try {
        const year = creationDate.substring(0, 4);
        const month = creationDate.substring(4, 6);
        const day = creationDate.substring(6, 8);
        const hours = creationDate.substring(8, 10);
        const minutes = creationDate.substring(10, 12);
        const seconds = creationDate.substring(12, 14);
        const dt = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}`);
        startTime = dt.toISOString();
        ageMs = Date.now() - dt.getTime();
      } catch {
        // Ignore
      }
    }

    processes.push({
      pid,
      cmd,
      mem: workingSet || 0,
      age: ageMs,
      startTime,
    });
  }

  return processes;
}

/**
 * Parse ps elapsed time format: [[DD-]HH:]MM:SS or DD-HH:MM:SS
 * Returns milliseconds.
 */
function parseElapsed(elapsed) {
  if (!elapsed) return 0;

  let days = 0;
  let rest = elapsed.trim();

  // Check for "DD-" prefix
  const dayMatch = rest.match(/^(\d+)-(.+)$/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
    rest = dayMatch[2];
  }

  const parts = rest.split(':').map((p) => parseInt(p, 10));

  let hours = 0, minutes = 0, seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else if (parts.length === 1) {
    [seconds] = parts;
  }

  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Check if a process was a descendant of a given session PID.
 * Used for session-affinity cleanup.
 */
function isSessionRelated(pid, sessionPid) {
  if (platform === 'win32') return false;

  const visited = new Set();
  let currentPid = pid;

  while (currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid);
    if (currentPid === sessionPid) return true;

    try {
      const ppidStr = execSync(`ps -o ppid= -p ${currentPid}`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      currentPid = parseInt(ppidStr, 10);
      if (isNaN(currentPid)) break;
    } catch {
      break;
    }
  }

  return false;
}

module.exports = { scan, listProcesses, parseElapsed };

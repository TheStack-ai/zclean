'use strict';

const { execSync } = require('child_process');
const os = require('os');
const { readCIMProcesses, readWMICProcesses } = require('./windows-processes');

const platform = os.platform();

/**
 * In-memory process tree for O(1) PID lookup and O(depth) ancestor traversal.
 * Built from one platform enumeration call sequence — zero execSync during queries.
 *
 * Usage:
 *   const tree = ProcessTree.build();      // platform auto-detect
 *   tree.isOrphan(pid)                     // no execSync
 *   tree.hasAncestorMatching(pid, testFn)  // no execSync
 */
class ProcessTree {
  /**
   * @param {Array<{pid: number, ppid: number, cmd: string, mem: number, age: number, startTime: string|null}>} processes
   */
  constructor(processes, diagnostics = {}) {
    this.warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
    this.errors = Array.isArray(diagnostics.errors) ? diagnostics.errors : [];
    this.platform = diagnostics.platform || platform;

    /** @type {Map<number, object>} */
    this.byPid = new Map();
    /** @type {Map<number, number[]>} pid → [childPids] */
    this.childrenMap = new Map();

    for (const proc of processes) {
      this.byPid.set(proc.pid, proc);
      if (!this.childrenMap.has(proc.ppid)) {
        this.childrenMap.set(proc.ppid, []);
      }
      this.childrenMap.get(proc.ppid).push(proc.pid);
    }
  }

  /**
   * O(1) lookup by PID.
   * @returns {object|null}
   */
  get(pid) {
    return this.byPid.get(pid) || null;
  }

  /**
   * Parent process info, or null if PID not in tree or parent unknown.
   * @returns {object|null}
   */
  parent(pid) {
    const proc = this.byPid.get(pid);
    if (!proc) return null;
    return this.byPid.get(proc.ppid) || null;
  }

  /**
   * Array of direct child process infos.
   * @returns {object[]}
   */
  children(pid) {
    const childPids = this.childrenMap.get(pid) || [];
    return childPids.map((cpid) => this.byPid.get(cpid)).filter(Boolean);
  }

  /**
   * Ancestor chain starting from the direct parent, root last.
   * Stops at PID 1 or when the parent is not in the tree.
   * @returns {object[]}
   */
  ancestors(pid) {
    const result = [];
    const visited = new Set();
    let current = this.byPid.get(pid);

    while (current) {
      if (visited.has(current.pid)) break;
      visited.add(current.pid);
      const par = this.byPid.get(current.ppid);
      if (!par) break;
      result.push(par);
      current = par;
    }

    return result;
  }

  /**
   * Determine orphan status from in-memory tree — no execSync.
   *
   * @returns {{ isOrphan: boolean, ppid: number|null, reason: string }}
   */
  isOrphan(pid) {
    const proc = this.byPid.get(pid);
    if (!proc) return { isOrphan: false, ppid: null, reason: 'not-in-tree' };

    const { ppid } = proc;

    if (this.platform === 'win32') {
      if (!this.byPid.has(ppid)) {
        return { isOrphan: true, ppid, reason: 'parent-gone' };
      }
      return { isOrphan: false, ppid, reason: 'has-parent' };
    }

    // macOS: PPID 1 = reparented to launchd
    if (this.platform === 'darwin' && ppid === 1) {
      return { isOrphan: true, ppid: 1, reason: 'reparented-to-launchd' };
    }

    // Linux: PPID 1 = reparented to init
    if (this.platform === 'linux' && ppid === 1) {
      return { isOrphan: true, ppid: 1, reason: 'reparented-to-init' };
    }

    // Linux: parent is systemd --user (user session slice)
    if (this.platform === 'linux' && ppid > 1) {
      const parentProc = this.byPid.get(ppid);
      if (parentProc) {
        // Extract process name (basename of first token)
        const comm = parentProc.cmd.split(/\s+/)[0].split('/').pop();
        if (comm === 'systemd') {
          return { isOrphan: true, ppid, reason: 'reparented-to-systemd-user' };
        }
      }
    }

    // Has living parent in the tree
    if (this.byPid.has(ppid)) {
      return { isOrphan: false, ppid, reason: 'has-parent' };
    }

    // Parent not in tree and not PID 1 — likely died
    return { isOrphan: true, ppid, reason: 'parent-gone' };
  }

  /**
   * Walk ancestor chain, return true if any ancestor passes testFn.
   * Cycle-safe via visited Set. Stops at PID 1 or when parent not in tree.
   *
   * @param {number} pid
   * @param {(proc: object) => boolean} testFn
   * @returns {boolean}
   */
  hasAncestorMatching(pid, testFn) {
    const visited = new Set();
    let current = this.byPid.get(pid);

    while (current) {
      if (visited.has(current.pid)) break; // cycle protection
      visited.add(current.pid);

      const parent = this.byPid.get(current.ppid);
      if (!parent || parent.pid === 1) break;

      if (testFn(parent)) return true;
      current = parent;
    }

    return false;
  }

  /**
   * Unix: build ProcessTree from a single `ps` call.
   * Format: pid= ppid= rss= etime= lstart= command=
   *
   * @returns {ProcessTree}
   */
  static fromPS(options = {}) {
    const runtime = runtimeOptions(options);
    let output;
    try {
      // LC_ALL=C forces English date output in lstart= regardless of system locale
      output = runtime.execSync('LC_ALL=C ps -eo pid=,ppid=,rss=,etime=,lstart=,command=', {
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      return new ProcessTree([], {
        platform: runtime.platform,
        errors: [providerDiagnostic('ps', 'process-enumeration-provider-failed', err)],
      });
    }

    const lines = String(output || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return new ProcessTree([], {
        platform: runtime.platform,
        errors: [providerDiagnostic(
          'ps',
          'process-enumeration-provider-empty',
          'ps returned no process rows.'
        )],
      });
    }

    const processes = [];
    const myPid = runtime.currentPid;
    let unparsedLineCount = 0;

    for (const trimmed of lines) {

      // Format: PID PPID RSS ELAPSED [DAY ]MON DD HH:MM:SS YEAR COMMAND
      // Example: "  123  456  2048  01:23:45  Mon Jan  1 12:00:00 2024  node server.js"
      const match = trimmed.match(
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/
      );
      if (!match) {
        unparsedLineCount += 1;
        continue;
      }

      const pid = parseInt(match[1], 10);
      if (pid === myPid) continue;

      const ppid = parseInt(match[2], 10);
      const rssKB = parseInt(match[3], 10);
      const elapsed = match[4];
      const lstart = match[5];
      const cmd = match[6];

      let startTime = null;
      try { startTime = new Date(lstart).toISOString(); } catch { /* ignore */ }

      processes.push({
        pid,
        ppid,
        cmd,
        mem: rssKB * 1024, // KB → bytes
        age: parseElapsed(elapsed),
        startTime,
      });
    }

    const errors = unparsedLineCount > 0
      ? [providerDiagnostic(
        'ps',
        'process-enumeration-provider-partial',
        `ps returned ${unparsedLineCount} unparsed process row${unparsedLineCount === 1 ? '' : 's'} out of ${lines.length}.`
      )]
      : [];

    return new ProcessTree(processes, { platform: runtime.platform, errors });
  }

  static fromWMIC(options = {}) {
    const runtime = runtimeOptions({ ...options, platform: 'win32' });
    const result = readWMICProcesses(runtime);
    return new ProcessTree(result.processes, {
      platform: runtime.platform,
      warnings: result.warnings,
    });
  }

  static fromCIM(options = {}) {
    const runtime = runtimeOptions({ ...options, platform: 'win32' });
    const result = readCIMProcesses(runtime);
    return new ProcessTree(result.processes, {
      platform: runtime.platform,
      warnings: result.warnings,
    });
  }

  static fromWindows(options = {}) {
    const runtime = runtimeOptions({ ...options, platform: 'win32' });
    const wmic = readWMICProcesses(runtime);
    if (wmic.processes.length > 0) {
      return new ProcessTree(wmic.processes, { platform: runtime.platform });
    }

    const warnings = [...wmic.warnings];
    const cim = readCIMProcesses(runtime);
    if (cim.processes.length > 0) {
      return new ProcessTree(cim.processes, {
        platform: runtime.platform,
        warnings: warnings.concat(cim.warnings),
      });
    }

    warnings.push(...cim.warnings);
    return new ProcessTree([], {
      platform: runtime.platform,
      warnings,
      errors: [{
        code: 'process-enumeration-failed',
        platform: 'win32',
        providers: ['cim', 'wmic'],
        message: 'Windows process enumeration failed for all providers.',
      }],
    });
  }

  /**
   * Platform-aware factory. Use this from scanner/orphan/whitelist.
   * Calls fromWindows() on Windows, fromPS() everywhere else.
   *
   * @returns {ProcessTree}
   */
  static build(options = {}) {
    const runtime = runtimeOptions(options);
    return runtime.platform === 'win32'
      ? ProcessTree.fromWindows(runtime)
      : ProcessTree.fromPS(runtime);
  }
}

function runtimeOptions(options = {}) {
  return {
    execSync: options.execSync || execSync,
    platform: options.platform || platform,
    currentPid: options.currentPid || process.pid,
    now: options.now || Date.now(),
  };
}

function providerDiagnostic(provider, code, err) {
  return {
    code,
    provider,
    message: err instanceof Error ? err.message : String(err || ''),
  };
}

/**
 * Parse ps elapsed time format: [[DD-]HH:]MM:SS
 * Moved here from scanner.js to co-locate with ProcessTree.
 *
 * @param {string} elapsed
 * @returns {number} milliseconds
 */
function parseElapsed(elapsed) {
  if (!elapsed) return 0;

  let days = 0;
  let rest = elapsed.trim();

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

module.exports = { ProcessTree, parseElapsed };

'use strict';

const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();

/**
 * In-memory process tree for O(1) PID lookup and O(depth) ancestor traversal.
 * Built from a single ps/wmic call — zero execSync during queries.
 *
 * Usage:
 *   const tree = ProcessTree.build();      // platform auto-detect
 *   tree.isOrphan(pid)                     // no execSync
 *   tree.hasAncestorMatching(pid, testFn)  // no execSync
 */
class ProcessTree {
  /**
   * @param {Array<{pid: number, ppid: number, cmd: string, rss: number, age: number, startTime: string|null}>} processes
   */
  constructor(processes) {
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

    if (platform === 'win32') {
      if (!this.byPid.has(ppid)) {
        return { isOrphan: true, ppid, reason: 'parent-gone' };
      }
      return { isOrphan: false, ppid, reason: 'has-parent' };
    }

    // macOS: PPID 1 = reparented to launchd
    if (platform === 'darwin' && ppid === 1) {
      return { isOrphan: true, ppid: 1, reason: 'reparented-to-launchd' };
    }

    // Linux: PPID 1 = reparented to init
    if (platform === 'linux' && ppid === 1) {
      return { isOrphan: true, ppid: 1, reason: 'reparented-to-init' };
    }

    // Linux: parent is systemd --user (user session slice)
    if (platform === 'linux' && ppid > 1) {
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
  static fromPS() {
    let output;
    try {
      // LC_ALL=C forces English date output in lstart= regardless of system locale
      output = execSync('LC_ALL=C ps -eo pid=,ppid=,rss=,etime=,lstart=,command=', {
        encoding: 'utf-8',
        timeout: 10000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      return new ProcessTree([]);
    }

    const processes = [];
    const myPid = process.pid;

    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format: PID PPID RSS ELAPSED [DAY ]MON DD HH:MM:SS YEAR COMMAND
      // Example: "  123  456  2048  01:23:45  Mon Jan  1 12:00:00 2024  node server.js"
      const match = trimmed.match(
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/
      );
      if (!match) continue;

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
        rss: rssKB * 1024, // KB → bytes
        age: parseElapsed(elapsed),
        startTime,
      });
    }

    return new ProcessTree(processes);
  }

  /**
   * Windows: build ProcessTree from a single `wmic` call.
   * Uses header-driven CSV parsing for column-order independence.
   *
   * @returns {ProcessTree}
   */
  static fromWMIC() {
    let output;
    try {
      output = execSync(
        'wmic process get ProcessId,ParentProcessId,CommandLine,WorkingSetSize,CreationDate /format:csv',
        { encoding: 'utf-8', timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch {
      return new ProcessTree([]);
    }

    const processes = [];
    const myPid = process.pid;
    let headers = null;

    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(',');

      // First non-empty line is the CSV header
      if (!headers) {
        headers = parts.map((h) => h.trim().toLowerCase());
        continue;
      }

      if (parts.length < headers.length) continue;

      const idx = (name) => headers.indexOf(name);
      const col = (name) => (idx(name) >= 0 ? parts[idx(name)] : '');

      const cmd = col('commandline');
      const creationDate = col('creationdate');
      const ppid = parseInt(col('parentprocessid'), 10);
      const pid = parseInt(col('processid'), 10);
      const workingSet = parseInt(col('workingsetsize'), 10);

      if (isNaN(pid) || pid === myPid || !cmd) continue;

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
        } catch { /* ignore */ }
      }

      processes.push({
        pid,
        ppid: isNaN(ppid) ? 0 : ppid,
        cmd,
        rss: workingSet || 0,
        age: ageMs,
        startTime,
      });
    }

    return new ProcessTree(processes);
  }

  /**
   * Platform-aware factory. Use this from scanner/orphan/whitelist.
   * Calls fromWMIC() on Windows, fromPS() everywhere else.
   *
   * @returns {ProcessTree}
   */
  static build() {
    return platform === 'win32' ? ProcessTree.fromWMIC() : ProcessTree.fromPS();
  }
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

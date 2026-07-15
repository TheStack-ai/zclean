'use strict';

const { execSync } = require('child_process');
const os = require('os');
const { parseElapsed } = require('./process-elapsed');
const { readPSProcesses } = require('./process-ps');
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
    const result = readPSProcesses(runtime);
    return new ProcessTree(result.processes, {
      platform: runtime.platform,
      errors: result.errors,
    });
  }

  static fromWMIC(options = {}) {
    const runtime = runtimeOptions({ ...options, platform: 'win32' });
    const result = readWMICProcesses(runtime);
    return new ProcessTree(result.processes, {
      platform: runtime.platform,
      warnings: result.warnings,
      errors: result.errors,
    });
  }

  static fromCIM(options = {}) {
    const runtime = runtimeOptions({ ...options, platform: 'win32' });
    const result = readCIMProcesses(runtime);
    return new ProcessTree(result.processes, {
      platform: runtime.platform,
      warnings: result.warnings,
      errors: result.errors,
    });
  }

  static fromWindows(options = {}) {
    const runtime = runtimeOptions({ ...options, platform: 'win32' });
    const wmic = readWMICProcesses(runtime);
    if (wmic.processes.length > 0 && wmic.errors.length === 0) {
      return new ProcessTree(wmic.processes, { platform: runtime.platform });
    }

    const warnings = [...wmic.warnings, ...wmic.errors];
    const cim = readCIMProcesses(runtime);
    if (cim.processes.length > 0 && cim.errors.length === 0) {
      return new ProcessTree(cim.processes, {
        platform: runtime.platform,
        warnings: warnings.concat(cim.warnings),
      });
    }

    if (cim.processes.length > 0) {
      return new ProcessTree(cim.processes, {
        platform: runtime.platform,
        warnings: warnings.concat(cim.warnings),
        errors: cim.errors,
      });
    }

    if (wmic.processes.length > 0) {
      return new ProcessTree(wmic.processes, {
        platform: runtime.platform,
        warnings: wmic.warnings.concat(cim.warnings, cim.errors),
        errors: wmic.errors,
      });
    }

    warnings.push(...cim.warnings, ...cim.errors);
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

module.exports = { ProcessTree, parseElapsed };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { preDeleteSkipReason, quarantinedSkipReason } = require('./cache-containment');
const { structuredError } = require('./cache-root');

function cleanCacheTargets(candidates, options = {}) {
  const deleted = [];
  const failed = [];
  const skipped = [];
  const runtime = {
    existsSync: options.existsSync || fs.existsSync,
    mkdirTemp: options.mkdtempSync || fs.mkdtempSync,
    rename: options.renameSync || fs.renameSync,
    remove: options.rmSync || fs.rmSync,
    removeDirectory: options.rmdirSync || fs.rmdirSync,
  };
  const ordered = [...candidates]
    .sort((left, right) => String(right.relativePath || '').length - String(left.relativePath || '').length);

  for (const candidate of ordered) {
    const reason = preDeleteSkipReason(candidate);
    if (reason) {
      skipped.push({ ...candidate, reason });
      continue;
    }

    let quarantineDirectory = null;
    let quarantinedPath = null;
    try {
      quarantineDirectory = runtime.mkdirTemp(
        path.join(path.dirname(candidate.absolutePath), '.zclean-quarantine-')
      );
      quarantinedPath = path.join(quarantineDirectory, 'target');
      runtime.rename(candidate.absolutePath, quarantinedPath);
      const quarantinedReason = quarantinedSkipReason(candidate, quarantinedPath);
      if (quarantinedReason) {
        restoreQuarantined(runtime, candidate.absolutePath, quarantinedPath, quarantineDirectory);
        skipped.push({ ...candidate, reason: quarantinedReason });
        continue;
      }
      runtime.remove(quarantinedPath, { recursive: true, force: true });
      removeEmptyDirectory(runtime, quarantineDirectory);
      deleted.push(candidate);
    } catch (error) {
      restoreQuarantined(runtime, candidate.absolutePath, quarantinedPath, quarantineDirectory);
      failed.push({
        ...candidate,
        error: structuredError(
          'cache-delete-failed',
          'A cache directory could not be removed.',
          error
        ),
      });
    }
  }

  const ok = failed.length === 0 && skipped.length === 0;
  return {
    deleted,
    failed,
    skipped,
    ok,
    status: ok ? 'success' : 'incomplete',
    exitCode: ok ? 0 : 1,
  };
}

function restoreQuarantined(runtime, originalPath, quarantinedPath, quarantineDirectory) {
  try {
    if (quarantinedPath && runtime.existsSync(quarantinedPath) && !runtime.existsSync(originalPath)) {
      runtime.rename(quarantinedPath, originalPath);
    }
  } catch {}
  removeEmptyDirectory(runtime, quarantineDirectory);
}

function removeEmptyDirectory(runtime, directory) {
  if (!directory) return;
  try { runtime.removeDirectory(directory); } catch {}
}

module.exports = { cleanCacheTargets };

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
    inspect: options.lstatSync || fs.lstatSync,
    mkdirTemp: options.mkdtempSync || fs.mkdtempSync,
    readDirectory: options.readdirSync || fs.readdirSync,
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
      removeQuarantinedTree({ runtime, candidate, quarantinedPath });
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

function removeQuarantinedTree(context, directory = context.quarantinedPath) {
  const { runtime, quarantinedPath } = context;
  assertQuarantineUnchanged(context);
  const entries = runtime.readDirectory(directory, { withFileTypes: true });
  assertQuarantineUnchanged(context);

  for (const entry of entries) {
    assertQuarantineUnchanged(context);
    const target = path.join(directory, entry.name);
    const stat = runtime.inspect(target);
    assertQuarantineUnchanged(context);
    if (stat.isDirectory() && !stat.isSymbolicLink()) removeQuarantinedTree(context, target);
    else stageAndRemoveEntry(context, target);
    assertQuarantineUnchanged(context);
  }

  runtime.removeDirectory(directory);
  if (directory !== quarantinedPath) assertQuarantineUnchanged(context);
}

function stageAndRemoveEntry(context, target) {
  const { runtime, quarantinedPath } = context;
  const stagingDirectory = runtime.mkdirTemp(
    path.join(path.dirname(quarantinedPath), '.zclean-delete-')
  );
  const stagedPath = path.join(stagingDirectory, 'target');
  runtime.rename(target, stagedPath);
  assertQuarantineUnchanged(context);
  try {
    runtime.remove(stagedPath, { force: true });
  } finally {
    removeEmptyDirectory(runtime, stagingDirectory);
  }
}

function assertQuarantineUnchanged({ candidate, quarantinedPath }) {
  const reason = quarantinedSkipReason(candidate, quarantinedPath);
  if (!reason) return;
  const error = new Error('Quarantined cache path changed during removal.');
  error.code = reason.code;
  throw error;
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

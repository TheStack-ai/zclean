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
    close: options.closeSync || fs.closeSync,
    existsSync: options.existsSync || fs.existsSync,
    inspectDescriptor: options.fstatSync || fs.fstatSync,
    inspect: options.lstatSync || fs.lstatSync,
    mkdirTemp: options.mkdtempSync || fs.mkdtempSync,
    open: options.openSync || fs.openSync,
    readDirectory: options.readdirSync || fs.readdirSync,
    rename: options.renameSync || fs.renameSync,
    removeDirectory: options.rmdirSync || fs.rmdirSync,
    unlink: options.unlinkSync || fs.unlinkSync,
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
        const restoreError = restoreQuarantined(
          runtime,
          candidate.absolutePath,
          quarantinedPath,
          quarantineDirectory
        );
        if (restoreError) throw restoreError;
        skipped.push({ ...candidate, reason: quarantinedReason });
        continue;
      }
      removeQuarantinedTree({ runtime, candidate, quarantinedPath });
      const cleanupError = removeEmptyDirectory(runtime, quarantineDirectory);
      if (cleanupError) throw cleanupError;
      deleted.push(candidate);
    } catch (error) {
      const restoreError = restoreQuarantined(
        runtime,
        candidate.absolutePath,
        quarantinedPath,
        quarantineDirectory
      );
      const recoveryError = error.recoveryError || restoreError;
      failed.push({
        ...candidate,
        error: recoveryError
          ? structuredError(
            'cache-recovery-failed',
            'A cache directory could not be restored after cleanup stopped.',
            recoveryError
          )
          : structuredError(
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

function removeQuarantinedTree(context) {
  const { runtime, quarantinedPath } = context;
  assertQuarantineUnchanged(context);
  const entries = runtime.readDirectory(quarantinedPath, { withFileTypes: true });
  assertQuarantineUnchanged(context);

  for (const entry of entries) {
    assertQuarantineUnchanged(context);
    stageAndRemoveEntry(context, path.join(quarantinedPath, entry.name));
    assertQuarantineUnchanged(context);
  }

  runtime.removeDirectory(quarantinedPath);
}

function stageAndRemoveEntry(context, target) {
  const { runtime, quarantinedPath } = context;
  const stagingDirectory = runtime.mkdirTemp(
    path.join(path.dirname(quarantinedPath), '.zclean-delete-')
  );
  const stagedPath = path.join(stagingDirectory, 'target');
  runtime.rename(target, stagedPath);
  assertQuarantineUnchanged(context);
  let initial;
  let descriptor = null;
  let operationError = null;
  try {
    initial = runtime.inspect(stagedPath);
    assertQuarantineUnchanged(context);
    assertStagedUnchanged(runtime, stagedPath, initial);
    if (initial.isDirectory() && !initial.isSymbolicLink()) {
      removeStagedDirectory(context, stagedPath, initial);
    } else if (initial.isFile() && !initial.isSymbolicLink()) {
      if (Number(initial.nlink) !== 1) throw sharedInodeError();
      descriptor = runtime.open(stagedPath, fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = runtime.inspectDescriptor(descriptor, { bigint: true });
      if (!sameIdentity(initial, opened)) {
        throw new Error('Staged cache file identity changed while it was being opened.');
      }
      if (Number(opened.nlink) !== 1) throw sharedInodeError();
      assertStagedUnchanged(runtime, stagedPath, initial);
      runtime.unlink(stagedPath);
      const detached = runtime.inspectDescriptor(descriptor, { bigint: true });
      if (!sameIdentity(initial, detached) || Number(detached.nlink) !== 0) {
        throw sharedInodeError();
      }
      runtime.close(descriptor);
      descriptor = null;
    } else if (initial.isSymbolicLink()) {
      assertStagedUnchanged(runtime, stagedPath, initial);
      runtime.unlink(stagedPath);
    } else {
      const error = new Error('Staged cache entry type is not supported.');
      error.code = 'CACHE_ENTRY_UNSUPPORTED';
      throw error;
    }
  } catch (error) {
    operationError = error;
    if (descriptor !== null) {
      runtime.close(descriptor);
      descriptor = null;
    }
    const recoveryError = restoreStagedEntry(context, target, stagedPath, initial);
    if (recoveryError) error.recoveryError = recoveryError;
    throw error;
  } finally {
    if (descriptor !== null) runtime.close(descriptor);
    const cleanupError = removeEmptyDirectory(runtime, stagingDirectory);
    if (cleanupError && operationError && !operationError.recoveryError) {
      operationError.recoveryError = cleanupError;
    } else if (cleanupError && !operationError) {
      throw cleanupError;
    }
  }
}

function sharedInodeError() {
  const error = new Error('Staged cache file shares its inode with another path.');
  error.code = 'CACHE_SHARED_INODE';
  return error;
}

function removeStagedDirectory(context, stagedPath, initial) {
  const { runtime } = context;
  assertStagedUnchanged(runtime, stagedPath, initial);
  const entries = runtime.readDirectory(stagedPath, { withFileTypes: true });
  assertStagedUnchanged(runtime, stagedPath, initial);
  for (const entry of entries) {
    assertStagedUnchanged(runtime, stagedPath, initial);
    stageAndRemoveEntry(context, path.join(stagedPath, entry.name));
    assertStagedUnchanged(runtime, stagedPath, initial);
  }
  runtime.removeDirectory(stagedPath);
}

function restoreStagedEntry(context, target, stagedPath, initial) {
  const { runtime } = context;
  try {
    assertQuarantineUnchanged(context);
    if (!initial || !runtime.existsSync(stagedPath) || runtime.existsSync(target)) {
      throw new Error('Staged cache entry could not be restored.');
    }
    const current = runtime.inspect(stagedPath);
    if (!sameIdentity(initial, current)) {
      throw new Error('Staged cache entry identity changed before recovery.');
    }
    runtime.rename(stagedPath, target);
    return null;
  } catch (error) {
    error.code = 'CACHE_RECOVERY_FAILED';
    return error;
  }
}

function assertStagedUnchanged(runtime, stagedPath, initial) {
  let current;
  try {
    current = runtime.inspect(stagedPath);
  } catch (cause) {
    const error = new Error('Staged cache path could not be verified before removal.');
    error.code = 'cache-delete-identity-changed';
    error.cause = cause;
    throw error;
  }
  if (sameIdentity(initial, current)) return;
  const error = new Error('Staged cache path changed before removal.');
  error.code = 'cache-delete-identity-changed';
  throw error;
}

function sameIdentity(left, right) {
  return String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino)
    && left.isDirectory() === right.isDirectory()
    && left.isSymbolicLink() === right.isSymbolicLink();
}

function assertQuarantineUnchanged({ candidate, quarantinedPath }) {
  const reason = quarantinedSkipReason(candidate, quarantinedPath);
  if (!reason) return;
  const error = new Error('Quarantined cache path changed during removal.');
  error.code = reason.code;
  throw error;
}

function restoreQuarantined(runtime, originalPath, quarantinedPath, quarantineDirectory) {
  let recoveryError = null;
  try {
    if (quarantinedPath && runtime.existsSync(quarantinedPath) && !runtime.existsSync(originalPath)) {
      runtime.rename(quarantinedPath, originalPath);
    }
  } catch (error) {
    error.code = 'CACHE_RECOVERY_FAILED';
    recoveryError = error;
  }
  const cleanupError = removeEmptyDirectory(runtime, quarantineDirectory);
  return recoveryError || cleanupError;
}

function removeEmptyDirectory(runtime, directory) {
  if (!directory) return null;
  try {
    runtime.removeDirectory(directory);
    return null;
  } catch (error) {
    return error;
  }
}

module.exports = { cleanCacheTargets };

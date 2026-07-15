'use strict';

const fs = require('node:fs');
const { preDeleteSkipReason } = require('./cache-containment');
const { structuredError } = require('./cache-root');

function cleanCacheTargets(candidates, options = {}) {
  const deleted = [];
  const failed = [];
  const skipped = [];
  const rmSync = options.rmSync || fs.rmSync;
  const ordered = [...candidates]
    .sort((left, right) => String(right.relativePath || '').length - String(left.relativePath || '').length);

  for (const candidate of ordered) {
    const reason = preDeleteSkipReason(candidate);
    if (reason) {
      skipped.push({ ...candidate, reason });
      continue;
    }

    try {
      rmSync(candidate.absolutePath, { recursive: true, force: true });
      deleted.push(candidate);
    } catch (error) {
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

module.exports = { cleanCacheTargets };

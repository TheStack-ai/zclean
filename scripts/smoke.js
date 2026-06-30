'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const bin = path.join(repoRoot, 'bin', 'zclean.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zclean-smoke-'));
const env = {
  ...process.env,
  HOME: path.join(root, 'home'),
  ZCLEAN_CONFIG_DIR: path.join(root, 'config'),
  NO_COLOR: '1',
};

fs.mkdirSync(env.HOME, { recursive: true });
fs.mkdirSync(env.ZCLEAN_CONFIG_DIR, { recursive: true });

try {
  run(['--help']);
  run(['--version']);
  run(['config']);
  run(['report']);
  run(['audit']);
  const reportJson = run(['report', '--json']).stdout;
  const parsed = JSON.parse(reportJson);
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'ai-coding-runtime-hygiene' || parsed.notGeneralCleaner !== true) {
    throw new Error('report JSON did not match expected hygiene report contract');
  }
  const auditAlias = JSON.parse(run(['audit', '--json']).stdout);
  if (auditAlias.schemaVersion !== 1 || auditAlias.kind !== parsed.kind || auditAlias.notGeneralCleaner !== parsed.notGeneralCleaner) {
    throw new Error('audit alias did not match report contract');
  }
  const privatePath = path.join(env.HOME, 'private-project', 'server.js');
  fs.writeFileSync(
    path.join(env.ZCLEAN_CONFIG_DIR, 'history.jsonl'),
    JSON.stringify({
      timestamp: '2026-06-30T00:00:00.000Z',
      action: 'dry-run',
      found: 1,
      command: `node ${privatePath}`,
      cwd: path.dirname(privatePath),
    }) + '\n',
    'utf-8'
  );
  const history = JSON.parse(run(['history', '--json']).stdout);
  if (history.schemaVersion !== 1 || !Array.isArray(history.entries) || typeof history.summary.totalKilled !== 'number') {
    throw new Error('history JSON did not match expected contract');
  }
  if (JSON.stringify(history).includes(privatePath) || history.entries.some(hasUnsafeHistoryEntryKey)) {
    throw new Error('history JSON exposed an unsafe raw log field');
  }
  const protection = JSON.parse(run(['protect', 'list', '--json']).stdout);
  if (protection.schemaVersion !== 1 || !Array.isArray(protection.whitelist)) {
    throw new Error('protect list JSON did not match expected contract');
  }
  const workspace = path.join(root, 'workspace');
  const workspaceCache = path.join(workspace, '.next', 'cache');
  fs.mkdirSync(workspaceCache, { recursive: true });
  fs.writeFileSync(path.join(workspaceCache, 'page.bin'), 'cache-data', 'utf-8');
  const cacheDryRun = JSON.parse(run(['cache', `--path=${workspace}`, '--json']).stdout);
  if (cacheDryRun.schemaVersion !== 1 || cacheDryRun.kind !== 'workspace-cache-hygiene' || cacheDryRun.summary.count !== 1) {
    throw new Error('cache JSON did not match expected contract');
  }
  if (JSON.stringify(cacheDryRun).includes(workspace) || !fs.existsSync(workspaceCache)) {
    throw new Error('cache dry-run leaked absolute paths or deleted files');
  }
  const cacheClean = JSON.parse(run(['cache', `--path=${workspace}`, '--yes', '--json']).stdout);
  if (cacheClean.summary.deleted !== 1 || fs.existsSync(workspaceCache)) {
    throw new Error('cache --yes did not remove the supported cache path');
  }
  const doctor = JSON.parse(run(['doctor', '--json'], { allowedStatuses: [0, 1] }).stdout);
  if (doctor.schemaVersion !== 1 || !Array.isArray(doctor.checks) || typeof doctor.issueCount !== 'number') {
    throw new Error('doctor JSON did not match expected contract');
  }
  if (JSON.stringify(doctor).includes(env.HOME) || doctor.checks.some((check) => check.id === 'scheduler' && check.details && check.details.path)) {
    throw new Error('doctor JSON exposed a local scheduler path');
  }
  console.log(`smoke ok: isolated config root ${env.ZCLEAN_CONFIG_DIR} removed`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function hasUnsafeHistoryEntryKey(entry) {
  const safeKeys = new Set([
    'action',
    'errors',
    'failed',
    'found',
    'killed',
    'skipped',
    'timestamp',
    'totalMemFreed',
  ]);
  return Object.keys(entry).some((key) => !safeKeys.has(key));
}

function run(args, options = {}) {
  const allowedStatuses = options.allowedStatuses || [0];
  const result = spawnSync(process.execPath, [bin, ...args], {
    env,
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (!allowedStatuses.includes(result.status)) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`zclean ${args.join(' ')} exited ${result.status}`);
  }

  return result;
}

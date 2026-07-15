'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generatePlist } = require('../src/installer/launchd');
const { generateService, generateTimer } = require('../src/installer/systemd');
const { buildCreateTaskArgs } = require('../src/installer/taskscheduler');

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
  assertSchedulerContract();
  assertDocsContract();
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
  const rejectedCacheRoots = [
    { value: path.parse(env.HOME).root, code: 'cache-root-filesystem-root' },
    { value: env.HOME, code: 'cache-root-home-directory' },
  ];
  for (const rejected of rejectedCacheRoots) {
    const blockedResult = run(['cache', `--path=${rejected.value}`, '--json'], { allowedStatuses: [1] });
    const blocked = JSON.parse(blockedResult.stdout);
    if (blocked.status !== 'blocked' || blocked.safe !== false || blocked.exitCode !== 1) {
      throw new Error(`cache ${rejected.code} did not return a blocked report`);
    }
    if (blocked.errors[0]?.code !== rejected.code || JSON.stringify(blocked).includes(env.HOME)) {
      throw new Error(`cache ${rejected.code} exposed a path or returned the wrong error`);
    }
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

function assertSchedulerContract() {
  const plist = generatePlist('/usr/local/bin/zclean');
  const service = generateService('/usr/local/bin/zclean');
  const timer = generateTimer();
  const taskArgs = buildCreateTaskArgs('C:\\Program Files\\zclean.cmd');
  const taskCommand = taskArgs[taskArgs.indexOf('/TR') + 1];

  if (!plist.includes('<string>audit</string>') || !plist.includes('<string>--json</string>') || !plist.includes('<integer>3600</integer>')) {
    throw new Error('launchd scheduler is not an hourly audit --json job');
  }
  if (!service.includes(' audit --json') || !timer.includes('OnCalendar=hourly')) {
    throw new Error('systemd scheduler is not an hourly audit --json job');
  }
  if (!taskArgs.includes('HOURLY') || !taskCommand.endsWith(' audit --json')) {
    throw new Error('Task Scheduler job is not an hourly audit --json job');
  }
  if ([plist, service, taskCommand].some((definition) => definition.includes('--yes'))) {
    throw new Error('scheduler definition contains an automatic cleanup flag');
  }
}

function assertDocsContract() {
  const requiredClaims = {
    'README.md': [
      'Claude Code is supported, but never required.',
      '`zclean init` only creates or preserves the zclean config and installs the native hourly read-only `audit --json` scheduler.',
      'It installs no replacement hook.',
      'The native scheduler runs only read-only `audit --json` once per hour.',
      'It never passes `--yes` or performs automatic cleanup.',
      '`zclean init` does not install provider hooks.',
      '`cleanupEligible: true`',
      'exits nonzero.',
      'Raw process command lines and local filesystem paths are omitted from public JSON surfaces.',
    ],
    'README.ko.md': [
      'Claude Code는 지원 대상이지만 필수는 아닙니다.',
      '`zclean init`은 zclean 설정을 생성하거나 기존 설정을 보존하고, 네이티브 1시간 주기 읽기 전용 `audit --json` 스케줄러만 설치합니다.',
      '대체 hook은 설치하지 않습니다.',
      '네이티브 스케줄러는 1시간마다 읽기 전용 `audit --json`만 실행합니다.',
      '`--yes`를 전달하거나 자동 정리를 수행하지 않습니다.',
      '`zclean init`은 provider hook을 설치하지 않습니다.',
      '`cleanupEligible: true`',
      '0이 아닌 종료 코드',
      '공개 JSON에는 raw process command line과 로컬 파일시스템 경로를 포함하지 않습니다.',
    ],
    'README.zh.md': [
      '支持 Claude Code，但它从来不是必需项。',
      '`zclean init` 只会创建或保留 zclean 配置，并安装原生的每小时只读 `audit --json` 调度器。',
      '不会安装替代 hook。',
      '原生调度器每小时只运行只读的 `audit --json`。',
      '不会传入 `--yes`，也不会自动清理。',
      '`zclean init` 不会安装 provider hook。',
      '`cleanupEligible: true`',
      '非零退出码',
      '公开 JSON 不包含 raw process command line 和本地文件系统路径。',
    ],
  };
  const staleClaims = [
    'Install hooks + scheduler',
    'SessionEnd cleanup hook registered',
    'The scheduler runs only the default orphan-process cleanup.',
    '스케줄러는 기본 orphan process 정리만 실행합니다.',
    '调度器只运行默认的 orphan process 清理。',
  ];

  for (const [file, claims] of Object.entries(requiredClaims)) {
    const contents = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
    for (const claim of claims) {
      if (!contents.includes(claim)) throw new Error(`${file} is missing docs contract claim: ${claim}`);
    }
    for (const claim of staleClaims) {
      if (contents.includes(claim)) throw new Error(`${file} contains stale docs claim: ${claim}`);
    }
  }
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

## Context

zclean v0.1.0은 Node.js CLI로, 프로세스 탐지 시 `child_process.execSync`를 프로세스당 15회+ 호출하는 구조. 각 호출이 fork+exec+pipe로 ~30ms 소요되어 전체 스캔이 초 단위로 느림. 패턴은 Claude Code/Codex 중심으로 설계되어 Cursor, Windsurf 등 VS Code 기반 AI 도구를 커버하지 못함.

**현재 모듈 구조:**
```
bin/zclean.js          — CLI entry, command dispatch
src/scanner.js         — ps 호출 → 프로세스 리스트 → 패턴 매칭 + 필터
src/detector/orphan.js — PPID=1 체크 (execSync per process)
src/detector/patterns.js — 정규식 패턴 배열
src/detector/whitelist.js — daemon/docker/nohup/vscode 체크 (execSync per process)
src/killer.js          — SIGTERM→SIGKILL 시퀀스
src/config.js          — ~/.zclean/config.json 관리
src/installer/         — hook, launchd, systemd, taskscheduler
```

**제약:**
- zero-dependency 유지 (npm 패키지 추가 없음)
- Node.js 18+ 타겟
- macOS/Linux/Windows 크로스 플랫폼
- CLI 인터페이스 하위 호환

## Goals / Non-Goals

**Goals:**
- 스캔 성능 170x 개선 (4초 → 25ms at 100 processes)
- AI 도구 커버리지 40% → 90%+
- 범용 패턴 오탐 제거
- tmux 사용자 orphan 미탐지 버그 수정
- Kill 안전성 강화 (rate limit, spin wait 제거)

**Non-Goals:**
- VS Code Extension (v0.3 범위)
- `zclean watch` 실시간 모니터링 (v0.3 범위)
- confidence score 시스템 (v0.3 범위, 이번에는 AND 필터로 충분)
- Linux `/proc` 직접 읽기 최적화 (ps 1회 호출로 충분한 성능 달성)
- cgroup/namespace 기반 탐지 (현재 AI 도구가 cgroup을 안 만듦)

## Decisions

### D1: ProcessTree 모듈 신설 — `src/process-tree.js`

**선택:** 새 모듈 `src/process-tree.js`에 트리 구축/조회 로직을 집중.

**대안 A:** scanner.js 내부에 인라인 구현 → scanner.js가 400줄+ 비대화, 테스트 어려움.
**대안 B:** orphan.js 확장 → 이름과 책임이 안 맞음.

**구조:**
```js
// src/process-tree.js
class ProcessTree {
  constructor(processes)      // [{pid, ppid, cmd, rss, elapsed, lstart}, ...]

  // 조회 API
  get(pid)                    // → process info or null
  parent(pid)                 // → parent process or null
  children(pid)               // → [child processes]
  ancestors(pid)              // → [ancestor chain, root last]
  isOrphan(pid)               // → {isOrphan, ppid, reason}
  hasAncestorMatching(pid, testFn) // → boolean

  // 정적 팩토리
  static fromPS()             // Unix: ps -eo ... 1회 호출 → parse → new ProcessTree
  static fromWMIC()           // Windows: wmic 1회 호출 → parse → new ProcessTree
  static build()              // 플랫폼 자동 감지
}
```

**이점:** scanner, orphan, whitelist 모두 이 단일 인스턴스를 공유. execSync 0회 (빌드 시 1회).

### D2: ps 호출 포맷 — 단일 호출로 모든 필드 수집

**선택:** `ps -eo pid=,ppid=,rss=,etime=,lstart=,command=` 1회 호출.

`comm=`(짧은 이름)도 추가하면 whitelist의 `tmux`, `screen`, `pm2` 체크에 편리하지만, `command=`에서 추출 가능하므로 불필요.

**파싱:** 현재 `scanner.js:138`의 정규식 유지하되, `ppid` 필드 추가:
```js
/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/
//    PID    PPID    RSS    ELAPSED              LSTART                    COMMAND
```

### D3: AI_TOOL_DIRS — 중앙 집중 패턴 관리

**선택:** `patterns.js`에 `AI_TOOL_DIRS` 상수 배열과 이를 기반으로 한 통합 정규식 도입.

```js
const AI_TOOL_DIRS = [
  '.claude', '.cursor', '.windsurf', '.continue', '.cline',
  '.roo', '.kilocode', '.augment', '.codex', '.copilot',
  '.aider', '.gemini', '.trae', '.goose', '.vibe',
];

const AI_DIR_REGEX = new RegExp(
  `(?:${AI_TOOL_DIRS.map(d => d.replace('.', '\\.')).join('|')})[/\\\\]`
);
```

**활용:**
1. `node-ai-path` 패턴: 현재 `.claude|/mcp/|/agent/` → `AI_DIR_REGEX` 교체
2. 범용 패턴(tsx, npx 등): `match` AND `AI_DIR_REGEX` 이중 조건
3. 새 AI 도구 추가 시 배열에 한 줄 추가면 됨

### D4: 범용 패턴 오탐 방지 — AND 필터 전략

**선택:** 범용 도구 패턴에 `aiPathRequired: true` 플래그 추가.

```js
{
  name: 'tsx',
  match: /\btsx\b/,
  aiPathRequired: true,  // ← 새 필드: AI_DIR_REGEX도 매칭해야 함
  orphanOnly: true,
  maxOrphanAge: '24h',
}
```

scanner.js에서:
```js
if (pattern.aiPathRequired && !AI_DIR_REGEX.test(proc.cmd)) continue;
```

**대안:** 각 패턴에 개별 정규식 작성 → 중복, 유지보수 어려움.

### D5: tmux orphan 버그 — 조건 순서 변경

**선택:** scanner.js에서 orphan 체크를 tmux 체크보다 먼저 수행. PPID=1이면 tmux 체크 skip.

```js
// 현재 (버그):
const orphanResult = checkOrphan(proc.pid);
if (pattern.orphanOnly && !orphanResult.isOrphan) continue;
if (isInTerminalMultiplexer(proc.pid)) continue;  // orphan인데도 skip됨

// 수정:
const orphanResult = tree.isOrphan(proc.pid);
if (pattern.orphanOnly && !orphanResult.isOrphan) continue;
// PPID=1이면 이미 부모와 분리됨 — tmux 체크 불필요
if (!orphanResult.isOrphan && tree.hasAncestorMatching(proc.pid, isMultiplexer)) continue;
```

**근거:** PPID=1은 launchd/init에 입양된 것이므로 tmux 세션의 "의도적 실행"이 아님. tmux 안에서 실행됐더라도 orphan이 되었다면 정리 대상.

### D6: Kill rate limiting

**선택:** `config.maxKillBatch` (기본값 20). 초과 시 경고 메시지 출력하고 첫 N개만 kill.

**근거:** 시스템 전체 프로세스 수십 개를 한 번에 kill하면 예상치 못한 부작용 가능. 사용자에게 "다시 실행하세요"가 "시스템 불안정"보다 나음.

### D7: Spin wait 교체

**선택:** `execSync('sleep 0.5')` 사용.

**대안 A:** `Atomics.wait` — SharedArrayBuffer 필요, 환경 제한.
**대안 B:** `setTimeout` + async — killer.js 전체를 async로 변경해야 함, 범위 초과.
**대안 C:** `child_process.spawnSync('sleep', ['0.5'])` — execSync과 동일하지만 더 명시적.

`execSync('sleep 0.5')`이 가장 단순하고 zero-dependency 제약 충족. CPU spike 해소가 목적이므로 충분.

### D8: launchd plist 절대경로

**선택:** `generatePlist()`에서 `resolveZcleanBin()` 결과를 사용. 이미 함수가 존재하나 plist 생성 시 미활용.

## Risks / Trade-offs

**[Risk] ps 출력 파싱이 OS 버전에 따라 다를 수 있음**
→ Mitigation: `lstart` 포맷은 POSIX 표준이 아님. macOS와 Linux 간 미세 차이 존재. 기존 파싱 로직이 이미 처리 중이므로 위험 낮음. Windows는 별도 경로(wmic/powershell).

**[Risk] AI_TOOL_DIRS 목록이 빠르게 변할 수 있음**
→ Mitigation: config.json에 `customAiDirs` 배열 추가하여 사용자가 확장 가능하게.

**[Risk] `aiPathRequired` 플래그로 기존 탐지되던 정당한 좀비가 미탐지될 수 있음**
→ Mitigation: `orphanOnly: true` + `maxOrphanAge`가 여전히 작동. AI 경로가 없는 tsx orphan은 24h 후에도 잡히지 않지만, 이는 의도적 — AI 무관 프로세스를 잡는 것보다 안전.

**[Risk] maxKillBatch가 너무 작으면 사용자가 여러 번 실행해야 함**
→ Mitigation: 기본값 20은 대부분 시나리오를 커버. 경고 메시지에서 남은 수와 재실행 안내.

**[Trade-off] ProcessTree가 메모리에 전체 프로세스 목록을 보유**
→ 프로세스 1000개 × ~200bytes = ~200KB. Node.js heap 40MB 대비 무시 가능.

**[Trade-off] `sleep 0.5` execSync는 여전히 fork**
→ kill 시에만 발생 (스캔 시 아님). 프로세스당 1회 × 0.5초 대기이므로 수용 가능. 전체 스캔 성능에 영향 없음.

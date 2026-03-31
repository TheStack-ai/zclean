## 1. ProcessTree 모듈 신설 — `src/process-tree.js`

- [x] 1.1 `src/process-tree.js` 파일 생성: `ProcessTree` 클래스 뼈대 (constructor, static build/fromPS/fromWMIC)
- [x] 1.2 `fromPS()` 구현: `ps -eo pid=,ppid=,rss=,etime=,lstart=,command=` 1회 호출 + 파싱 (기존 scanner.js의 parseElapsed 로직 이동)
- [x] 1.3 `fromWMIC()` 구현: Windows wmic 1회 호출 + 파싱 (기존 scanner.js의 listProcessesWindows 로직 이동)
- [x] 1.4 트리 구축: `Map<pid, processInfo>`, `Map<pid, childPids[]>` 생성
- [x] 1.5 조회 API 구현: `get(pid)`, `parent(pid)`, `children(pid)`, `ancestors(pid)`
- [x] 1.6 `isOrphan(pid)` 구현: PPID=1(macOS/Linux), systemd --user, parent-gone 케이스
- [x] 1.7 `hasAncestorMatching(pid, testFn)` 구현: cycle protection 포함

<!-- 팀: implement (Codex implementer) — 독립 모듈, 병렬 작업 가능 -->

## 2. AI 도구 패턴 확장 — `src/detector/patterns.js`

- [x] 2.1 `AI_TOOL_DIRS` 상수 배열 추가 (14개 디렉토리)
- [x] 2.2 `AI_DIR_REGEX` 생성: AI_TOOL_DIRS 기반 통합 정규식
- [x] 2.3 `buildAiDirRegex(customDirs)` 함수: config의 customAiDirs와 병합
- [x] 2.4 새 패턴 추가: `claude-session` (`claude --session-id`), `codex-sandbox`, `aider`, `gemini-cli`
- [x] 2.5 기존 `node-ai-path` 패턴의 match를 AI_DIR_REGEX로 교체
- [x] 2.6 범용 패턴에 `aiPathRequired: true` 플래그 추가: `tsx`, `ts-node`, `npm-exec`, `esbuild`, `vite`, `next-dev`, `webpack`, `bun`, `deno`
- [x] 2.7 `matchPattern(cmdline, config)` 시그니처 변경: config에서 customAiDirs 읽어 regex 구축

<!-- 팀: implement (Codex implementer) — 독립 모듈, 1번과 병렬 가능 -->

## 3. Scanner 리팩토링 — `src/scanner.js`

- [x] 3.1 `scan()` 함수에서 `ProcessTree.build()` 호출로 전환 (listProcesses 대체)
- [x] 3.2 `checkOrphan(proc.pid)` → `tree.isOrphan(proc.pid)` 교체
- [x] 3.3 `isInTerminalMultiplexer(proc.pid)` → `tree.hasAncestorMatching()` 교체 + orphan 예외 로직 (PPID=1이면 tmux 체크 skip)
- [x] 3.4 `aiPathRequired` 필터 로직 추가: `pattern.aiPathRequired && !aiDirRegex.test(proc.cmd)` → skip
- [x] 3.5 `isSessionRelated()` → `tree.hasAncestorMatching()` 교체
- [x] 3.6 기존 `listProcessesUnix()`, `listProcessesWindows()`, `parseElapsed()` 제거 (process-tree.js로 이동됨)
- [x] 3.7 `isWhitelisted` 호출에 tree 인스턴스 전달하도록 시그니처 변경

<!-- 팀: implement (Claude implementer) — 1, 2번 완료 후 통합 작업 -->

## 4. Whitelist 리팩토링 — `src/detector/whitelist.js`

- [x] 4.1 `isWhitelisted(proc, config, tree)` 시그니처 변경: tree 파라미터 추가
- [x] 4.2 `hasDaemonAncestor(pid)` → `tree.hasAncestorMatching(pid, isDaemonManager)` 교체
- [x] 4.3 `isVSCodeChild(pid)` → `tree.hasAncestorMatching(pid, isVSCode)` 교체
- [x] 4.4 `isInDocker(pid)` 유지 (Linux /proc 기반, tree와 무관)
- [x] 4.5 기존 `hasDaemonAncestor`, `isVSCodeChild` 내부의 execSync loop 제거

<!-- 팀: implement (Claude implementer) — 3번과 함께 순차 -->

## 5. Orphan 모듈 정리 — `src/detector/orphan.js`

- [x] 5.1 `checkOrphan()` 함수를 thin wrapper로 변경: `tree.isOrphan()` 호출 (하위 호환)
- [x] 5.2 `isInTerminalMultiplexer()` 함수를 thin wrapper로 변경: `tree.hasAncestorMatching()` 호출
- [x] 5.3 내부 `checkOrphanUnix`, `checkOrphanWindows`, `isInTerminalMultiplexer`의 execSync 로직 제거
- [x] 5.4 모듈 export에 tree 의존성 문서화

<!-- 팀: implement (Claude implementer) — 4번과 함께 순차 -->

## 6. Kill 안전성 — `src/killer.js` + `src/config.js`

- [x] 6.1 `src/config.js`: `DEFAULT_CONFIG`에 `maxKillBatch: 20` 추가
- [x] 6.2 `killZombies()`: `config.maxKillBatch` 초과 시 slice + 경고 메시지
- [x] 6.3 `killProcessUnix()`: spin wait → `execSync('sleep 0.5')` 교체
- [x] 6.4 `killProcessWindows()`: spin wait → `execSync('timeout /T 1 /NOBREAK >nul')` 교체

<!-- 팀: implement (Codex implementer) — 독립, 1-5번과 병렬 가능 -->

## 7. Launchd 절대경로 — `src/installer/launchd.js`

- [x] 7.1 `installLaunchd()`에서 `resolveZcleanBin()` 결과를 `generatePlist()`에 전달 (이미 하고 있으나 plist 내 fallback 경로도 절대경로로)
- [x] 7.2 PATH 환경변수에 `$HOME/.nvm/versions/node/*/bin` 패턴도 포함 (nvm 사용자 대응)

<!-- 팀: implement (Codex implementer) — 독립, 6번과 병렬 가능 -->

## 8. 통합 테스트 + 검증

- [x] 8.1 실제 프로세스 환경에서 `node bin/zclean.js` dry-run 실행 — 기존 기능 동작 확인
- [x] 8.2 tmux 내에서 orphan 프로세스 생성 후 탐지 확인 (tmux 버그 수정 검증) — 6 orphans detected, tmux skip correctly bypassed
- [x] 8.3 tsx/npx 프로세스가 AI 경로 없이 실행 중일 때 오탐 없음 확인 — 0/7 false positives, 5/5 true positives
- [x] 8.4 `--yes` 모드에서 maxKillBatch 동작 확인 — batch limit 5로 테스트, 25→5 slice PASS
- [x] 8.5 launchd plist 재설치 후 절대경로 확인 — resolveZcleanBin + resolveNvmNodeBin PASS
- [ ] 8.6 Windows 환경 호환성 확인 (wmic 경로, taskkill 대기) — Windows 환경 없음, 스킵
- [x] 8.7 성능 벤치마크: 스캔 시간 측정 (목표: 100 프로세스 < 100ms) — 실측 57ms

<!-- 팀: review (reviewer) — 전체 완료 후 검수. e2e-test도 고려 -->

---

## 오케스트레이터 팀 배정

| 태스크 그룹 | 팀 | 엔진 | 병렬 여부 |
|------------|-----|------|---------|
| 1. ProcessTree 모듈 | `implement` | Codex (병렬 실행) | **병렬 A** |
| 2. AI 도구 패턴 | `implement` | Codex (병렬 실행) | **병렬 A** |
| 6. Kill 안전성 | `implement` | Codex (병렬 실행) | **병렬 A** |
| 7. Launchd 절대경로 | `implement` | Codex (병렬 실행) | **병렬 A** |
| 3. Scanner 리팩토링 | `implement` | Claude (순차) | **순차 B** (1,2 완료 후) |
| 4. Whitelist 리팩토링 | `implement` | Claude (순차) | **순차 B** |
| 5. Orphan 정리 | `implement` | Claude (순차) | **순차 B** |
| 8. 통합 테스트 | `review` + `e2e-test` | Claude + Codex | **순차 C** (전체 완료 후) |

**실행 순서:**
```
Phase A (병렬): [1] ProcessTree + [2] Patterns + [6] Kill Safety + [7] Launchd
        ↓
Phase B (순차): [3] Scanner → [4] Whitelist → [5] Orphan (1,2에 의존)
        ↓
Phase C (검증): [8] 통합 테스트 + 리뷰
```

## Why

zclean v0.1.0은 AI 코딩 도구 좀비 프로세스를 정리하는 유일한 멀티 도구 CLI이지만, 세 가지 근본적 한계가 실사용을 막고 있다:

1. **성능**: 프로세스당 `execSync` 15회 호출로 100개 프로세스 스캔에 4초, 1000개에 24초 소요. Claude Code SessionEnd hook에서 실행 시 세션 종료가 느려지는 체감 발생.
2. **커버리지 40%**: 15개 주요 AI 도구 중 6개만 탐지. Cursor, Windsurf, Cline, Aider, Gemini CLI, Copilot 등 미지원으로 "멀티 도구" 약속 미이행.
3. **신뢰 위험**: tsx, npx 등 범용 패턴이 AI 무관 프로세스를 오탐하고, tmux 사용자의 orphan 좀비를 미탐지하는 버그 존재.

AI 도구 벤더(Anthropic 등)가 자체 cleanup 기능을 내장하기 전에 멀티 도구 커버리지를 확보해야 하며, 이는 시간과의 싸움이다.

## What Changes

- **In-memory process tree**: `ps` 1회 호출 → 메모리 내 트리 구축. 모든 ancestor/descendant 조회를 O(depth) 메모리 연산으로 전환. **170x 성능 개선**.
- **AI 도구 패턴 확장**: 13개 AI 도구 디렉토리 패턴 추가 (`.cursor`, `.windsurf`, `.cline`, `.aider`, `.gemini`, `.copilot`, `.roo`, `.kilocode`, `.augment`, `.codex`, `.trae`, `.goose`, `.continue`). `claude --session-id` 패턴 추가.
- **오탐 방지**: `tsx`, `npx`, `ts-node`, `vite`, `esbuild`, `webpack`, `next dev` 패턴에 AI 도구 경로 AND 조건 적용.
- **tmux orphan 버그 수정**: `PPID=1`(orphan 확정)이면 tmux ancestor 체크를 skip.
- **Kill rate limiting**: `maxKillBatch` 설정으로 한 번에 최대 N개만 kill.
- **Spin wait 제거**: `killer.js`의 CPU 100% busy-wait를 blocking sleep으로 교체.
- **launchd 절대경로**: plist에서 `npx` 대신 `resolveZcleanBin()` 결과 사용.

## Capabilities

### New Capabilities
- `process-tree`: In-memory process tree 구축 및 조회 모듈. 단일 `ps` 호출로 전체 프로세스 정보 수집, 트리 구조화, ancestor/descendant/orphan/session 조회 API 제공.
- `ai-tool-patterns`: 확장된 AI 도구 탐지 패턴 시스템. AI_TOOL_DIRS 통합 패턴, 범용 패턴 오탐 방지 AND 필터, confidence score 기반 분류.
- `kill-safety`: Kill rate limiting 및 spin wait 제거. 안전한 프로세스 종료 보장.

### Modified Capabilities
<!-- 기존 specs가 없으므로 비워둠 -->

## Impact

- **src/scanner.js**: 전면 리팩토링. `listProcessesUnix()`가 process tree를 반환하도록 변경. `checkOrphan`, `isInTerminalMultiplexer` 등의 호출 방식 변경.
- **src/detector/orphan.js**: `execSync` 제거, tree 기반 조회로 전환. `isInTerminalMultiplexer`에 orphan 예외 로직 추가.
- **src/detector/patterns.js**: `PATTERNS` 배열 확장, `AI_TOOL_DIRS` 상수 추가, 기존 범용 패턴에 AI 경로 필터 적용.
- **src/detector/whitelist.js**: `hasDaemonAncestor`, `isVSCodeChild` 등을 tree 기반으로 전환.
- **src/killer.js**: spin wait 제거, `maxKillBatch` 적용.
- **src/installer/launchd.js**: plist 생성 시 절대경로 사용.
- **src/config.js**: `DEFAULT_CONFIG`에 `maxKillBatch` 추가.
- **하위 호환성**: CLI 인터페이스, config 파일 형식, hook 연동 방식 변경 없음. 내부 모듈 API만 변경.

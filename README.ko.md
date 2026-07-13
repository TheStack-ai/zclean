# zclean

**Claude Code, Codex, Cursor, Windsurf, MCP 서버, agent browser, 로컬 개발 캐시를 위한 AI 코딩 런타임 위생 CLI입니다.**

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md)

## zclean이 해결하는 문제

AI 코딩 도구는 작업 중 많은 임시 런타임을 만듭니다.

- MCP 서버
- Claude Code sub-agent
- Codex sandbox
- headless browser / Playwright
- `npm exec`, `tsx`, `bun`, `deno`, Python helper
- Vite, Next.js, webpack, esbuild 같은 개발 서버와 watcher

세션이 종료되거나 강제 종료되면 일부 프로세스가 orphan/zombie처럼 남아 메모리, 포트, 파일 핸들을 계속 잡을 수 있습니다. `zclean`은 이런 잔재를 찾아 설명하고, 안전 조건을 통과한 경우에만 정리합니다.

## zclean이 하는 일

1. **AI 런타임 zombie process 정리**
   - Claude Code, Codex, Cursor/Windsurf 계열 agent, MCP server, agent browser 잔재를 탐지합니다.
   - 기본은 dry-run입니다.
   - 실제 kill은 `--yes`가 있어야 합니다.

2. **안전한 workspace cache 정리**
   - `.next/cache`
   - `.turbo`
   - `.vite`
   - `.parcel-cache`
   - `node_modules/.cache`
   - `.pytest_cache`
   - `.ruff_cache`
   - `.mypy_cache`
   - `__pycache__`

3. **리포트와 자동화용 JSON**
   - `zclean report --json`
   - `zclean history --json`
   - `zclean cache --json`
   - `zclean doctor --json`

## zclean이 하지 않는 일

`zclean`은 일반적인 시스템 클리너가 아닙니다.

- 앱을 삭제하지 않습니다.
- 전체 디스크를 훑지 않습니다.
- 문서/다운로드/사진 같은 사용자 파일을 건드리지 않습니다.
- 텔레메트리를 보내지 않습니다.
- 임의 폴더를 추측해서 지우지 않습니다.

목표는 좁고 명확합니다. **AI 코딩 런타임 정리와 개발 workspace cache hygiene**입니다.

## 설치

먼저 설치나 정리 없이 읽기 전용 audit을 실행하세요:

```bash
npx --yes z-clean audit
```

정리 전에 후보를 검토하세요:

```bash
npx --yes z-clean
npx --yes z-clean report
```

계속 사용하려면 전역 설치하세요:

```bash
npm install --global z-clean --foreground-scripts
zclean report
```

`--foreground-scripts`를 사용하면 zclean 설치 워드마크가 표시됩니다. npm 7 이상은 lifecycle 출력을 기본적으로 숨기므로 `npm install -g z-clean`도 정상 설치되지만 완료 화면은 보이지 않을 수 있습니다.

자동 실행은 선택 사항입니다:

```bash
zclean init
```

`zclean init`은 Claude Code session hook과 OS scheduler를 설치합니다. dry-run 결과를 확인한 후에만 실행하세요. 상주 daemon을 설치하지는 않습니다.

## 자주 쓰는 명령

```bash
zclean                  # zombie process dry-run scan
zclean --yes            # 검증된 zombie process 정리
zclean report           # 읽기 전용 hygiene report
zclean report --json    # 자동화용 JSON report
zclean cache            # workspace cache dry-run scan
zclean cache --yes      # 지원되는 cache directory 삭제
zclean cache --json     # cache 후보 JSON 출력
zclean --pattern=my-agent-worker  # 이번 scan에 literal orphan pattern 추가
zclean history --json   # 정리 이력 JSON
zclean protect list     # 보호 목록 확인
zclean protect add mcp-server-keep
zclean doctor --json    # 설치/탐지/스케줄러 상태 점검
```

패턴을 계속 사용하려면 `~/.zclean/config.json`의 `customPatterns` 배열에 문자열을 추가하세요. 패턴은 정규식이 아닌 대소문자 무시 literal 문자열이며 3–80자의 출력 가능한 문자만 허용됩니다. `node`, `node /`, `ode` 같은 일반 runtime 이름과 부분 문자열은 거부되고, orphan이면서 `maxAge`(기본 24시간)를 넘은 process만 후보가 됩니다. 잘못되거나 0인 기간은 안전한 기본값 24시간으로 돌아갑니다. whitelist, PID 재검증, dry-run, `--yes` 안전장치는 그대로 유지됩니다.

다른 workspace cache를 확인하려면:

```bash
zclean cache --path=/path/to/project
```

## 안전 설계

- 기본은 dry-run입니다.
- 실제 정리는 `--yes`가 있어야 합니다.
- 살아 있는 parent process가 있으면 건드리지 않습니다.
- tmux, screen, PM2, Forever, Docker, VS Code child process는 보호합니다.
- kill 직전 PID identity를 다시 확인합니다.
- 프로세스 탐지 실패는 “깨끗함”으로 숨기지 않고 오류로 표시합니다.
- JSON 출력은 raw command와 로컬 절대경로 노출을 피합니다.

## 지원 플랫폼

| 플랫폼 | 상태 |
|--------|------|
| macOS | launchd scheduler, Claude Code hook, dry-run/cleanup |
| Linux | systemd user timer, Claude Code hook, dry-run/cleanup |
| Windows | Task Scheduler installer, 비파괴 CI coverage, `zclean doctor` 권장 |

## 제거

```bash
zclean uninstall
npm uninstall -g z-clean
```

## 라이선스

MIT - [LICENSE](LICENSE)

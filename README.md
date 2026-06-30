# zclean

<div align="center">

<pre>
zclean
AI coding runtime hygiene
</pre>

**AI coding runtime hygiene for Claude Code, Codex, Cursor, Windsurf, MCP servers, agent browsers, and local dev caches.**

[![npm version](https://img.shields.io/npm/v/@thestackai/zclean?style=flat-square&color=blue)](https://www.npmjs.com/package/@thestackai/zclean)
[![npm downloads](https://img.shields.io/npm/dm/@thestackai/zclean?style=flat-square&color=brightgreen)](https://www.npmjs.com/package/@thestackai/zclean)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](#)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#platform-status)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=flat-square)](#)
[![Tests](https://img.shields.io/badge/tests-99%20passing-brightgreen?style=flat-square)](#)
[![GitHub stars](https://img.shields.io/github/stars/TheStack-ai/zclean?style=flat-square)](https://github.com/TheStack-ai/zclean)
[![Mentioned in Awesome Claude Code Toolkit](https://awesome.re/mentioned-badge.svg)](https://github.com/rohitg00/awesome-claude-code-toolkit)

[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md)

</div>

<p align="center">
  <img src="assets/zclean-hero.png" alt="zclean AI coding runtime hygiene banner" width="960">
</p>

---

## What zclean is

`zclean` is a zero-dependency CLI that keeps AI coding sessions from leaving runtime mess behind.

It helps with two local hygiene problems:

1. **Zombie AI runtime processes**.
   Orphaned MCP servers, sub-agents, headless browsers, package runners, sandboxes, and dev servers left behind by Claude Code, Codex, Cursor-style agents, Windsurf, and other AI coding tools.

2. **Safe workspace cache cleanup**.
   Common project cache directories such as `.next/cache`, `.turbo`, `.vite`, `.parcel-cache`, `node_modules/.cache`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, and Python `__pycache__`.

It is local-only, dry-run first, and requires `--yes` before destructive cleanup.

## What zclean is not

`zclean` is not an app uninstaller, system optimizer, disk map, telemetry agent, or whole-disk cleaner. It does not crawl your entire Mac, delete documents, remove applications, or touch arbitrary folders.

The goal is narrower: **AI coding cleanup and developer workspace hygiene**.

## Quick Start

```bash
npm install -g @thestackai/zclean
zclean init
```

One-off dry run without installation:

```bash
npx --yes @thestackai/zclean
```

Review before cleaning:

```bash
zclean report
zclean report --json
```

Clean only when you decide:

```bash
zclean --yes
zclean cache --yes
```

## Why developers use it

AI coding tools spawn many short-lived runtimes while they work:

- MCP servers
- Claude Code sub-agents
- Codex sandboxes
- headless Chromium or Playwright sessions
- `npm exec`, `tsx`, `bun`, `deno`, and Python helpers
- build watchers such as Vite, Next.js, webpack, and esbuild

When an agent crashes, a terminal closes, or a session ends abruptly, those child processes can keep running. They hold memory, ports, file handles, and CPU. zclean finds them, explains why they are candidates, and cleans them only when the safety checks pass.

## Core commands

| Command | What it does |
|---------|--------------|
| `zclean` | Dry-run scan for AI runtime zombie processes |
| `zclean --yes` | Kill verified zombie runtime processes |
| `zclean report` | Human-readable AI runtime hygiene report |
| `zclean report --json` | Machine-readable report for CI, local dashboards, or agents |
| `zclean audit` | Alias for `zclean report` |
| `zclean cache` | Dry-run scan for supported workspace cache directories |
| `zclean cache --yes` | Remove supported workspace cache directories |
| `zclean cache --json` | Machine-readable cache hygiene report |
| `zclean history` | Recent cleanup history |
| `zclean history --json` | Sanitized cleanup history and cumulative stats |
| `zclean protect list` | Show protected process patterns |
| `zclean protect add <entry>` | Add a protected process pattern |
| `zclean protect remove <entry>` | Remove a protected process pattern |
| `zclean protect remove --index=N` | Remove a protected entry by index |
| `zclean doctor` | Check hook, scheduler, config, and process enumeration health |
| `zclean doctor --json` | Structured health check output |
| `zclean init` | Install Claude Code hook and OS scheduler |
| `zclean status` | Show current zombie status and recent cleanup |
| `zclean logs` | Show detailed cleanup log |
| `zclean config` | Show current configuration |
| `zclean uninstall` | Remove hooks and schedulers |

## Runtime cleanup

Dry run:

```bash
zclean
```

Example output:

```text
zclean - scanning for zombie processes...

Found 12 zombie processes:

  PID 26413  node      367 MB  18h  claude mcp-server
  PID 62830  chrome    200 MB   3h  agent-browser
  PID 26221  npm       142 MB   2d  npm exec task-master-ai

Total memory reclaimable: 2.4 GB
Run zclean --yes to clean up these processes.
```

Actual cleanup:

```bash
zclean --yes
```

Safety rules:

- Manual scans are dry-run by default.
- Cleanup requires `--yes`.
- Active parent sessions are protected.
- tmux, screen, PM2, Forever, Docker, and VS Code child processes are skipped.
- PID identity is re-verified before every kill to avoid PID recycling accidents.
- Process enumeration failures are reported as errors, not as a fake "clean" state.

## Workspace cache cleanup

Dry run:

```bash
zclean cache
```

Clean supported cache directories:

```bash
zclean cache --yes
```

Scan another workspace:

```bash
zclean cache --path=/path/to/project
```

Supported default cache targets:

| Cache path | Common source |
|------------|---------------|
| `.next/cache` | Next.js |
| `.nuxt` | Nuxt |
| `.turbo` | Turborepo |
| `.vite` | Vite |
| `.parcel-cache` | Parcel |
| `node_modules/.cache` | JavaScript tooling |
| `.pytest_cache` | pytest |
| `.ruff_cache` | Ruff |
| `.mypy_cache` | mypy |
| `__pycache__` | Python bytecode |

`zclean cache --json` emits relative paths only. It does not expose absolute local paths and does not remove anything unless `--yes` is present.

## Report and JSON surfaces

`zclean report --json` is designed for scripts, CI notes, local dashboards, and other agents:

```bash
zclean report --json
```

The report includes:

- `schemaVersion: 1`
- AI runtime hygiene status
- candidate count and reclaimable memory
- top candidates by risk
- scan warnings and errors
- cleanup history summary
- safety guardrails
- recommended next actions

Raw command lines and local filesystem paths are omitted from public JSON surfaces.

## History, protection, and doctor

Machine-readable history:

```bash
zclean history --json
```

Protection list management:

```bash
zclean protect list
zclean protect add "mcp-server-keep"
zclean protect remove "mcp-server-keep"
```

Health checks:

```bash
zclean doctor
zclean doctor --json
```

`doctor --json` exits `0` only when the setup is healthy. Warnings and errors exit `1` so automation can treat non-healthy states honestly.

## Configuration

`~/.zclean/config.json`:

```json
{
  "whitelist": [],
  "maxAge": "24h",
  "memoryThreshold": "500MB",
  "maxKillBatch": 20,
  "sigterm_timeout": 10,
  "dryRunDefault": true,
  "logRetention": "30d",
  "customAiDirs": []
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `whitelist` | `[]` | Process name patterns to never kill; manage with `zclean protect` |
| `maxAge` | `"24h"` | Flag orphaned AI-path runtime processes only after this age |
| `memoryThreshold` | `"500MB"` | Flag AI-path runtime orphans above this memory usage |
| `maxKillBatch` | `20` | Maximum process kills per invocation |
| `sigterm_timeout` | `10` | Seconds to wait after SIGTERM before SIGKILL |
| `dryRunDefault` | `true` | Manual scans stay dry-run by default; cleanup still requires `--yes` |
| `logRetention` | `"30d"` | Cleanup history retention |
| `customAiDirs` | `[]` | Additional AI tool directories to detect, such as `[".mytool"]` |

## Supported tools

| Tool or runtime | Coverage |
|-----------------|----------|
| Claude Code | MCP servers, sub-agents, sessions, agent browsers, Playwright |
| Codex | `codex exec`, Codex sandboxes |
| Cursor and Windsurf-style agents | AI-path runtime leftovers and browser helpers |
| Aider | Orphaned Aider/Python processes |
| Gemini CLI | Orphaned Gemini processes |
| MCP servers | `mcp-server-*` patterns |
| JavaScript runtimes | `node`, `tsx`, `ts-node`, `bun`, `deno` on AI paths |
| Build tools | Vite, Next.js, webpack, esbuild on AI paths |
| Workspace caches | Next.js, Nuxt, Turborepo, Vite, Parcel, Python, JS tooling caches |

## Platform status

| Platform | Status |
|----------|--------|
| macOS | launchd scheduler, Claude Code hook, dry-run and cleanup paths |
| Linux | systemd user timer, Claude Code hook, dry-run and cleanup paths |
| Windows | Task Scheduler installer and non-destructive CI coverage; run `zclean doctor` after install to confirm local scheduler and process enumeration health |

## FAQ

### Will zclean kill my running Claude Code session?

Manual and scheduled scans protect active sessions by checking whether the parent process is alive. The Claude Code `SessionEnd` hook passes `--session-pid` so cleanup is scoped to descendants of the session that just ended.

### Will zclean delete my project files?

No. Runtime cleanup kills verified zombie processes. Cache cleanup only removes supported cache directories and only with `zclean cache --yes`.

### Is zclean a general Mac cleaner?

No. zclean focuses on AI coding runtime cleanup and safe developer workspace cache cleanup. It does not uninstall apps, draw disk maps, or scan the whole disk.

### Does the scheduler slow my machine?

No. The scheduler runs a single scan and exits. There is no persistent background daemon.

### How do I remove zclean?

```bash
zclean uninstall
npm uninstall -g @thestackai/zclean
```

If you only used `npx --yes @thestackai/zclean`, there is no global package to uninstall.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Adding a process pattern? Edit `src/detector/patterns.js`.

Adding a cache target? Keep it deterministic, workspace-scoped, and dry-run first.

## License

MIT - see [LICENSE](LICENSE).

---

Built by [TheStack-ai](https://github.com/TheStack-ai).

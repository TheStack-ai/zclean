# zclean

<div align="center">

<pre>
zclean
AI coding runtime hygiene
</pre>

**AI coding runtime hygiene for Codex, Claude Code, Cursor, Windsurf, MCP servers, agent browsers, test servers, and local dev caches.**

[![npm version](https://img.shields.io/npm/v/z-clean?style=flat-square&color=blue)](https://www.npmjs.com/package/z-clean)
[![npm downloads](https://img.shields.io/npm/dm/z-clean?style=flat-square&color=brightgreen)](https://www.npmjs.com/package/z-clean)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](#)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#platform-status)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=flat-square)](#)
[![Tests](https://img.shields.io/badge/tests-246%20passing-brightgreen?style=flat-square)](#)
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

It works across Codex, Claude Code, Cursor, Windsurf, MCP servers, agent browsers, and local test servers. Claude Code is supported, but never required.

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

Start with a read-only audit. This does not install hooks, schedule jobs, or clean anything:

```bash
npx --yes z-clean audit
```

Review the candidates before cleaning:

```bash
npx --yes z-clean
npx --yes z-clean report
```

Install the CLI when you are ready to keep using it:

```bash
npm install --global z-clean --foreground-scripts
zclean report
```

`--foreground-scripts` displays zclean's install wordmark. npm 7+ hides lifecycle output by default, so plain `npm install -g z-clean` still installs correctly but may not show the branded completion screen.

Clean only when you decide:

```bash
zclean --yes
zclean cache --yes
```

Optional automation:

```bash
zclean init
```

`zclean init` only creates or preserves the zclean config and installs the native hourly read-only `audit --json` scheduler. Run it only after reviewing the dry-run output. It does not install a persistent daemon.

For users upgrading from v0.3.3, init may remove only the exact unsafe v0.3.3 Claude Code `Stop` hook previously written by zclean. It installs no replacement hook. Having no zclean hook is healthy and fully supported.

The native scheduler runs only read-only `audit --json` once per hour. It never passes `--yes` or performs automatic cleanup. `zclean init` does not install provider hooks. It never auto-schedules cache, rescue, worktree, or standalone MCP maintenance.

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
| `zclean --yes` | Kill only `cleanupEligible` `confirmed-stale` runtime candidates |
| `zclean report` | Human-readable AI runtime hygiene report |
| `zclean report --json` | Machine-readable report for CI, local dashboards, or agents |
| `zclean audit` | Alias for `zclean report` |
| `zclean cache` | Dry-run scan for supported workspace cache directories |
| `zclean cache --yes` | Remove supported workspace cache directories |
| `zclean cache --json` | Machine-readable cache hygiene report |
| `zclean --pattern=my-agent-worker` | Add one literal orphan-process pattern for this scan |
| `zclean history` | Recent cleanup history |
| `zclean history --json` | Sanitized cleanup history and cumulative stats |
| `zclean protect list` | Show protected process patterns |
| `zclean protect add <entry>` | Add a protected process pattern |
| `zclean protect remove <entry>` | Remove a protected process pattern |
| `zclean protect remove --index=N` | Remove a protected entry by index |
| `zclean doctor` | Check config, provider-neutral setup, scheduler, and process enumeration health |
| `zclean doctor --json` | Structured health check output |
| `zclean init` | Create/preserve config and install the hourly read-only audit scheduler |
| `zclean status` | Show current zombie status and recent cleanup |
| `zclean logs` | Show detailed cleanup log |
| `zclean config` | Show current configuration |
| `zclean uninstall` | Remove the scheduler and an exact legacy zclean hook, if present |

## Runtime cleanup

Dry run:

```bash
zclean
```

Example output:

```text
zclean - scanning for zombie processes...

Found 3 stale-runtime candidates:

  PID  26413  claude       confirmed-stale   367.0 MB     18h
    confidence: high (100/100)
    evidence: runtime-pattern:mcp-server, provider:claude, orphan:parent-gone, age-grace-met, start-time:verified

  PID  62830  unknown      unattributed      200.0 MB      3h
    confidence: low (35/100)
    evidence: runtime-pattern:agent-browser, provider:unknown, orphan:parent-gone
    blocked: provider-pattern-not-strong, age-grace-not-met

  Candidate memory: 709.0 MB
  Eligible: 1; blocked: 2; eligible memory: 367.0 MB

  Run zclean --yes to clean up eligible candidates.
```

Actual cleanup:

```bash
zclean --yes
```

Safety rules:

- Manual scans are dry-run by default.
- Only candidates with `classification: "confirmed-stale"` and `cleanupEligible: true` can be killed by `zclean --yes`.
- Active parent sessions are protected.
- tmux, screen, PM2, Forever, Docker, and VS Code child processes are skipped.
- PID identity is re-verified before every kill to avoid PID recycling accidents.
- Process enumeration failures are reported as errors, not as a fake "clean" state.

Candidate reports expose `provider`, `classification`, `confidence`, sanitized `evidence`, `cleanupEligible`, and `blockedReasons`. Suspected or unattributed entries remain report-only even when `--yes` is present.

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

`zclean cache` rejects the filesystem root, the user home directory, and symbolic-link or junction roots; `--json` returns a blocked JSON report and exits nonzero.

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

Raw process command lines and local filesystem paths are omitted from public JSON surfaces.

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
  "customAiDirs": [],
  "customPatterns": []
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
| `customPatterns` | `[]` | Case-insensitive literal command fragments for additional orphan processes |

Custom patterns are deliberately restricted: values must contain 3–80 printable characters, generic runtime names and fragments such as `node`, `node /`, or `ode` are rejected, and values are treated as literal text rather than regular expressions. Candidates must be orphaned and older than `maxAge` (24 hours by default); invalid or zero durations fall back to that safe default. Whitelists, PID identity verification, batch limits, dry-run behavior, and the explicit `--yes` cleanup gate still apply.

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
| macOS | launchd scheduler, provider-neutral dry-run and cleanup paths |
| Linux | systemd user timer, provider-neutral dry-run and cleanup paths |
| Windows | Task Scheduler installer and non-destructive CI coverage; run `zclean doctor` after install to confirm local scheduler and process enumeration health |

## FAQ

### Will zclean kill my running AI coding session?

Manual and scheduled scans protect active sessions by checking whether the parent process is alive. zclean does not require a provider hook, and init does not install one.

### Will zclean delete my project files?

No. Runtime cleanup kills verified zombie processes. Cache cleanup only removes supported cache directories and only with `zclean cache --yes`.

### Is zclean a general Mac cleaner?

No. zclean focuses on AI coding runtime cleanup and safe developer workspace cache cleanup. It does not uninstall apps, draw disk maps, or scan the whole disk.

### Does the scheduler slow my machine?

No. The scheduler runs one read-only `audit --json` report per hour and exits. It never passes `--yes`, so it performs no automatic cleanup; cache and future maintenance commands are not added to the schedule.

### How do I remove zclean?

```bash
zclean uninstall
npm uninstall -g z-clean
```

If you only used `npx --yes z-clean`, there is no global package to uninstall.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Adding a process pattern? Edit `src/detector/patterns.js`.

Adding a cache target? Keep it deterministic, workspace-scoped, and dry-run first.

## License

MIT - see [LICENSE](LICENSE).

---

Built by [TheStack-ai](https://github.com/TheStack-ai).

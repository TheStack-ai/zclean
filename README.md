<div align="center">

<pre>
███████  ██████ ██      ███████  █████  ███    ██
╚══███  ██      ██      ██      ██   ██ ████   ██
  ███   ██      ██      █████   ███████ ██ ██  ██
 ███    ██      ██      ██      ██   ██ ██  ██ ██
███████  ██████ ███████ ███████ ██   ██ ██   ████
</pre>

**Stop AI coding tools from eating your RAM.**

[![npm version](https://img.shields.io/npm/v/@thestackai/zclean?style=flat-square&color=blue)](https://www.npmjs.com/package/@thestackai/zclean)
[![npm downloads](https://img.shields.io/npm/dm/@thestackai/zclean?style=flat-square&color=brightgreen)](https://www.npmjs.com/package/@thestackai/zclean)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](#)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue?style=flat-square)](#)
[![Tests](https://img.shields.io/badge/tests-58%20passing-brightgreen?style=flat-square)](#)
[![GitHub stars](https://img.shields.io/github/stars/TheStack-ai/zclean?style=flat-square)](https://github.com/TheStack-ai/zclean)
[![Mentioned in Awesome Claude Code Toolkit](https://awesome.re/mentioned-badge.svg)](https://github.com/rohitg00/awesome-claude-code-toolkit)

</div>

<p align="center">
  <img src="assets/demo.gif" alt="zclean demo" width="600">
</p>

---

## Quick Demo

AI coding tools spawn child processes — MCP servers, sub-agents, headless browsers, build watchers. When the session ends or crashes, those children don't always exit. They pile up silently, draining RAM until your machine grinds to a halt.

**Before**

```
$ zclean

  zclean — scanning for zombie processes...

  Found 12 zombie processes:

    PID 26413  node         367 MB  (orphan, 18h)  was: claude mcp-server
    PID 62830  chrome       200 MB  (orphan, 3h)   was: agent-browser
    PID 26221  npm          142 MB  (orphan, 2d)   was: npm exec task-master-ai
    PID 23096  node         355 MB  (orphan, 6h)   was: claude sub-agent
    ... 8 more

  Total: 12 zombies, ~2.4 GB reclaimable

  Run `zclean --yes` to clean.
```

**After**

```
$ zclean --yes

  zclean — scanning for zombie processes...

  Cleaned 12 zombie processes. Reclaimed ~2.4 GB.

  zclean status:
    Protection: active
    SessionEnd hook: registered
    Hourly scheduler: running
```

## Why zclean?

Claude Code, Codex, and other AI coding tools spawn dozens of child processes per session: MCP servers, sub-agents, headless Chromium instances, esbuild watchers, and more. When the parent session exits — especially on crash or force-quit — these children become orphans.

They keep running. They keep consuming RAM. Your machine gets slower day by day, and you blame the AI tool when the real culprit is zombie processes nobody cleaned up.

`zclean` fixes this automatically. Install once, forget about it.

## Install

```bash
npx z-clean init
```

That's it. This command:
1. Detects your OS (macOS / Linux / Windows)
2. Registers a Claude Code `SessionEnd` hook for instant cleanup
3. Sets up an hourly background scan as a safety net
4. Creates your config at `~/.zclean/config.json`

## How it works

**Layer 1 — SessionEnd Hook**
When a Claude Code session ends, `zclean` immediately cleans up that session's orphaned children. Fast and targeted.

**Layer 2 — Hourly Scheduler**
A lightweight background scan catches anything the hook missed: crash leftovers, Codex orphans, stale browser daemons, and processes from tools that don't support hooks.

Together, these two layers keep your system clean without you ever thinking about it.

## Safety

`zclean` follows one rule: **if the parent is alive, don't touch it.**

- Scans are **dry-run by default** — you see what would be cleaned before anything happens
- Only targets **known AI tool process patterns** (MCP servers, agent browsers, sub-agents, build zombies)
- **Whitelist support** — protect any process you want to keep
- **Skips** tmux/screen sessions, PM2/Forever daemons, Docker containers, VS Code children
- **Re-verifies** PID identity before every kill (prevents PID recycling accidents)
- Logs every action with full command line for manual recovery

Your `node server.js` running in a terminal tab? Untouched. Your `vite dev` in tmux? Untouched. Only true orphans from dead AI sessions get cleaned.

## Commands

| Command | Description |
|---------|-------------|
| `zclean` | Scan for zombies (dry-run, shows what would be cleaned) |
| `zclean --yes` | Scan and clean zombie processes |
| `zclean init` | Install SessionEnd hook + hourly scheduler |
| `zclean status` | Show protection status and cleanup history |
| `zclean logs` | View detailed cleanup log |
| `zclean config` | Show current configuration |
| `zclean uninstall` | Remove all hooks and schedulers |

## Configuration

`~/.zclean/config.json`:

```json
{
  "whitelist": [],
  "maxAge": "24h",
  "memoryThreshold": "500MB",
  "maxKillBatch": 20,
  "schedule": "hourly",
  "sigterm_timeout": 10,
  "dryRunDefault": true,
  "logRetention": "30d",
  "customAiDirs": []
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `whitelist` | `[]` | Process name patterns to never kill |
| `maxAge` | `"24h"` | Kill orphan `node`/`esbuild` only after this age |
| `memoryThreshold` | `"500MB"` | Flag orphans above this RAM usage regardless of age |
| `maxKillBatch` | `20` | Max processes to kill per invocation (safety limit) |
| `sigterm_timeout` | `10` | Seconds to wait after SIGTERM before SIGKILL |
| `dryRunDefault` | `true` | Manual `zclean` runs in dry-run mode |
| `customAiDirs` | `[]` | Additional AI tool directories to detect (e.g. `[".mytool"]`) |

## FAQ

### Will this kill my running Claude Code session?
No. `zclean` checks if the parent process is alive. Active sessions and their children are always protected.

### What about my `vite dev` / `next dev` server?
If you started it in a terminal, tmux, or VS Code — it has a living parent and won't be touched. Only orphaned dev servers (parent process dead for 24h+) are candidates.

### Does the hourly scheduler slow my machine?
No. It runs a single process scan (~60ms), cleans if needed, and exits. No persistent daemon.

### How do I stop zclean completely?
```bash
zclean uninstall
npm uninstall -g zclean
```

## Supported Tools

| Tool | Cleanup Coverage |
|------|-----------------|
| Claude Code | MCP servers, sub-agents (`--print`), sessions (`--session-id`), agent-browser, playwright |
| Codex | codex exec, codex-sandbox |
| Aider | orphaned aider/python processes |
| Gemini CLI | orphaned gemini processes |
| Build tools | esbuild, vite, webpack, next dev (AI tool paths only) |
| MCP servers | Any `mcp-server-*` pattern |
| Runtimes | node, tsx, ts-node, bun, deno (AI tool paths only) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Adding a new process pattern? Edit `src/detector/patterns.js` and open a PR.

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built by [whynowlab](https://github.com/whynowlab) — the team behind [Swing](https://github.com/whynowlab/swing-skills).

</div>

# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a vulnerability

zclean kills processes on your system. A bug in pattern matching or PID verification could terminate the wrong process. We take this seriously.

**Do not open a public issue for security vulnerabilities.**

Instead, email **security@thestack.ai** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Impact assessment (what could go wrong)
4. Suggested fix (if you have one)

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

Security-relevant areas of zclean:

- **Pattern matching** (`src/detector/patterns.js`) — a too-broad regex could match legitimate processes
- **PID verification** (`src/killer.js`) — the re-verify step before kill prevents PID recycling attacks
- **Process killing** (`src/killer.js`) — the SIGTERM/SIGKILL sequence
- **Whitelist bypass** (`src/detector/whitelist.js`) — failure to protect daemon-managed or tmux processes
- **Installer** (`src/installer/`) — writes to system scheduler configs (launchd, systemd, Task Scheduler)

## Design principles

- **Dry-run by default** — `zclean` without `--yes` never kills anything
- **Re-verify before kill** — every PID is checked for command line match and start time before SIGTERM
- **Batch limit** — max 20 kills per invocation to limit blast radius
- **Orphan-only** — most patterns only match processes whose parent is dead
- **AI-path gating** — generic tools (node, bun, deno) are only flagged when running from AI tool directories

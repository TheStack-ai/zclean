# zclean Install Brand And Custom Patterns Design

## Goals

- Make global installation and `zclean init` feel like one coherent developer product.
- Translate the existing hero motif, scattered runtime fragments resolving into a precise Z, into terminal-safe art.
- Close GitHub issue #3 without allowing arbitrary regular expressions to broaden cleanup unsafely.

## Visual Direction

The terminal surface follows a technical precision marque: monochrome structure, one cyan signal color, fixed-width alignment, hairline rules, and no gradients, glow, animation, emoji, or rounded decoration.

The mark uses a compact five-row `ZCLEAN` block wordmark. Sparse fragments appear only at the leading edge, echoing the current hero image without adding visual noise. ANSI color is progressive enhancement; `NO_COLOR` preserves the complete silhouette and layout.

### Postinstall

- Print the compact wordmark, installed version, command name, dry-run safety statement, and `zclean init` next action.
- Perform no filesystem writes, scheduler registration, network access, or telemetry.
- npm 7+ hides lifecycle output by default. The documented branded-install command therefore uses `--foreground-scripts`; ordinary installation remains valid but may hide the banner.

### Init

- Print the full mark once.
- Render a strict status rail for CONFIG, CLAUDE HOOK, and SCHEDULER.
- Use `READY`, `INSTALLED`, `ACTIVE`, `EXISTS`, and `WARNING` as aligned state labels.
- End with `zclean audit` and `zclean doctor`, plus an explicit `--yes` safety reminder.
- JSON commands never print the brand surface.

## Custom Pattern Safety

- Add `customPatterns` to the existing private config file.
- Accept one ephemeral literal through `--pattern=<text>` and merge it with configured literals for that scan.
- Treat values as case-insensitive literal substrings, never regular expressions.
- Reject empty, shorter-than-three-character, longer-than-eighty-character, non-string, control-character, and generic runtime-name values.
- Custom matches always require orphan status and the configured `maxAge` threshold. Existing multiplexer protection, whitelist checks, PID identity verification, batch limits, dry-run default, and explicit `--yes` cleanup remain unchanged.
- Report custom candidates with a stable `custom:<literal>` pattern name.

## Verification

- Red-first tests for wordmark output, postinstall safety, init status layout, custom matching, invalid values, and non-orphan protection.
- Full syntax, unit, smoke, and pack checks.
- Install the packed tarball into an isolated prefix with `--foreground-scripts` and observe the real banner.
- Run isolated `zclean init`, `zclean --pattern=...`, `zclean --help`, and invalid-pattern scenarios.

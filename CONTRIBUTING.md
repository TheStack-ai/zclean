# Contributing to zclean

Thanks for your interest in making AI coding tools less wasteful.

## Getting Started

```bash
git clone https://github.com/whynowlab/zclean.git
cd zclean
node bin/zclean.js --help
```

No `npm install` needed — zclean has zero dependencies.

**Requirements:** Node.js 18+

## Development

```bash
# Run a dry-run scan
node bin/zclean.js

# Run with cleanup
node bin/zclean.js --yes

# Check syntax of all files
for f in bin/zclean.js src/*.js src/**/*.js; do node -c "$f" 2>/dev/null && echo "OK: $f"; done
```

## Adding a New Process Pattern

If you've found an AI tool that leaves orphan processes, add it to `src/detector/patterns.js`:

```js
{
  name: 'your-tool-name',
  match: /your-process-pattern/,
  category: 'appropriate-category',
  minAge: 0,          // minimum age before considering as zombie
  description: 'What this process is and why it becomes a zombie'
}
```

Then open a PR with:
1. The pattern addition
2. A description of the tool and how it creates orphans
3. How you verified the pattern doesn't match legitimate processes

## Pull Request Guidelines

- **One feature per PR** — keep changes focused
- **No new dependencies** — this is a zero-dependency project by design
- **Cross-platform** — test on macOS and Linux at minimum. If you can't test Windows, note it
- **Safety first** — any change to kill logic must include reasoning about false positives

## Reporting Issues

When reporting a bug, please include:
- OS and version
- Node.js version (`node --version`)
- Output of `zclean status`
- The process that was incorrectly killed or missed (with `ps aux` output if possible)

## Code Style

- CommonJS modules (for CLI compatibility with Node.js 18)
- No external linters — keep it simple
- Comments for non-obvious logic, especially in `scanner.js` and `killer.js`
- Use `const` by default, `let` when mutation is needed

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

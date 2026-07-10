'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const LOCAL_BIN_HINT = 'Install zclean first with `npm install -g z-clean`, then run `zclean init` again.';

function resolveZcleanBin(options = {}) {
  const runtime = {
    execSync: options.execSync || execSync,
    existsSync: options.existsSync || fs.existsSync,
    homedir: options.homedir || os.homedir(),
    platform: options.platform || os.platform(),
    argv: options.argv || process.argv,
  };

  const current = currentExecutableCandidate(runtime);
  if (current) return current;

  for (const candidate of npmGlobalCandidates(runtime)) {
    if (runtime.existsSync(candidate)) return candidate;
  }

  for (const candidate of commonCandidates(runtime)) {
    if (runtime.existsSync(candidate)) return candidate;
  }

  return null;
}

function currentExecutableCandidate(runtime) {
  const current = runtime.argv && runtime.argv[1] ? path.resolve(runtime.argv[1]) : null;
  if (!current || isTransientNpxPath(current) || !runtime.existsSync(current)) return null;

  const base = path.basename(current).toLowerCase();
  if (base === 'zclean' || base === 'zclean.cmd' || base === 'zclean.js') return current;
  return null;
}

function npmGlobalCandidates(runtime) {
  const names = runtime.platform === 'win32' ? ['zclean.cmd', 'zclean'] : ['zclean'];
  const prefixes = [];

  try {
    const npmBin = runtime.execSync('npm bin -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (npmBin) prefixes.push(npmBin);
  } catch {}

  try {
    const npmPrefix = runtime.execSync('npm prefix -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (npmPrefix) {
      prefixes.push(runtime.platform === 'win32' ? npmPrefix : path.join(npmPrefix, 'bin'));
      prefixes.push(path.join(npmPrefix, 'node_modules', '.bin'));
    }
  } catch {}

  return unique(prefixes.flatMap((prefix) => names.map((name) => path.join(prefix, name))));
}

function commonCandidates(runtime) {
  if (runtime.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(runtime.homedir, 'AppData', 'Roaming');
    return [
      path.join(appData, 'npm', 'zclean.cmd'),
      path.join(runtime.homedir, 'AppData', 'Roaming', 'npm', 'zclean.cmd'),
    ];
  }

  return [
    path.join(runtime.homedir, '.local', 'bin', 'zclean'),
    path.join(runtime.homedir, 'node_modules', '.bin', 'zclean'),
    path.join(runtime.homedir, '.local', 'share', 'npm', 'bin', 'zclean'),
    '/opt/homebrew/bin/zclean',
    '/usr/local/bin/zclean',
    '/usr/bin/zclean',
  ];
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function quoteSystemdArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isTransientNpxPath(filePath) {
  return /[\\/]_npx[\\/]/.test(filePath);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  LOCAL_BIN_HINT,
  quoteShellArg,
  quoteSystemdArg,
  resolveZcleanBin,
};

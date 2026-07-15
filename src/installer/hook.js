'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeJsonAtomic } = require('./settings-write');

function inspectLegacyHook(options = {}) {
  const runtimeFs = options.fs || fs;
  const settingsPath = resolveSettingsPath(options);
  let source;

  try {
    if (!runtimeFs.existsSync(settingsPath)) {
      return result('absent', 'Optional Claude Code settings are not present.');
    }
    source = runtimeFs.readFileSync(settingsPath, 'utf8');
  } catch {
    return result('error', 'Optional Claude Code settings could not be inspected.');
  }

  let settings;
  try {
    settings = JSON.parse(source);
  } catch {
    return result('invalid', 'Optional Claude Code settings contain invalid JSON and were left unchanged.');
  }

  return countLegacyHooks(settings) > 0
    ? result('legacy', 'Legacy zclean Stop hook found.')
    : result('unchanged', 'No legacy zclean Stop hook found.');
}

function removeLegacyHook(options = {}) {
  const runtimeFs = options.fs || fs;
  const settingsPath = resolveSettingsPath(options);
  let source;

  try {
    if (!runtimeFs.existsSync(settingsPath)) {
      return result('absent', 'Optional Claude Code settings are not present.');
    }
    source = runtimeFs.readFileSync(settingsPath, 'utf8');
  } catch {
    return result('error', 'Optional Claude Code settings could not be inspected.');
  }

  let settings;
  try {
    settings = JSON.parse(source);
  } catch {
    return result('invalid', 'Optional Claude Code settings contain invalid JSON and were left unchanged.');
  }

  const updated = removeLegacyHooks(settings);
  if (!updated.changed) return result('unchanged', 'No legacy zclean Stop hook found.');

  const written = writeJsonAtomic(settingsPath, updated.settings, {
    expectedSource: source,
    fs: runtimeFs,
    tempName: options.tempName,
  });
  if (!written.ok) {
    return result('error', 'Legacy zclean Stop hook could not be removed; original settings were preserved.');
  }

  return result('removed', 'Legacy zclean Stop hook removed; no replacement hook was installed.');
}

function removeLegacyHooks(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { changed: false, settings };
  }
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    return { changed: false, settings };
  }
  if (!Array.isArray(settings.hooks.Stop)) return { changed: false, settings };

  const stop = [];
  let changed = false;

  for (const entry of settings.hooks.Stop) {
    if (isLegacyFlatEntry(entry)) {
      changed = true;
      continue;
    }
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) {
      stop.push(entry);
      continue;
    }

    const retained = entry.hooks.filter((subHook) => !isLegacyNestedHook(subHook));
    if (retained.length === entry.hooks.length) {
      stop.push(entry);
      continue;
    }

    changed = true;
    if (retained.length > 0) stop.push({ ...entry, hooks: retained });
  }

  if (!changed) return { changed: false, settings };

  const nextSettings = { ...settings, hooks: { ...settings.hooks } };
  if (stop.length > 0) nextSettings.hooks.Stop = stop;
  else delete nextSettings.hooks.Stop;
  if (Object.keys(nextSettings.hooks).length === 0) delete nextSettings.hooks;
  return { changed: true, settings: nextSettings };
}

function countLegacyHooks(settings) {
  const stop = settings && settings.hooks && settings.hooks.Stop;
  if (!Array.isArray(stop)) return 0;
  let count = 0;
  for (const entry of stop) {
    if (isLegacyFlatEntry(entry)) count += 1;
    if (entry && Array.isArray(entry.hooks)) {
      count += entry.hooks.filter(isLegacyNestedHook).length;
    }
  }
  return count;
}

function isLegacyFlatEntry(entry) {
  return Boolean(entry && typeof entry === 'object' && isLegacyHookCommand(entry.command));
}

function isLegacyNestedHook(hook) {
  return Boolean(
    hook
    && typeof hook === 'object'
    && hook.type === 'command'
    && isLegacyHookCommand(hook.command)
  );
}

function isLegacyHookCommand(command) {
  if (typeof command !== 'string') return false;
  const match = command.trim().match(/^(.+?) --yes --session-pid=\$PPID$/);
  if (!match) return false;
  const executable = unquoteShellToken(match[1]);
  if (!executable || /[\r\n]/.test(executable)) return false;

  const windowsAbsolute = path.win32.isAbsolute(executable);
  const posixAbsolute = path.posix.isAbsolute(executable);
  if (!windowsAbsolute && !posixAbsolute) return false;
  const basename = (windowsAbsolute ? path.win32.basename(executable) : path.posix.basename(executable)).toLowerCase();
  return basename === 'zclean' || basename === 'zclean.js' || basename === 'zclean.cmd';
}

function unquoteShellToken(value) {
  const token = String(value).trim();
  if (!token || /\s/.test(token) && !isQuoted(token)) return null;
  if (token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1).replace(/\\([\\"])/g, '$1');
  }
  return token;
}

function isQuoted(value) {
  return (value.startsWith("'") && value.endsWith("'"))
    || (value.startsWith('"') && value.endsWith('"'));
}

function resolveSettingsPath(options) {
  return options.settingsPath || path.join(options.homedir || os.homedir(), '.claude', 'settings.json');
}

function result(state, message) {
  return { state, message };
}

module.exports = {
  inspectLegacyHook,
  removeHook: removeLegacyHook,
  removeLegacyHook,
};

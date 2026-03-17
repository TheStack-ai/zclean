'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
// Use npx to ensure zclean is found regardless of global install status
const HOOK_COMMAND = 'npx --yes @thestackai/zclean --yes --session-pid=$PPID';
const HOOK_ID = 'zclean-session-cleanup';

/**
 * Install a Claude Code SessionEnd hook that runs zclean on session end.
 *
 * Claude Code hooks use a matcher + hooks array format:
 * {
 *   "hooks": {
 *     "Stop": [
 *       {
 *         "matcher": "",
 *         "hooks": [
 *           { "type": "command", "command": "..." }
 *         ]
 *       }
 *     ]
 *   }
 * }
 *
 * This is idempotent — won't duplicate if already registered.
 *
 * @returns {{ installed: boolean, message: string }}
 */
function installHook() {
  // Check if Claude Code settings directory exists
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    return {
      installed: false,
      message: `Claude Code config directory not found: ${claudeDir}`,
    };
  }

  // Load or create settings
  let settings = {};
  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
    } catch {
      return {
        installed: false,
        message: `Failed to parse ${CLAUDE_SETTINGS_PATH}. Please fix the JSON and retry.`,
      };
    }
  }

  // Ensure hooks structure
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];

  // Check if already installed (handle both old flat format and new matcher format)
  const existing = settings.hooks.Stop.find(
    (h) =>
      h.id === HOOK_ID ||
      (h.command && h.command.includes('zclean')) ||
      (Array.isArray(h.hooks) && h.hooks.some((sub) => sub.command && sub.command.includes('zclean')))
  );
  if (existing) {
    return {
      installed: true,
      message: 'Hook already registered in Claude Code settings.',
    };
  }

  // Add hook using the matcher + hooks array format required by Claude Code
  settings.hooks.Stop.push({
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: HOOK_COMMAND,
      },
    ],
  });

  // Write back
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  return {
    installed: true,
    message: `Hook registered: ${CLAUDE_SETTINGS_PATH}`,
  };
}

/**
 * Remove the zclean hook from Claude Code settings.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeHook() {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    return { removed: false, message: 'Claude Code settings not found.' };
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
  } catch {
    return { removed: false, message: 'Failed to parse settings.' };
  }

  if (!settings.hooks || !Array.isArray(settings.hooks.Stop)) {
    return { removed: false, message: 'No hooks found.' };
  }

  const before = settings.hooks.Stop.length;
  settings.hooks.Stop = settings.hooks.Stop.filter(
    (h) =>
      h.id !== HOOK_ID &&
      !(h.command && h.command.includes('zclean')) &&
      !(Array.isArray(h.hooks) && h.hooks.some((sub) => sub.command && sub.command.includes('zclean')))
  );

  if (settings.hooks.Stop.length === before) {
    return { removed: false, message: 'Hook was not registered.' };
  }

  // Clean up empty structures
  if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  return { removed: true, message: 'Hook removed from Claude Code settings.' };
}

module.exports = { installHook, removeHook };

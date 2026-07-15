'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { LOCAL_BIN_HINT, quoteSystemdArg, resolveZcleanBin } = require('./bin-path');
const { writeFileAtomic } = require('./settings-write');
const { systemdShowArgs } = require('../systemd-contract');

const SYSTEMD_USER_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_NAME = 'zclean';
const SERVICE_PATH = path.join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.service`);
const TIMER_PATH = path.join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.timer`);

/**
 * Generate the systemd service unit file.
 */
function generateService(binPath) {
  return `[Unit]
Description=zclean - AI coding tool zombie process cleaner
Documentation=https://github.com/TheStack-ai/zclean

[Service]
Type=oneshot
ExecStart=${quoteSystemdArg(binPath)} audit --json
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin
StandardOutput=append:%h/.zclean/systemd.log
StandardError=append:%h/.zclean/systemd.log
`;
}

/**
 * Generate the systemd timer unit file.
 */
function generateTimer() {
  return `[Unit]
Description=Run zclean hourly
Documentation=https://github.com/TheStack-ai/zclean

[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
`;
}

/**
 * Install the systemd user timer.
 *
 * @returns {{ installed: boolean, message: string }}
 */
function installSystemd(options = {}) {
  const platform = options.platform || os.platform();
  const servicePath = options.servicePath || SERVICE_PATH;
  const timerPath = options.timerPath || TIMER_PATH;
  const trustedRoot = options.homedir
    || (options.servicePath || options.timerPath ? path.dirname(servicePath) : os.homedir());
  const run = options.execFileSync || execFileSync;
  if (platform !== 'linux') {
    return { installed: false, message: 'systemd is Linux only.' };
  }

  const binPath = options.binPath || resolveZcleanBin();
  if (!binPath) {
    return { installed: false, message: `Local zclean executable not found. ${LOCAL_BIN_HINT}` };
  }

  let stopFailed = false;
  try {
    stopExistingTimer(run);
  } catch {
    stopFailed = true;
  }

  const service = generateService(binPath);
  const timer = generateTimer();
  try {
    const serviceWritten = writeFileAtomic(servicePath, service, { mode: 0o644, trustedRoot });
    if (!serviceWritten.ok) throw serviceWritten.error;
    const timerWritten = writeFileAtomic(timerPath, timer, { mode: 0o644, trustedRoot });
    if (!timerWritten.ok) throw timerWritten.error;
  } catch {
    return {
      installed: false,
      active: false,
      message: stopFailed
        ? 'Could not stop the existing systemd timer, and report-only files could not be written; a previous destructive command may still be active.'
        : 'The old timer was stopped, but the report-only systemd files could not be written.',
    };
  }

  try {
    run('systemctl', ['--user', 'daemon-reload'], systemctlOptions());
    run('systemctl', ['--user', 'enable', '--now', `${SERVICE_NAME}.timer`], systemctlOptions());
  } catch {
    return {
      installed: false,
      active: false,
      message: stopFailed
        ? 'Could not stop the existing systemd timer, and systemctl could not activate the report-only replacement; a previous destructive command may still be active.'
        : `Report-only files were written, but systemctl could not activate them. Try manually: systemctl --user enable --now ${SERVICE_NAME}.timer`,
    };
  }

  let loadedCommand;
  try {
    loadedCommand = run(
      'systemctl',
      systemdShowArgs(`${SERVICE_NAME}.service`),
      systemctlOptions()
    );
  } catch {}
  if (!isExpectedLoadedCommand(loadedCommand, binPath)) {
    return {
      installed: false,
      active: false,
      message: stopFailed
        ? 'Report-only files were replaced after the existing timer could not be stopped, but the loaded command could not be verified and a previous destructive command may still be active.'
        : 'Report-only files were enabled, but the loaded command could not be verified as audit --json.',
    };
  }

  const messages = [];
  if (stopFailed) {
    messages.push('The initial systemd timer stop failed; its files were replaced in place and the loaded audit --json command was verified.');
  }
  messages.push(`Timer installed and enabled: ${timerPath}`);

  // Check linger
  try {
    const lingerDir = `/var/lib/systemd/linger/${os.userInfo().username}`;
    if (!fs.existsSync(lingerDir)) {
      messages.push(`Note: enable linger for timer to run without login: loginctl enable-linger ${os.userInfo().username}`);
    }
  } catch {
    messages.push(`Note: run 'loginctl enable-linger' to ensure timer runs without login session.`);
  }

  return {
    installed: true,
    active: true,
    message: messages.join('\n'),
  };
}

function isExpectedLoadedCommand(value, binPath) {
  const actions = [...String(value || '').matchAll(/argv\[\]=([^;\r\n]+)(?:;|$)/gi)];
  if (actions.length !== 1) return false;
  const command = actions[0][1].trim();
  return command === `${binPath} audit --json` || command === `"${binPath}" audit --json`;
}

function stopExistingTimer(run) {
  try {
    run('systemctl', ['--user', 'disable', '--now', `${SERVICE_NAME}.timer`], systemctlOptions());
  } catch (error) {
    if (!isSystemdUnitMissing(error)) throw error;
  }
}

/**
 * Remove the systemd user timer and service.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeSystemd(options = {}) {
  const platform = options.platform || os.platform();
  const servicePath = options.servicePath || SERVICE_PATH;
  const timerPath = options.timerPath || TIMER_PATH;
  const run = options.execFileSync || execFileSync;
  if (platform !== 'linux') {
    return { removed: false, failed: false, message: 'systemd is Linux only.' };
  }

  const hasFiles = fs.existsSync(servicePath) || fs.existsSync(timerPath);
  try {
    run('systemctl', ['--user', 'disable', '--now', `${SERVICE_NAME}.timer`], systemctlOptions());
  } catch (err) {
    if (!hasFiles && isSystemdUnitMissing(err)) {
      return { removed: false, failed: false, message: 'Files and timer not found. Already uninstalled.' };
    }
    return {
      removed: false,
      failed: true,
      message: 'Could not disable systemd timer; unit files preserved for a later retry.',
    };
  }

  for (const filepath of [servicePath, timerPath]) {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }

  try {
    run('systemctl', ['--user', 'daemon-reload'], systemctlOptions());
  } catch {
    return { removed: true, failed: true, message: 'Timer disabled, but systemd daemon-reload failed.' };
  }

  return {
    removed: true,
    failed: false,
    message: 'systemd timer and service removed.',
  };
}

function systemctlOptions() {
  return { encoding: 'utf-8', timeout: 5000 };
}

function isSystemdUnitMissing(err) {
  const output = `${err?.message || ''}\n${String(err?.stdout || '')}\n${String(err?.stderr || '')}`;
  return /unit .* (?:does not exist|not found|could not be found)/i.test(output);
}

module.exports = {
  installSystemd,
  removeSystemd,
  generateService,
  generateTimer,
  resolveZcleanBin,
  SERVICE_PATH,
  TIMER_PATH,
};

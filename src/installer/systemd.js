'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { LOCAL_BIN_HINT, quoteSystemdArg, resolveZcleanBin } = require('./bin-path');

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
  const run = options.execFileSync || execFileSync;
  if (platform !== 'linux') {
    return { installed: false, message: 'systemd is Linux only.' };
  }

  const binPath = options.binPath || resolveZcleanBin();
  if (!binPath) {
    return { installed: false, message: `Local zclean executable not found. ${LOCAL_BIN_HINT}` };
  }

  try {
    stopExistingTimer(run);
  } catch {
    return {
      installed: false,
      active: false,
      message: 'Could not stop the existing systemd timer; unit files were preserved for a later retry.',
    };
  }

  try {
    fs.mkdirSync(path.dirname(servicePath), { recursive: true });
    fs.mkdirSync(path.dirname(timerPath), { recursive: true });
    fs.writeFileSync(servicePath, generateService(binPath), 'utf-8');
    fs.writeFileSync(timerPath, generateTimer(), 'utf-8');
  } catch {
    return {
      installed: false,
      active: false,
      message: 'The old timer was stopped, but the report-only systemd files could not be written.',
    };
  }

  const messages = [];
  let active = true;
  try {
    run('systemctl', ['--user', 'daemon-reload'], systemctlOptions());
    run('systemctl', ['--user', 'enable', '--now', `${SERVICE_NAME}.timer`], systemctlOptions());
    messages.push(`Timer installed and enabled: ${timerPath}`);
  } catch {
    active = false;
    messages.push('Report-only files were written, but systemctl could not activate them.');
    messages.push(`Try manually: systemctl --user enable --now ${SERVICE_NAME}.timer`);
  }

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
    active,
    message: messages.join('\n'),
  };
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

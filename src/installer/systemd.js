'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SYSTEMD_USER_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_NAME = 'zclean';
const SERVICE_PATH = path.join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.service`);
const TIMER_PATH = path.join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.timer`);

/**
 * Resolve the full path to the zclean binary.
 */
function resolveZcleanBin() {
  try {
    const npmBin = execSync('npm bin -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    const globalPath = path.join(npmBin, 'zclean');
    if (fs.existsSync(globalPath)) return globalPath;
  } catch { /* ignore */ }

  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'zclean'),
    '/usr/local/bin/zclean',
    path.join(os.homedir(), '.local', 'share', 'npm', 'bin', 'zclean'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.join(os.homedir(), '.local', 'bin', 'zclean');
}

/**
 * Generate the systemd service unit file.
 */
function generateService(binPath) {
  return `[Unit]
Description=zclean - AI coding tool zombie process cleaner
Documentation=https://github.com/whynowlab/zclean

[Service]
Type=oneshot
ExecStart=${binPath} --yes
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
Documentation=https://github.com/whynowlab/zclean

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
function installSystemd() {
  if (os.platform() !== 'linux') {
    return { installed: false, message: 'systemd is Linux only.' };
  }

  // Ensure systemd user directory exists
  if (!fs.existsSync(SYSTEMD_USER_DIR)) {
    fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  }

  const binPath = resolveZcleanBin();

  // Write service and timer files
  fs.writeFileSync(SERVICE_PATH, generateService(binPath), 'utf-8');
  fs.writeFileSync(TIMER_PATH, generateTimer(), 'utf-8');

  // Reload and enable
  const messages = [];
  try {
    execSync('systemctl --user daemon-reload', { encoding: 'utf-8', timeout: 5000 });
    execSync(`systemctl --user enable --now ${SERVICE_NAME}.timer`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    messages.push(`Timer installed and enabled: ${TIMER_PATH}`);
  } catch (err) {
    messages.push(`Files written but systemctl failed: ${err.message}`);
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
    message: messages.join('\n'),
  };
}

/**
 * Remove the systemd user timer and service.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeSystemd() {
  if (os.platform() !== 'linux') {
    return { removed: false, message: 'systemd is Linux only.' };
  }

  // Disable timer
  try {
    execSync(`systemctl --user disable --now ${SERVICE_NAME}.timer`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    // Might not be running
  }

  // Remove files
  let removed = false;
  for (const filepath of [SERVICE_PATH, TIMER_PATH]) {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      removed = true;
    }
  }

  // Reload daemon
  try {
    execSync('systemctl --user daemon-reload', { encoding: 'utf-8', timeout: 5000 });
  } catch { /* ignore */ }

  return {
    removed,
    message: removed ? 'systemd timer and service removed.' : 'Files not found. Already uninstalled.',
  };
}

module.exports = { installSystemd, removeSystemd, SERVICE_PATH, TIMER_PATH };

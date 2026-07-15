'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { LOCAL_BIN_HINT, resolveZcleanBin } = require('./bin-path');
const { writeFileAtomic } = require('./settings-write');

const PLIST_NAME = 'com.zclean.hourly';
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(PLIST_DIR, `${PLIST_NAME}.plist`);

/**
 * Resolve the active nvm node bin path, if nvm is installed.
 * Returns the path or null.
 */
function resolveNvmNodeBin(options = {}) {
  const homeDir = options.homedir || os.homedir();
  const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
  try {
    if (!fs.existsSync(nvmDir)) return null;
    // Use the currently running node's path if it's under .nvm
    const nodeBin = process.execPath;
    if (nodeBin.includes('.nvm')) {
      return path.dirname(nodeBin);
    }
    // Fallback: find the default version directory
    const versions = fs.readdirSync(nvmDir).filter((d) => d.startsWith('v')).sort().reverse();
    if (versions.length > 0) {
      return path.join(nvmDir, versions[0], 'bin');
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Generate the launchd plist XML.
 */
function generatePlist(binPath, options = {}) {
  const homeDir = options.homedir || os.homedir();
  const programArgs = [binPath, 'audit', '--json']
    .map((arg) => `      <string>${escapeXml(arg)}</string>`)
    .join('\n');

  // Build PATH with nvm node bin if available
  const pathParts = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
    path.join(homeDir, '.local', 'bin'),
  ];
  const nvmBin = resolveNvmNodeBin({ homedir: homeDir });
  if (nvmBin) {
    pathParts.push(nvmBin);
  }
  const envPath = pathParts.join(':');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>

    <key>StartInterval</key>
    <integer>3600</integer>

    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>${escapeXml(path.join(homeDir, '.zclean', 'launchd.log'))}</string>

    <key>StandardErrorPath</key>
    <string>${escapeXml(path.join(homeDir, '.zclean', 'launchd.log'))}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escapeXml(envPath)}</string>
    </dict>
</dict>
</plist>
`;
}

/**
 * Install the launchd agent.
 *
 * @returns {{ installed: boolean, message: string }}
 */
function installLaunchd(options = {}) {
  const runtimePlatform = options.platform || os.platform();
  if (runtimePlatform !== 'darwin') {
    return { installed: false, message: 'launchd is macOS only.' };
  }

  const homeDir = options.homedir || os.homedir();
  const plistPath = options.plistPath || path.join(homeDir, 'Library', 'LaunchAgents', `${PLIST_NAME}.plist`);
  const plistDir = path.dirname(plistPath);
  const uid = options.uid ?? process.getuid?.();
  const run = options.execFileSync || execFileSync;
  const binPath = options.binPath || resolveZcleanBin();
  if (!binPath) {
    return { installed: false, message: `Local zclean executable not found. ${LOCAL_BIN_HINT}` };
  }

  if (!fs.existsSync(plistDir)) {
    fs.mkdirSync(plistDir, { recursive: true });
  }

  if (!stopExistingLaunchd(run, uid, plistPath)) {
    return {
      installed: false,
      active: false,
      message: 'Existing launchd job could not be stopped; its plist was preserved.',
    };
  }

  const plist = generatePlist(binPath, { homedir: homeDir });
  const written = writeFileAtomic(plistPath, plist, { mode: 0o644 });
  if (!written.ok) {
    return {
      installed: false,
      active: false,
      message: 'The launchd plist could not be written safely; its destination was preserved.',
    };
  }

  try {
    run('launchctl', ['bootstrap', `gui/${uid}`, plistPath], launchctlOptions());
  } catch (err) {
    return {
      installed: true,
      active: false,
      message: `Plist written to ${plistPath} but launchctl load failed: ${err.message}. Try: launchctl bootstrap gui/$(id -u) ${plistPath}`,
    };
  }

  return {
    installed: true,
    active: true,
    message: `Hourly launchd agent installed: ${plistPath}`,
  };
}

function stopExistingLaunchd(run, uid, plistPath) {
  try {
    run('launchctl', ['bootout', `gui/${uid}/${PLIST_NAME}`], launchctlOptions());
    return true;
  } catch {}

  if (fs.existsSync(plistPath)) {
    try {
      run('launchctl', ['bootout', `gui/${uid}`, plistPath], launchctlOptions());
      return true;
    } catch {}
  }

  try {
    run('launchctl', ['print', `gui/${uid}/${PLIST_NAME}`], launchctlOptions());
    return false;
  } catch (error) {
    return isLaunchdServiceMissing(error);
  }
}

/**
 * Remove the launchd agent.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeLaunchd(options = {}) {
  const platform = options.platform || os.platform();
  const plistPath = options.plistPath || PLIST_PATH;
  const uid = options.uid ?? process.getuid?.();
  const run = options.execFileSync || execFileSync;

  if (platform !== 'darwin') {
    return { removed: false, failed: false, message: 'launchd is macOS only.' };
  }

  const hasPlist = fs.existsSync(plistPath);
  let unloaded = false;
  let serviceRemoved = false;
  let stateUnknown = false;
  try {
    run('launchctl', ['bootout', `gui/${uid}/${PLIST_NAME}`], launchctlOptions());
    unloaded = true;
    serviceRemoved = true;
  } catch {
    if (hasPlist) {
      try {
        run('launchctl', ['bootout', `gui/${uid}`, plistPath], launchctlOptions());
        unloaded = true;
        serviceRemoved = true;
      } catch {}
    }
  }

  if (!unloaded) {
    try {
      run('launchctl', ['print', `gui/${uid}/${PLIST_NAME}`], launchctlOptions());
    } catch (err) {
      if (isLaunchdServiceMissing(err)) {
        unloaded = true;
      } else {
        stateUnknown = true;
      }
    }
  }

  if (!unloaded) {
    return {
      removed: false,
      failed: true,
      message: stateUnknown
        ? 'Could not verify launchd service removal; plist preserved when present.'
        : 'launchd agent is still loaded; plist preserved for a later retry.',
    };
  }

  if (hasPlist) fs.unlinkSync(plistPath);
  if (!hasPlist && !serviceRemoved) {
    return { removed: false, failed: false, message: 'Plist and launchd service not found. Already uninstalled.' };
  }

  return {
    removed: true,
    failed: false,
    message: hasPlist
      ? `launchd agent removed: ${plistPath}`
      : 'launchd service removed; plist was already absent.',
  };
}

function launchctlOptions() {
  return { encoding: 'utf-8', timeout: 5000 };
}

function isLaunchdServiceMissing(err) {
  const output = `${err?.message || ''}\n${String(err?.stdout || '')}\n${String(err?.stderr || '')}`;
  return /could not find service|service not found|no such process/i.test(output);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  installLaunchd,
  removeLaunchd,
  generatePlist,
  resolveZcleanBin,
  PLIST_PATH,
};

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync } = require('child_process');
const { LOCAL_BIN_HINT, resolveZcleanBin } = require('./bin-path');

const PLIST_NAME = 'com.zclean.hourly';
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(PLIST_DIR, `${PLIST_NAME}.plist`);

/**
 * Resolve the active nvm node bin path, if nvm is installed.
 * Returns the path or null.
 */
function resolveNvmNodeBin() {
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
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
function generatePlist(binPath) {
  const programArgs = [binPath, '--yes']
    .map((arg) => `      <string>${escapeXml(arg)}</string>`)
    .join('\n');

  // Build PATH with nvm node bin if available
  const pathParts = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.local', 'bin'),
  ];
  const nvmBin = resolveNvmNodeBin();
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
    <string>${path.join(os.homedir(), '.zclean', 'launchd.log')}</string>

    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.zclean', 'launchd.log')}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${envPath}</string>
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
function installLaunchd() {
  if (os.platform() !== 'darwin') {
    return { installed: false, message: 'launchd is macOS only.' };
  }

  const binPath = resolveZcleanBin();
  if (!binPath) {
    return { installed: false, message: `Local zclean executable not found. ${LOCAL_BIN_HINT}` };
  }

  // Ensure LaunchAgents directory exists
  if (!fs.existsSync(PLIST_DIR)) {
    fs.mkdirSync(PLIST_DIR, { recursive: true });
  }

  const plist = generatePlist(binPath);

  // Unload existing if present
  if (fs.existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl bootout gui/${process.getuid()} ${PLIST_PATH}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      // Might not be loaded
    }
  }

  // Write plist
  fs.writeFileSync(PLIST_PATH, plist, 'utf-8');

  // Load
  try {
    execSync(`launchctl bootstrap gui/${process.getuid()} ${PLIST_PATH}`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch (err) {
    return {
      installed: true,
      active: false,
      message: `Plist written to ${PLIST_PATH} but launchctl load failed: ${err.message}. Try: launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`,
    };
  }

  return {
    installed: true,
    active: true,
    message: `Hourly launchd agent installed: ${PLIST_PATH}`,
  };
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

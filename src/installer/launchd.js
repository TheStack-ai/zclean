'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PLIST_NAME = 'com.zclean.hourly';
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(PLIST_DIR, `${PLIST_NAME}.plist`);

/**
 * Resolve the full path to the zclean binary.
 * Tries: npx global, npm global, local install.
 */
function resolveZcleanBin() {
  // If installed globally via npm
  try {
    const npmBin = execSync('npm bin -g', { encoding: 'utf-8', timeout: 5000 }).trim();
    const globalPath = path.join(npmBin, 'zclean');
    if (fs.existsSync(globalPath)) return globalPath;
  } catch { /* ignore */ }

  // Check common locations
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'zclean'),
    '/usr/local/bin/zclean',
    path.join(os.homedir(), 'node_modules', '.bin', 'zclean'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback to npx
  return 'npx zclean';
}

/**
 * Generate the launchd plist XML.
 */
function generatePlist(binPath) {
  const parts = binPath.split(' ');
  const programArgs = parts
    .concat(['--yes'])
    .map((arg) => `      <string>${arg}</string>`)
    .join('\n');

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
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${path.join(os.homedir(), '.local', 'bin')}</string>
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

  // Ensure LaunchAgents directory exists
  if (!fs.existsSync(PLIST_DIR)) {
    fs.mkdirSync(PLIST_DIR, { recursive: true });
  }

  const binPath = resolveZcleanBin();
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
      message: `Plist written to ${PLIST_PATH} but launchctl load failed: ${err.message}. Try: launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`,
    };
  }

  return {
    installed: true,
    message: `Hourly launchd agent installed: ${PLIST_PATH}`,
  };
}

/**
 * Remove the launchd agent.
 *
 * @returns {{ removed: boolean, message: string }}
 */
function removeLaunchd() {
  if (os.platform() !== 'darwin') {
    return { removed: false, message: 'launchd is macOS only.' };
  }

  if (!fs.existsSync(PLIST_PATH)) {
    return { removed: false, message: 'Plist not found. Already uninstalled.' };
  }

  try {
    execSync(`launchctl bootout gui/${process.getuid()} ${PLIST_PATH}`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    // Might not be loaded
  }

  fs.unlinkSync(PLIST_PATH);

  return {
    removed: true,
    message: `launchd agent removed: ${PLIST_PATH}`,
  };
}

module.exports = { installLaunchd, removeLaunchd, PLIST_PATH };

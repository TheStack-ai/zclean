## ADDED Requirements

### Requirement: Kill rate limiting
The system SHALL limit the number of processes killed in a single invocation to prevent system instability.

#### Scenario: Under batch limit
- **WHEN** 15 zombies are found and `maxKillBatch` is 20
- **THEN** all 15 SHALL be killed normally

#### Scenario: Over batch limit
- **WHEN** 30 zombies are found and `maxKillBatch` is 20
- **THEN** only the first 20 SHALL be killed
- **THEN** a warning message SHALL be displayed: "Found 30 zombies, killed 20. Run again for remaining."

#### Scenario: Custom batch limit
- **WHEN** user sets `maxKillBatch: 5` in config
- **THEN** at most 5 processes SHALL be killed per invocation

#### Scenario: Default batch limit
- **WHEN** `maxKillBatch` is not set in config
- **THEN** the default value of 20 SHALL be used

### Requirement: No spin wait during kill
The system SHALL NOT use CPU-busy spin loops while waiting for process termination.

#### Scenario: SIGTERM wait
- **WHEN** a SIGTERM is sent and the system waits for process exit
- **THEN** the wait SHALL use a blocking sleep mechanism (e.g., `execSync('sleep 0.5')`)
- **THEN** CPU usage during the wait period SHALL be near zero

#### Scenario: Kill timeout
- **WHEN** a process does not exit within `sigterm_timeout` seconds after SIGTERM
- **THEN** SIGKILL SHALL be sent (existing behavior, unchanged)

### Requirement: launchd plist absolute path
The `installLaunchd()` function SHALL use an absolute path to the zclean binary in the generated plist, not `npx`.

#### Scenario: Global npm install
- **WHEN** zclean is installed globally via npm
- **THEN** the plist SHALL use the resolved absolute path (e.g., `/opt/homebrew/bin/zclean`)

#### Scenario: npx fallback
- **WHEN** zclean is not found at any known location
- **THEN** the plist SHALL use `npx zclean` as fallback
- **THEN** the PATH environment in the plist SHALL include `/opt/homebrew/bin` and `~/.local/bin`

#### Scenario: Existing resolveZcleanBin function
- **WHEN** `installLaunchd()` generates the plist
- **THEN** it SHALL call `resolveZcleanBin()` to determine the binary path (function already exists)

### Requirement: maxKillBatch in default config
The `DEFAULT_CONFIG` object SHALL include `maxKillBatch: 20`.

#### Scenario: Fresh install config
- **WHEN** a user runs `zclean init` for the first time
- **THEN** `~/.zclean/config.json` SHALL include `"maxKillBatch": 20`

#### Scenario: Existing config merge
- **WHEN** a user has an existing config without `maxKillBatch`
- **THEN** `loadConfig()` SHALL return the merged config with `maxKillBatch: 20` from defaults

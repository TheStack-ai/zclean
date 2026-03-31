## ADDED Requirements

### Requirement: AI_TOOL_DIRS centralized pattern
The system SHALL maintain a centralized array of AI tool directory names used across all pattern matching.

#### Scenario: Directory list contents
- **WHEN** AI_TOOL_DIRS is referenced
- **THEN** it SHALL contain at minimum: `.claude`, `.cursor`, `.windsurf`, `.continue`, `.cline`, `.roo`, `.kilocode`, `.augment`, `.codex`, `.copilot`, `.aider`, `.gemini`, `.trae`, `.goose`

#### Scenario: Regex generation
- **WHEN** AI_DIR_REGEX is built from AI_TOOL_DIRS
- **THEN** it SHALL match any command line containing `{dir}/` or `{dir}\` for each directory
- **THEN** dots in directory names SHALL be properly escaped in the regex

### Requirement: Extended AI tool process patterns
The system SHALL detect zombie processes from all major AI coding tools.

#### Scenario: Claude Code session zombie
- **WHEN** a process command matches `claude --session-id`
- **THEN** pattern `claude-session` SHALL match with `orphanOnly: true`

#### Scenario: Claude Code subagent
- **WHEN** a process command matches `claude --print` or `claude\s+--print`
- **THEN** pattern `claude-subagent` SHALL match (existing, unchanged)

#### Scenario: Codex sandbox process
- **WHEN** a process command matches `codex-sandbox` or runs in a codex namespace
- **THEN** pattern `codex-sandbox` SHALL match with `orphanOnly: true`

#### Scenario: Cursor child process
- **WHEN** a process command contains `.cursor/` or `.cursor\`
- **THEN** pattern `node-ai-path` SHALL match via AI_DIR_REGEX

#### Scenario: Windsurf child process
- **WHEN** a process command contains `.windsurf/` or `.windsurf\`
- **THEN** pattern `node-ai-path` SHALL match via AI_DIR_REGEX

#### Scenario: Aider process
- **WHEN** a process command matches `python.*aider` or `aider`
- **THEN** pattern `aider` SHALL match with `orphanOnly: true`

#### Scenario: Gemini CLI process
- **WHEN** a process command matches `gemini` CLI invocation
- **THEN** pattern `gemini-cli` SHALL match with `orphanOnly: true`

### Requirement: AI path filter for generic patterns
The system SHALL prevent false positives from generic tool patterns by requiring AI tool path context.

#### Scenario: tsx with AI path
- **WHEN** a process command matches `/\btsx\b/` AND contains an AI_TOOL_DIRS path
- **THEN** the process SHALL be flagged as a zombie candidate

#### Scenario: tsx without AI path
- **WHEN** a process command matches `/\btsx\b/` but does NOT contain any AI_TOOL_DIRS path
- **THEN** the process SHALL NOT be flagged (skip)

#### Scenario: npx with AI path
- **WHEN** a process command matches `npm exec` or `npx` AND contains an AI_TOOL_DIRS path
- **THEN** the process SHALL be flagged

#### Scenario: npx without AI path
- **WHEN** a process command matches `npm exec` or `npx` but does NOT contain any AI_TOOL_DIRS path
- **THEN** the process SHALL NOT be flagged

#### Scenario: Build tools with AI path
- **WHEN** a process matching `vite`, `esbuild`, `webpack`, or `next dev` contains an AI_TOOL_DIRS path
- **THEN** the process SHALL be flagged with existing `maxOrphanAge: '24h'`

#### Scenario: Build tools without AI path
- **WHEN** a process matching build tool patterns does NOT contain any AI_TOOL_DIRS path
- **THEN** the process SHALL NOT be flagged

### Requirement: aiPathRequired pattern flag
Each pattern in the PATTERNS array MAY have an `aiPathRequired: boolean` field. When `true`, the scanner SHALL skip the process if its command line does not match AI_DIR_REGEX.

#### Scenario: Pattern with aiPathRequired=true and no AI path
- **WHEN** a process matches a pattern where `aiPathRequired === true`
- **AND** the process command does not match AI_DIR_REGEX
- **THEN** the process SHALL be skipped

#### Scenario: Pattern without aiPathRequired
- **WHEN** a process matches a pattern where `aiPathRequired` is undefined or false
- **THEN** AI path filtering SHALL NOT be applied (existing behavior)

### Requirement: User-extensible AI tool directories
The system SHALL allow users to add custom AI tool directories via config.

#### Scenario: Custom directories in config
- **WHEN** `config.customAiDirs` contains `[".mytool", ".custom-ai"]`
- **THEN** these directories SHALL be merged with the built-in AI_TOOL_DIRS
- **THEN** AI_DIR_REGEX SHALL include these custom directories

## ADDED Requirements

### Requirement: Single-call process collection
The system SHALL collect all process information with exactly ONE `ps` (Unix) or `wmic` (Windows) call per scan. No additional `execSync` calls SHALL be made for orphan detection, ancestor traversal, or whitelist checks.

#### Scenario: Unix process collection
- **WHEN** `ProcessTree.build()` is called on macOS or Linux
- **THEN** exactly one `execSync('ps -eo pid=,ppid=,rss=,etime=,lstart=,command=')` call is made
- **THEN** the result is parsed into an array of `{pid, ppid, cmd, rss, age, startTime}` objects

#### Scenario: Windows process collection
- **WHEN** `ProcessTree.build()` is called on Windows
- **THEN** exactly one `execSync('wmic process get ...')` call is made
- **THEN** the result is parsed into the same object format as Unix

#### Scenario: Own process exclusion
- **WHEN** process list is built
- **THEN** the current process (`process.pid`) SHALL be excluded from the tree

### Requirement: In-memory tree structure
The system SHALL build a tree structure in memory with O(1) lookup by PID and O(depth) ancestor traversal.

#### Scenario: Tree construction
- **WHEN** ProcessTree is constructed from a process list
- **THEN** a `Map<pid, processInfo>` is created for O(1) PID lookup
- **THEN** a `Map<pid, childPids[]>` is created for parent→children traversal

#### Scenario: Process lookup
- **WHEN** `tree.get(pid)` is called with a valid PID
- **THEN** the full process info object is returned in O(1) time

#### Scenario: Unknown PID lookup
- **WHEN** `tree.get(pid)` is called with a PID not in the tree
- **THEN** `null` is returned

### Requirement: Orphan detection via tree
The system SHALL determine orphan status by checking PPID against the tree, without any `execSync` call.

#### Scenario: macOS orphan (PPID=1)
- **WHEN** `tree.isOrphan(pid)` is called and the process has `ppid === 1`
- **THEN** `{isOrphan: true, ppid: 1, reason: 'reparented-to-launchd'}` is returned

#### Scenario: Linux orphan (PPID=1)
- **WHEN** `tree.isOrphan(pid)` is called on Linux and the process has `ppid === 1`
- **THEN** `{isOrphan: true, ppid: 1, reason: 'reparented-to-init'}` is returned

#### Scenario: Linux systemd --user orphan
- **WHEN** `tree.isOrphan(pid)` is called and the parent's command is `systemd`
- **THEN** `{isOrphan: true, ppid, reason: 'reparented-to-systemd-user'}` is returned

#### Scenario: Process with living parent
- **WHEN** `tree.isOrphan(pid)` is called and the parent PID exists in the tree and is not PID 1
- **THEN** `{isOrphan: false, ppid, reason: 'has-parent'}` is returned

### Requirement: Ancestor traversal via tree
The system SHALL provide ancestor chain traversal entirely in-memory.

#### Scenario: hasAncestorMatching
- **WHEN** `tree.hasAncestorMatching(pid, testFn)` is called
- **THEN** the tree walks up the parent chain in-memory
- **THEN** returns `true` if any ancestor matches `testFn(processInfo)`
- **THEN** stops at PID 1 or when the parent is not in the tree

#### Scenario: Cycle protection
- **WHEN** ancestor traversal encounters a PID already visited
- **THEN** traversal stops to prevent infinite loops

### Requirement: tmux/screen detection via tree
The system SHALL detect tmux/screen ancestors using the in-memory tree, with orphan exemption.

#### Scenario: Non-orphan in tmux
- **WHEN** a process is NOT orphaned and has a tmux/screen ancestor in the tree
- **THEN** the process is considered to be in a terminal multiplexer (protected)

#### Scenario: Orphan formerly in tmux
- **WHEN** a process IS orphaned (PPID=1) and the tree shows no tmux/screen ancestor (since reparented)
- **THEN** the process is NOT protected by terminal multiplexer check

#### Scenario: Orphan with tmux still in ancestor chain
- **WHEN** a process IS orphaned (PPID=1)
- **THEN** terminal multiplexer check SHALL be skipped regardless of any ancestor
- **THEN** the process is eligible for cleanup based on other criteria

### Requirement: Whitelist checks via tree
The system SHALL perform daemon manager, VS Code, and nohup ancestor checks using the in-memory tree.

#### Scenario: Daemon manager ancestor
- **WHEN** `tree.hasAncestorMatching(pid, isDaemonManager)` is called
- **THEN** returns true if any ancestor's command includes pm2, forever, supervisord, supervisor, or nodemon

#### Scenario: VS Code ancestor
- **WHEN** whitelist checks for VS Code child
- **THEN** `tree.hasAncestorMatching(pid, isVSCode)` is used instead of per-process `execSync`

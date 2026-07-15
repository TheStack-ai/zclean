'use strict';

const fs = require('fs');
const path = require('path');

const SENSITIVE_HISTORY_FIELDS = ['args', 'argv', 'cmd', 'command', 'commandLine'];
let tempCounter = 0;

function secureDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unsafeStorageError('Private storage root must be a real directory, not a symbolic link.');
  }
  if (process.platform !== 'win32') {
    const fd = fs.openSync(directory, fs.constants.O_RDONLY | directoryFlag() | noFollowFlag());
    try {
      fs.fchmodSync(fd, 0o700);
    } finally {
      fs.closeSync(fd);
    }
  }
}

function writePrivateFile(file, content) {
  const directory = path.dirname(file);
  secureDirectory(directory);
  const before = destinationState(file);
  const tempFile = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${tempCounter += 1}.tmp`
  );
  let fd = null;
  try {
    fd = fs.openSync(
      tempFile,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag(),
      0o600
    );
    fs.writeFileSync(fd, content, { encoding: 'utf-8' });
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    assertDestinationUnchanged(file, before);
    fs.renameSync(tempFile, file);
  } finally {
    if (fd !== null) fs.closeSync(fd);
    try { fs.unlinkSync(tempFile); } catch {}
  }
  secureFile(file);
}

function appendPrivateFile(file, content) {
  let existing = '';
  try {
    existing = readPrivateFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  writePrivateFile(file, existing + content);
}

function secureFile(file) {
  const state = destinationState(file);
  if (!state) return;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || !sameIdentity(state.identity, identity(stat))) {
      throw unsafeStorageError('Private storage file changed during inspection.');
    }
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
  } finally {
    fs.closeSync(fd);
  }
}

function readPrivateFile(file) {
  secureDirectory(path.dirname(file));
  const state = destinationState(file);
  if (!state) {
    const error = new Error(`ENOENT: no such file or directory, open '${file}'`);
    error.code = 'ENOENT';
    throw error;
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollowFlag());
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || !sameIdentity(state.identity, identity(stat))) {
      throw unsafeStorageError('Private storage file changed during inspection.');
    }
    return fs.readFileSync(fd, 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const sanitized = { ...entry };
  for (const field of SENSITIVE_HISTORY_FIELDS) delete sanitized[field];
  return sanitized;
}

function sanitizeHistoryFile(file) {
  if (!fs.existsSync(file)) return;

  const raw = readPrivateFile(file);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let changed = false;
  const sanitized = lines.map((line) => {
    try {
      const next = JSON.stringify(sanitizeHistoryEntry(JSON.parse(line)));
      if (next !== line) changed = true;
      return next;
    } catch {
      return line;
    }
  });

  if (changed) {
    writePrivateFile(file, sanitized.join('\n') + (sanitized.length ? '\n' : ''));
  } else {
    secureFile(file);
  }
}

function destinationState(file) {
  let stat;
  try {
    stat = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw unsafeStorageError('Private storage destination must be a regular file, not a symbolic link.');
  }
  return { identity: identity(stat) };
}

function assertDestinationUnchanged(file, before) {
  const current = destinationState(file);
  if (!before && !current) return;
  if (!before || !current || !sameIdentity(before.identity, current.identity)) {
    throw unsafeStorageError('Private storage destination changed during atomic write.');
  }
}

function identity(stat) {
  if (stat.ino === 0 || stat.ino === 0n) {
    throw unsafeStorageError('Private storage identity could not be verified.');
  }
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function noFollowFlag() {
  return fs.constants.O_NOFOLLOW || 0;
}

function directoryFlag() {
  return fs.constants.O_DIRECTORY || 0;
}

function unsafeStorageError(message) {
  const error = new Error(message);
  error.code = 'ZCLEAN_UNSAFE_STORAGE';
  return error;
}

module.exports = {
  appendPrivateFile,
  readPrivateFile,
  sanitizeHistoryEntry,
  sanitizeHistoryFile,
  secureDirectory,
  secureFile,
  writePrivateFile,
};

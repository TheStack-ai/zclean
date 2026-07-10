'use strict';

const fs = require('fs');

const SENSITIVE_HISTORY_FIELDS = ['args', 'argv', 'cmd', 'command', 'commandLine'];

function secureDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

function writePrivateFile(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf-8', mode: 0o600 });
  secureFile(file);
}

function appendPrivateFile(file, content) {
  fs.appendFileSync(file, content, { encoding: 'utf-8', mode: 0o600 });
  secureFile(file);
}

function secureFile(file) {
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const sanitized = { ...entry };
  for (const field of SENSITIVE_HISTORY_FIELDS) delete sanitized[field];
  return sanitized;
}

function sanitizeHistoryFile(file) {
  if (!fs.existsSync(file)) return;

  const raw = fs.readFileSync(file, 'utf-8');
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

module.exports = {
  appendPrivateFile,
  sanitizeHistoryEntry,
  sanitizeHistoryFile,
  secureDirectory,
  secureFile,
  writePrivateFile,
};

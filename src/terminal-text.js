'use strict';

function sanitizeTerminalText(value) {
  return String(value ?? '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '');
}

module.exports = { sanitizeTerminalText };

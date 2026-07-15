'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseElapsed } = require('../src/process-tree');
const { sanitizeDiagnosticText } = require('../src/process-diagnostic');

describe('ProcessTree', () => {
  // ── parseElapsed ────────────────────────────────────────────────
  describe('parseElapsed', () => {
    it('parses MM:SS', () => {
      assert.equal(parseElapsed('05:30'), (5 * 60 + 30) * 1000);
    });

    it('parses HH:MM:SS', () => {
      assert.equal(parseElapsed('01:23:45'), (1 * 3600 + 23 * 60 + 45) * 1000);
    });

    it('parses DD-HH:MM:SS', () => {
      assert.equal(parseElapsed('2-03:04:05'), ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000);
    });

    it('returns 0 for empty/null', () => {
      assert.equal(parseElapsed(''), 0);
      assert.equal(parseElapsed(null), 0);
    });
  });

  describe('public process diagnostics', () => {
    it('redacts credential values without treating hyphenated prose as an option', () => {
      const sanitized = sanitizeDiagnosticText(
        'bearer-secret worker failed /Users/example/private --token=secret-value'
      );

      assert.match(sanitized, /^bearer-secret worker failed \[local-path\]/);
      assert.match(sanitized, /--token=\[redacted\]/);
      assert.equal(sanitized.includes('secret-value'), false);
    });
  });
});

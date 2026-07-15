'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { sanitizeDiagnosticText } = require('../src/process-diagnostic');

describe('public diagnostic safety', () => {
  it('redacts unquoted colon credential values', () => {
    const input = [
      'token: secret-token',
      'password: hunter2',
      'apiKey: sk-private',
      'ANTHROPIC_AUTH_TOKEN: auth-private',
    ].join(', ');

    const sanitized = sanitizeDiagnosticText(input);

    for (const secret of ['secret-token', 'hunter2', 'sk-private', 'auth-private']) {
      assert.equal(sanitized.includes(secret), false);
    }
    assert.equal((sanitized.match(/\[redacted\]/g) || []).length, 4);
  });

  it('redacts local paths immediately following punctuation', () => {
    const sanitized = sanitizeDiagnosticText(
      'failed at:/Users/example/private and source:C:\\Users\\example\\private'
    );

    assert.equal(sanitized.includes('/Users/example/private'), false);
    assert.equal(sanitized.includes('C:\\Users\\example\\private'), false);
    assert.equal((sanitized.match(/\[local-path\]/g) || []).length, 2);
  });
});

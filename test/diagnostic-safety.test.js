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

  it('redacts bracket-adjacent POSIX and Windows local paths', () => {
    const paths = [
      '/Users/alice/.config/zclean/session.log',
      'C:\\Users\\bob\\AppData\\Local\\zclean\\trace.log',
    ];

    const sanitized = sanitizeDiagnosticText(`posix[${paths[0]}] windows[${paths[1]}]`);

    for (const localPath of paths) assert.equal(sanitized.includes(localPath), false);
    assert.equal((sanitized.match(/\[local-path\]/g) || []).length, 2);
    assert.equal(sanitized, 'posix[[local-path]] windows[[local-path]]');
  });

  it('redacts brace-adjacent POSIX and Windows local paths', () => {
    const paths = [
      '/home/carol/.local/share/zclean/report.json',
      'D:\\work\\dave\\.zclean\\history.json',
    ];

    const sanitized = sanitizeDiagnosticText(`posix{${paths[0]}} windows{${paths[1]}}`);

    for (const localPath of paths) assert.equal(sanitized.includes(localPath), false);
    assert.equal((sanitized.match(/\[local-path\]/g) || []).length, 2);
    assert.equal(sanitized, 'posix{[local-path]} windows{[local-path]}');
  });
});

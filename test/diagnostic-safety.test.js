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

  it('fully redacts the reproduced colon Authorization Bearer value', () => {
    const input = 'request failed: Authorization: Bearer colon-secret-123';

    assert.equal(
      sanitizeDiagnosticText(input),
      'request failed: Authorization: Bearer [redacted]'
    );
  });

  it('fully redacts the reproduced flag Authorization Bearer value', () => {
    const input = 'request failed: --authorization Bearer flag-secret-456';

    assert.equal(
      sanitizeDiagnosticText(input),
      'request failed: --authorization Bearer [redacted]'
    );
  });

  it('fully hides the reproduced POSIX path containing spaces', () => {
    const input = 'failed to read /Users/alice/My Projects/zclean/private report.json';

    assert.equal(sanitizeDiagnosticText(input), 'failed to read [local-path]');
  });

  it('fully hides the reproduced Windows path containing spaces', () => {
    const input = 'failed to read C:\\Users\\Bob\\My Documents\\zclean\\private report.json';

    assert.equal(sanitizeDiagnosticText(input), 'failed to read [local-path]');
  });

  it('redacts the complete Bearer value for a quoted Authorization key', () => {
    const input = '{"Authorization":"Bearer quoted-secret"}';

    assert.equal(sanitizeDiagnosticText(input), '{"Authorization":"Bearer [redacted]"}');
  });

  it('redacts a quoted Bearer value in colon form', () => {
    const input = 'Authorization: Bearer "quoted-colon-secret"';

    assert.equal(sanitizeDiagnosticText(input), 'Authorization: Bearer [redacted]');
  });

  it('redacts a quoted Bearer value in flag form', () => {
    const input = '--authorization Bearer "quoted-flag-secret"';

    assert.equal(sanitizeDiagnosticText(input), '--authorization Bearer [redacted]');
  });

  it('redacts a standalone quoted Bearer value', () => {
    const input = 'provider returned Bearer "standalone-secret"';

    assert.equal(sanitizeDiagnosticText(input), 'provider returned Bearer [redacted]');
  });

  it('redacts a quoted Bearer value containing spaces', () => {
    const input = '--authorization Bearer "quoted secret tail"';

    assert.equal(sanitizeDiagnosticText(input), '--authorization Bearer [redacted]');
  });

  it('redacts backtick-wrapped and file URI local paths', () => {
    const input = [
      'failed `/Users/alice/private/report.json`',
      'failed file:///Users/alice/private/report.json',
    ].join('; ');

    const sanitized = sanitizeDiagnosticText(input);

    assert.equal(sanitized.includes('/Users/alice/private/report.json'), false);
    assert.equal((sanitized.match(/\[local-path\]/g) || []).length, 2);
  });

  it('keeps ordinary hyphenated prose readable', () => {
    const input = 'worker pre-flight check is retry-safe and well-formed';

    assert.equal(sanitizeDiagnosticText(input), input);
  });
});

'use strict';

function providerDiagnostic(provider, code, error) {
  return {
    code,
    provider,
    message: diagnosticMessage(error),
  };
}

function diagnosticMessage(error) {
  const stderr = error && error.stderr ? String(error.stderr).trim() : '';
  const fallback = error instanceof Error ? error.message : String(error || '');
  return (stderr || fallback).replace(/\s+/g, ' ').slice(0, 500);
}

module.exports = { providerDiagnostic };

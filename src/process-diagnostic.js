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
  return sanitizeDiagnosticText(stderr || fallback);
}

function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(
      /(["'])(?:[A-Z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?(?:[_-]?token)?|cookie|password|passwd|secret|token)(?:[_-][A-Z0-9]+)*\1\s*:\s*(?:"[^"]*"|'[^']*'|[^,\s}\]]+)/gi,
      '[credential]:[redacted]'
    )
    .replace(
      /(^|[\s("'=])(--?(?:api[-_]?key|access[-_]?token|auth(?:orization)?|cookie|password|passwd|secret|token)\b)(?:\s*=\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2=[redacted]'
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(
      /\b(?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH(?:ORIZATION)?(?:[_-]?TOKEN)?|COOKIE|PASSWORD|PASSWD|SECRET|TOKEN)(?:[_-][A-Z0-9]+)*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (match) => `${match.split('=')[0]}=[redacted]`
    )
    .replace(/([?&](?:api[-_]?key|access[-_]?token|password|secret|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(^|[\s("'=])(?:[A-Za-z]:\\|\\\\)[^\s"']+/g, '$1[local-path]')
    .replace(/(^|[\s("'=])\/(?:[^\s"'\/]+\/)*[^\s"']+/g, '$1[local-path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function sanitizeDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { code: 'diagnostic', message: sanitizeDiagnosticText(value) };
  }

  const result = {};
  for (const key of ['code', 'provider', 'platform']) {
    if (typeof value[key] === 'string' && value[key]) result[key] = value[key].slice(0, 80);
  }
  if (Array.isArray(value.providers)) {
    result.providers = value.providers
      .filter((provider) => typeof provider === 'string')
      .map((provider) => provider.slice(0, 80));
  }
  if (Number.isFinite(value.count)) result.count = value.count;
  result.message = sanitizeDiagnosticText(value.message || value.code || 'diagnostic');
  return result;
}

function sanitizeDiagnostics(values) {
  return (Array.isArray(values) ? values : []).map(sanitizeDiagnostic);
}

module.exports = {
  providerDiagnostic,
  sanitizeDiagnostic,
  sanitizeDiagnostics,
  sanitizeDiagnosticText,
};

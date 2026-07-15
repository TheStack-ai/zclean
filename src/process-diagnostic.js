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
  return redactBearerValues(String(value || ''))
    .replace(
      /\bBearer\s+(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|`[^`]*(?:`|$)|[^\s,;"'`{}\[\]]+)/gi,
      'Bearer ZCLEAN_REDACTED_VALUE'
    )
    .replace(
      /(["'])((?:[A-Z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?(?:[_-]?token)?|cookie|password|passwd|secret|token)(?:[_-][A-Z0-9]+)*)\1(\s*:\s*)((?:"[^"]*"|'[^']*'|Bearer\s+[^,\s}\]]+|[^,\s}\]]+))/gi,
      (match, quote, key, separator, credential) => {
        const value = credential[0] === '"' || credential[0] === "'"
          ? credential.slice(1, -1)
          : credential;
        if (/^authorization$/i.test(key) && /^Bearer\s+/i.test(value)) {
          const valueQuote = credential[0] === '"' || credential[0] === "'"
            ? credential[0]
            : '';
          return quote + key + quote + separator + valueQuote + 'Bearer [redacted]' + valueQuote;
        }
        return '[credential]:[redacted]';
      }
    )
    .replace(
      /(^|[\s,{([])((?:[A-Z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth(?:orization)?(?:[_-]?token)?|cookie|password|passwd|secret|token)(?:[_-][A-Z0-9]+)*)(\s*:\s*)((?:"[^"]*"|'[^']*'|Bearer\s+[^,\s}\]]+|[^,\s}\]]+))/gi,
      (match, prefix, key, separator, credential) =>
        prefix + key + separator + (/^Bearer\s+/i.test(credential) ? 'Bearer ' : '') + '[redacted]'
    )
    .replace(
      /(^|[\s("'=])(--?(?:api[-_]?key|access[-_]?token|auth(?:orization)?|cookie|password|passwd|secret|token)\b)(\s*=\s*|\s+)((?:"[^"]*"|'[^']*'|Bearer\s+[^\s,;]+|[^\s,;]+))/gi,
      (match, prefix, flag, separator, credential) =>
        prefix + flag + separator + (/^Bearer\s+/i.test(credential) ? 'Bearer ' : '') + '[redacted]'
    )
    .replace(/\bBearer\s+(?:"[^"]*"|'[^']*'|[^\s,;"'{}\[\]]+)/gi, 'Bearer [redacted]')
    .replace(
      /\b(?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH(?:ORIZATION)?(?:[_-]?TOKEN)?|COOKIE|PASSWORD|PASSWD|SECRET|TOKEN)(?:[_-][A-Z0-9]+)*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (match) => `${match.split('=')[0]}=[redacted]`
    )
    .replace(/([?&](?:api[-_]?key|access[-_]?token|password|secret|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(
      /\bfile:\/\/[^\s"'`{},;)]+/gi,
      '[local-path]'
    )
    .replace(
      /(^|[\s("'`=:;,\[{])(?:[A-Za-z]:\\|\\\\)[^"'`{}\[\],;)]*?(?=$|["'`{}\[\],;)]|\s+--|\s+(?:[A-Za-z]:\\|\/))/g,
      '$1[local-path]'
    )
    .replace(
      /(^|[\s("'`=:;,\[{])\/(?!\/)[^"'`{}\[\],;)]*?(?=$|["'`{}\[\],;)]|\s+--|\s+(?:[A-Za-z]:\\|\/))/g,
      '$1[local-path]'
    )
    .replace(/ZCLEAN_REDACTED_VALUE/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function redactBearerValues(input) {
  const matcher = /\bBearer\s+/gi;
  let cursor = 0;
  let output = '';
  let match;

  while ((match = matcher.exec(input)) !== null) {
    output += input.slice(cursor, match.index) + 'Bearer ZCLEAN_REDACTED_VALUE';
    const valueStart = matcher.lastIndex;
    const valueEnd = bearerValueEnd(input, valueStart);
    cursor = valueEnd;
    matcher.lastIndex = valueEnd > valueStart ? valueEnd : valueStart + 1;
  }
  return output + input.slice(cursor);
}

function bearerValueEnd(input, start) {
  if (input.startsWith('[redacted]', start)) return start + '[redacted]'.length;
  if (input.startsWith('ZCLEAN_REDACTED_VALUE', start)) {
    return start + 'ZCLEAN_REDACTED_VALUE'.length;
  }

  let quotePosition = start;
  while (input[quotePosition] === '\\') quotePosition++;
  const leadingSlashes = quotePosition - start;
  const quote = input[quotePosition];
  if (!['"', "'", '`'].includes(quote)) {
    let end = start;
    while (end < input.length && !/[\s,;"'`{}\[\]]/.test(input[end])) end++;
    return end;
  }

  for (let index = quotePosition + 1; index < input.length; index++) {
    if (input[index] !== quote) continue;
    let precedingSlashes = 0;
    for (let cursor = index - 1; cursor >= 0 && input[cursor] === '\\'; cursor--) precedingSlashes++;
    const closes = leadingSlashes === 0
      ? precedingSlashes % 2 === 0
      : precedingSlashes >= leadingSlashes;
    if (closes) return index + 1;
  }
  return input.length;
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

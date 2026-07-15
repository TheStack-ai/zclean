'use strict';

function parsePlistXml(value) {
  if (typeof value !== 'string') return null;
  let source = value.replace(/^\uFEFF/, '').trim();
  source = stripPrefix(source, /^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/);
  source = stripPrefix(
    source,
    /^<!DOCTYPE\s+plist\s+PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')\s*>/
  );
  if (/<!--|<\?|<!/.test(source)) return null;

  const open = source.match(/^<plist(?:\s+version=["']1\.0["'])?\s*>/);
  if (!open) return null;
  const parsed = parseValue(source, open[0].length);
  if (!parsed || parsed.node.type !== 'dict') return null;
  const end = skipWhitespace(source, parsed.next);
  const close = source.slice(end).match(/^<\/plist\s*>/);
  if (!close || skipWhitespace(source, end + close[0].length) !== source.length) return null;
  return parsed.node;
}

function stripPrefix(source, pattern) {
  const match = source.match(pattern);
  return match ? source.slice(match[0].length).trimStart() : source;
}

function parseValue(source, index) {
  const start = skipWhitespace(source, index);
  for (const type of ['string', 'integer']) {
    const parsed = parseTextElement(source, start, type);
    if (parsed) return parsed;
  }
  for (const type of ['true', 'false']) {
    const match = source.slice(start).match(new RegExp('^<' + type + '\\s*\\/>'));
    if (match) return { node: { type }, next: start + match[0].length };
  }
  if (startsWithTag(source, start, 'array')) return parseArray(source, start);
  if (startsWithTag(source, start, 'dict')) return parseDict(source, start);
  return null;
}

function parseArray(source, index) {
  let next = consumeOpenTag(source, index, 'array');
  if (next === null) return null;
  const values = [];
  while (true) {
    next = skipWhitespace(source, next);
    const close = consumeCloseTag(source, next, 'array');
    if (close !== null) return { node: { type: 'array', values }, next: close };
    const parsed = parseValue(source, next);
    if (!parsed) return null;
    values.push(parsed.node);
    next = parsed.next;
  }
}

function parseDict(source, index) {
  let next = consumeOpenTag(source, index, 'dict');
  if (next === null) return null;
  const entries = [];
  while (true) {
    next = skipWhitespace(source, next);
    const close = consumeCloseTag(source, next, 'dict');
    if (close !== null) return { node: { type: 'dict', entries }, next: close };
    const key = parseTextElement(source, next, 'key');
    if (!key) return null;
    const value = parseValue(source, key.next);
    if (!value) return null;
    entries.push({ key: key.node.value, value: value.node });
    next = value.next;
  }
}

function parseTextElement(source, index, type) {
  const open = '<' + type + '>';
  if (source.slice(index, index + open.length) !== open) return null;
  const close = '</' + type + '>';
  const end = source.indexOf(close, index + open.length);
  if (end < 0) return null;
  const raw = source.slice(index + open.length, end);
  if (raw.includes('<')) return null;
  const decoded = decodeXmlText(raw);
  if (decoded === null) return null;
  return {
    node: { type, value: decoded },
    next: end + close.length,
  };
}

function decodeXmlText(value) {
  let output = '';
  let index = 0;
  while (index < value.length) {
    const amp = value.indexOf('&', index);
    if (amp < 0) return output + value.slice(index);
    output += value.slice(index, amp);
    const end = value.indexOf(';', amp + 1);
    if (end < 0) return null;
    const decoded = decodeEntity(value.slice(amp + 1, end));
    if (decoded === null) return null;
    output += decoded;
    index = end + 1;
  }
  return output;
}

function decodeEntity(entity) {
  const named = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };
  if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
  const match = entity.match(/^#(x[0-9a-fA-F]+|\d+)$/);
  if (!match) return null;
  const hex = match[1][0] === 'x';
  const codePoint = Number.parseInt(hex ? match[1].slice(1) : match[1], hex ? 16 : 10);
  return isXmlCodePoint(codePoint) ? String.fromCodePoint(codePoint) : null;
}

function isXmlCodePoint(value) {
  return value === 0x9 || value === 0xa || value === 0xd
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

function startsWithTag(source, index, tag) {
  return new RegExp('^<' + tag + '\\s*>').test(source.slice(index));
}

function consumeOpenTag(source, index, tag) {
  const match = source.slice(index).match(new RegExp('^<' + tag + '\\s*>'));
  return match ? index + match[0].length : null;
}

function consumeCloseTag(source, index, tag) {
  const match = source.slice(index).match(new RegExp('^<\\/' + tag + '\\s*>'));
  return match ? index + match[0].length : null;
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

module.exports = { parsePlistXml };

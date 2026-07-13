'use strict';

const { c, bold } = require('./reporter');
const { sanitizeTerminalText } = require('./terminal-text');

const WORDMARK = [
  '  ███████  ██████ ██      ███████  █████  ███    ██',
  '       ██ ██      ██      ██      ██   ██ ████   ██',
  '     ███  ██      ██      █████   ███████ ██ ██  ██',
  '   ██     ██      ██      ██      ██   ██ ██  ██ ██',
  '  ███████  ██████ ███████ ███████ ██   ██ ██   ████',
];

const RULE = '  --------------------------------------------------------';
const FRAME_WIDTH = 55;

function renderPostinstall({ version }) {
  return [
    '',
    c('gray', '     .   +  .'),
    c('gray', '  +    .     :'),
    ...WORDMARK.map((line) => c('cyan', line)),
    '',
    `  ${bold('Z / CLEAN')}  ${c('gray', `v${version}`)}`,
    c('gray', '  AI CODING RUNTIME HYGIENE'),
    c('gray', RULE),
    '',
    `  ${c('green', 'INSTALLED')}   z-clean`,
    `  ${c('gray', 'COMMAND')}     zclean`,
    `  ${c('gray', 'SAFETY')}      dry-run by default`,
    '',
    c('gray', '  Continue setup'),
    `    ${c('cyan', '$ zclean init')}`,
    '',
    c('gray', '  Inspect first. Clean only when you decide.'),
    '',
  ].join('\n');
}

function renderInit({ version, steps, warningCount }) {
  const lines = [
    '',
    c('gray', '     .   +  .'),
    c('gray', '  +    .     :'),
    ...WORDMARK.map((line) => c('cyan', line)),
    '',
    `  ${bold('Z / CLEAN')}  ${c('gray', `v${version}`)}`,
    c('gray', '  RUNTIME HYGIENE SYSTEM'),
    '',
    c('gray', `  +${'-- SETUP '.padEnd(FRAME_WIDTH, '-')}+`),
    c('gray', `  |${''.padEnd(FRAME_WIDTH)}|`),
  ];

  for (const step of steps) {
    lines.push(renderStep(step));
  }

  const ready = warningCount === 0;
  lines.push(
    c('gray', `  |${''.padEnd(FRAME_WIDTH)}|`),
    c('gray', `  +${''.padEnd(FRAME_WIDTH, '-')}+`),
    '',
    ready
      ? c('green', '  SYSTEM READY')
      : c('yellow', `  SETUP COMPLETED WITH ${warningCount} WARNING${warningCount === 1 ? '' : 'S'}`),
    '',
    `  ${c('gray', 'Inspect runtime leftovers')}   ${c('cyan', 'zclean audit')}`,
    `  ${c('gray', 'Verify this installation')}    ${c('cyan', 'zclean doctor')}`,
    '',
    c('gray', '  Cleanup remains locked until you pass --yes.'),
    ''
  );

  return lines.join('\n');
}

function renderStep(step) {
  const state = String(step.state).padEnd(10);
  const label = String(step.label).padEnd(14);
  const tone = step.state === 'WARNING' ? 'yellow' : step.state === 'EXISTS' ? 'gray' : 'green';
  const statusPrefix = `  ${step.index}  ${label} `;
  const statusSpacing = ''.padEnd(FRAME_WIDTH - statusPrefix.length - state.length);
  const detail = padToWidth(`      ${fitDetail(step.detail)}`, FRAME_WIDTH);
  return [
    `  |${c('gray', statusPrefix)}${c(tone, state)}${statusSpacing}|`,
    `  |${c('gray', detail)}|`,
  ].join('\n');
}

function fitDetail(value) {
  const text = sanitizeTerminalText(value).replace(/\s+/g, ' ').trim();
  if (displayWidth(text) <= 45) return text;
  let output = '';
  let width = 0;
  for (const char of text) {
    const next = charWidth(char);
    if (width + next > 42) break;
    output += char;
    width += next;
  }
  return `${output}...`;
}

function padToWidth(value, width) {
  return `${value}${''.padEnd(Math.max(0, width - displayWidth(value)))}`;
}

function displayWidth(value) {
  return [...value].reduce((width, char) => width + charWidth(char), 0);
}

function charWidth(char) {
  if (/\p{Mark}/u.test(char)) return 0;
  const code = char.codePointAt(0);
  const wide = code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
  return wide ? 2 : 1;
}

module.exports = { renderPostinstall, renderInit };

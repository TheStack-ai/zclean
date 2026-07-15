'use strict';

const { parsePlistXml } = require('./plist-parser');

function inspectSchedulerDefinition(value, platform) {
  if (typeof value !== 'string' || !value.trim()) {
    return { safe: false, reason: 'command could not be verified' };
  }
  if (/(?:^|[\s>\"])--yes(?:[\s<\"]|$)/i.test(value)) {
    return { safe: false, reason: 'unsafe automatic cleanup command found' };
  }
  const definition = platform === 'darwin' ? parsePlistXml(value) : value;
  if (!definition) {
    return { safe: false, reason: 'launchd keys could not be verified' };
  }
  const args = extractSchedulerArgs(definition, platform);
  if (!args || args.length !== 3 || args[1] !== 'audit' || args[2] !== '--json') {
    return { safe: false, reason: 'command is not the report-only audit contract' };
  }
  if (platform === 'darwin' && !launchdProgramMatches(definition, args[0])) {
    return { safe: false, reason: 'launchd Program does not match the scheduled executable' };
  }
  if (!isZcleanExecutable(args[0])) {
    return { safe: false, reason: 'scheduled executable is not zclean' };
  }
  return { safe: true };
}

function launchdProgramMatches(definition, executable) {
  const programs = definition.entries.filter((entry) => entry.key === 'Program');
  return programs.length === 0
    || (programs.length === 1
      && programs[0].value.type === 'string'
      && programs[0].value.value === executable);
}

function extractSchedulerArgs(value, platform) {
  if (platform === 'darwin') {
    const entries = value.entries.filter((entry) => entry.key === 'ProgramArguments');
    if (entries.length !== 1 || entries[0].value.type !== 'array') return null;
    const args = entries[0].value.values;
    if (args.length !== 3 || args.some((arg) => arg.type !== 'string')) return null;
    return args.map((arg) => arg.value);
  }

  if (platform === 'linux') {
    const actions = [...value.matchAll(
      /^[ \t]*(Exec(?:Condition|StartPre|Start|StartPost|Reload|Stop|StopPost))=(.*)$/gm
    )];
    if (actions.length > 0) {
      return actions.length === 1 && actions[0][1] === 'ExecStart'
        ? parseExactCommand(actions[0][2].trim())
        : null;
    }
    const loaded = [...value.matchAll(/argv\[\]=([^;\r\n]+)(?:;|$)/gi)];
    return loaded.length === 1 ? parseExactCommand(loaded[0][1].trim()) : null;
  }

  if (platform === 'win32') {
    const actionBlocks = [...value.matchAll(/<Actions\b[^>]*>([\s\S]*?)<\/Actions>/gi)];
    if (actionBlocks.length !== 1) return null;
    const actions = actionBlocks[0][1];
    const actionNames = [...actions.matchAll(/<(Exec|ComHandler|SendEmail|ShowMessage)\b/gi)];
    if (actionNames.length !== 1 || actionNames[0][1].toLowerCase() !== 'exec') return null;
    const exec = actions.match(/<Exec\b[^>]*>([\s\S]*?)<\/Exec>/i);
    const command = exec?.[1].match(/<Command>([\s\S]*?)<\/Command>/i);
    const argumentsValue = exec?.[1].match(/<Arguments>([\s\S]*?)<\/Arguments>/i);
    if (!command || !argumentsValue) return null;
    const argumentsText = decodeXml(argumentsValue[1]);
    if (argumentsText !== 'audit --json') return null;
    return [decodeXml(command[1]), 'audit', '--json'];
  }
  return null;
}

function parseExactCommand(value) {
  const match = value.match(/^("(?:\\.|[^"])*"|'[^']*'|\S+)\s+(\S+)\s+(\S+)$/);
  return match ? [match[1], match[2], match[3]] : null;
}

function isZcleanExecutable(value) {
  const raw = String(value || '');
  if (!raw || raw !== raw.trim()) return false;
  const unquoted = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
  if (!unquoted || unquoted !== unquoted.trim()) return false;
  const basename = unquoted.split(/[\\/]/).pop().toLowerCase();
  return basename === 'zclean'
    || basename === 'zclean.js'
    || basename === 'zclean.cmd'
    || basename === 'zclean.exe';
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => decodeCodePoint(match, code, 16))
    .replace(/&#([0-9]+);/g, (match, code) => decodeCodePoint(match, code, 10))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeCodePoint(match, value, radix) {
  const codePoint = Number.parseInt(value, radix);
  const valid = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  return Number.isInteger(codePoint) && valid
    ? String.fromCodePoint(codePoint)
    : match;
}

module.exports = { inspectSchedulerDefinition };

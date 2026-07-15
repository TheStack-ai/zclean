'use strict';

function inspectSchedulerDefinition(value, platform) {
  if (typeof value !== 'string' || !value.trim()) {
    return { safe: false, reason: 'command could not be verified' };
  }
  if (/(?:^|[\s>\"])--yes(?:[\s<\"]|$)/i.test(value)) {
    return { safe: false, reason: 'unsafe automatic cleanup command found' };
  }
  const normalized = platform === 'darwin' ? normalizeLaunchdKeys(value) : value;
  if (!normalized) {
    return { safe: false, reason: 'launchd keys could not be verified' };
  }
  const args = extractSchedulerArgs(normalized, platform);
  if (!args || args.length !== 3 || args[1] !== 'audit' || args[2] !== '--json') {
    return { safe: false, reason: 'command is not the report-only audit contract' };
  }
  if (platform === 'darwin' && !launchdProgramMatches(normalized, args[0])) {
    return { safe: false, reason: 'launchd Program does not match the scheduled executable' };
  }
  if (!isZcleanExecutable(args[0])) {
    return { safe: false, reason: 'scheduled executable is not zclean' };
  }
  return { safe: true };
}

function normalizeLaunchdKeys(value) {
  let unresolved = false;
  const normalized = value.replace(
    /<key\b[^>]*>([\s\S]*?)<\/key>/gi,
    (_match, key) => {
      const decoded = decodeLaunchdKey(key);
      if (decoded === null) unresolved = true;
      return `<key>${decoded || ''}</key>`;
    }
  );
  return unresolved ? null : normalized;
}

function decodeLaunchdKey(value) {
  const text = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  if (/[<>]/.test(text)) return null;
  const decoded = decodeXml(text);
  return /[<>]|&(?:#(?:x[0-9a-f]+|\d+)|[a-z_:][\w:.-]*);/i.test(decoded)
    ? null
    : decoded;
}

function launchdProgramMatches(value, executable) {
  const programs = [...value.matchAll(
    /<key>\s*Program\s*<\/key>\s*<string>([\s\S]*?)<\/string>/gi
  )];
  return programs.length === 0
    || (programs.length === 1 && decodeXml(programs[0][1]).trim() === executable);
}

function extractSchedulerArgs(value, platform) {
  if (platform === 'darwin') {
    const blocks = [...value.matchAll(
      /<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/gi
    )];
    if (blocks.length !== 1) return null;
    return [...blocks[0][1].matchAll(/<string>([\s\S]*?)<\/string>/gi)]
      .map((match) => decodeXml(match[1]).trim());
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
    const argumentsText = decodeXml(argumentsValue[1]).trim();
    if (argumentsText !== 'audit --json') return null;
    return [decodeXml(command[1]).trim(), 'audit', '--json'];
  }
  return null;
}

function parseExactCommand(value) {
  const match = value.match(/^("(?:\\.|[^"])*"|'[^']*'|\S+)\s+(\S+)\s+(\S+)$/);
  return match ? [match[1], match[2], match[3]] : null;
}

function isZcleanExecutable(value) {
  const unquoted = String(value || '').trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
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

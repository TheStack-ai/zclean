'use strict';

function inspectSchedulerDefinition(value, platform) {
  if (typeof value !== 'string' || !value.trim()) {
    return { safe: false, reason: 'command could not be verified' };
  }
  if (/(?:^|[\s>\"])--yes(?:[\s<\"]|$)/i.test(value)) {
    return { safe: false, reason: 'unsafe automatic cleanup command found' };
  }
  const args = extractSchedulerArgs(value, platform);
  if (!args || args.length !== 3 || args[1] !== 'audit' || args[2] !== '--json') {
    return { safe: false, reason: 'command is not the report-only audit contract' };
  }
  if (!isZcleanExecutable(args[0])) {
    return { safe: false, reason: 'scheduled executable is not zclean' };
  }
  return { safe: true };
}

function extractSchedulerArgs(value, platform) {
  if (platform === 'darwin') {
    const block = value.match(/<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/i);
    if (!block) return null;
    return [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/gi)]
      .map((match) => decodeXml(match[1]).trim());
  }

  if (platform === 'linux') {
    const line = value.match(/^ExecStart=(.+)$/m);
    if (line) return parseExactCommand(line[1].trim());
    const loaded = value.match(/argv\[\]=([^;\r\n]+)/i);
    return loaded ? parseExactCommand(loaded[1].trim()) : null;
  }

  if (platform === 'win32') {
    const command = value.match(/<Command>([\s\S]*?)<\/Command>/i);
    const argumentsValue = value.match(/<Arguments>([\s\S]*?)<\/Arguments>/i);
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
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

module.exports = { inspectSchedulerDefinition };

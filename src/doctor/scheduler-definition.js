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
    return line ? parseExactCommand(line[1].trim()) : null;
  }

  if (platform === 'win32') {
    for (const line of value.split(/\r?\n/)) {
      const candidate = line.includes(':') ? line.slice(line.indexOf(':') + 1).trim() : line.trim();
      const args = parseExactCommand(candidate);
      if (args) return args;
    }
  }
  return null;
}

function parseExactCommand(value) {
  const match = value.match(/^("(?:\\.|[^"])*"|'[^']*'|\S+)\s+(\S+)\s+(\S+)$/);
  return match ? [match[1], match[2], match[3]] : null;
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

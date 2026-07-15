'use strict';

function parseDuration(value) {
  const match = String(value).match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) return null;
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return parseInt(match[1], 10) * multipliers[match[2].toLowerCase()];
}

function parseMemory(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) return null;
  const multipliers = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.floor(parseFloat(match[1]) * multipliers[match[2].toUpperCase()]);
}

module.exports = { parseDuration, parseMemory };

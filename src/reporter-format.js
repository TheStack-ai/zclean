'use strict';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

function c(color, text) {
  return useColor ? `${C[color]}${text}${C.reset}` : text;
}

function bold(text) {
  return useColor ? `${C.bold}${text}${C.reset}` : text;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = (bytes / (1024 ** index)).toFixed(index > 0 ? 1 : 0);
  return `${value} ${units[index]}`;
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function truncate(value, maxLength = 80) {
  return value.length <= maxLength ? value : `${value.substring(0, maxLength - 3)}...`;
}

module.exports = { C, bold, c, formatBytes, formatDuration, truncate };

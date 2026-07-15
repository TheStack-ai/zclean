'use strict';

function parseElapsed(elapsed) {
  if (!elapsed) return 0;

  let days = 0;
  let rest = elapsed.trim();
  const dayMatch = rest.match(/^(\d+)-(.+)$/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
    rest = dayMatch[2];
  }

  const parts = rest.split(':').map((part) => parseInt(part, 10));
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) [hours, minutes, seconds] = parts;
  else if (parts.length === 2) [minutes, seconds] = parts;
  else if (parts.length === 1) [seconds] = parts;

  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

module.exports = { parseElapsed };

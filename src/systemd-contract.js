'use strict';

const EXEC_PROPERTIES = Object.freeze([
  'ExecCondition',
  'ExecStartPre',
  'ExecStart',
  'ExecStartPost',
  'ExecReload',
  'ExecStop',
  'ExecStopPost',
]);

function systemdShowArgs(unitName = 'zclean.service') {
  return [
    '--user',
    'show',
    unitName,
    `--property=${EXEC_PROPERTIES.join(',')}`,
    '--value',
  ];
}

function systemdShowCommand(unitName = 'zclean.service') {
  return ['systemctl', ...systemdShowArgs(unitName)].join(' ');
}

module.exports = { EXEC_PROPERTIES, systemdShowArgs, systemdShowCommand };

#!/usr/bin/env node
'use strict';

const { version } = require('../package.json');
const { renderPostinstall } = require('../src/cli-brand');

process.stdout.write(renderPostinstall({ version }));

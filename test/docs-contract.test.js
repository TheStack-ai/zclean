'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const readmes = ['README.md', 'README.ko.md', 'README.zh.md'];

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

describe('README command and navigation contract', () => {
  it('links all three maintained language versions', () => {
    for (const file of readmes) {
      const contents = read(file);
      for (const target of readmes) {
        assert.match(contents, new RegExp(`\\(${target.replace('.', '\\.')}\\)`));
      }
    }
  });

  it('uses the published package name and executable consistently', () => {
    const requiredCommands = [
      'npx --yes z-clean audit',
      'npm install --global z-clean',
      'zclean report',
      'zclean --yes',
      'zclean cache --json',
      'zclean doctor --json',
    ];

    for (const file of readmes) {
      const contents = read(file);
      for (const command of requiredCommands) assert.ok(contents.includes(command), `${file}: ${command}`);
      assert.equal(contents.includes('@thestackai/zclean'), false, file);
      assert.equal(contents.includes('npx zclean'), false, file);
    }
  });

  it('keeps destructive examples behind the explicit confirmation flag', () => {
    for (const file of readmes) {
      const bashBlocks = [...read(file).matchAll(/```bash\n([\s\S]*?)```/g)]
        .map((match) => match[1]);
      const cleanupLines = bashBlocks
        .flatMap((block) => block.split(/\r?\n/))
        .filter((line) => /^\s*zclean\s+(?:cache\s+)?--yes\b/.test(line));

      assert.ok(cleanupLines.length > 0, `${file}: cleanup example missing`);
      assert.ok(cleanupLines.every((line) => line.includes('--yes')), file);
    }
  });
});

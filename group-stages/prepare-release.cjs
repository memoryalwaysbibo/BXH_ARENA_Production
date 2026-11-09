'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceFiles = [
  'group-stages/firebase-entry.cjs',
  'group-stages/command.cjs',
  'group-stages/coordinator.cjs',
  'group-stages/core.cjs',
  'group-stages/draw.cjs',
  'referee-seats/functions/bucket-state.cjs',
  'ladder-v1.js',
];

function prepareRelease(root, destination) {
  root = path.resolve(root);
  destination = path.resolve(destination);
  if (destination === root || destination.startsWith(root + path.sep)) {
    throw new Error('release-destination-must-be-outside-checkout');
  }

  for (const file of sourceFiles) {
    if (!fs.lstatSync(path.join(root, file)).isFile()) {
      throw new Error('invalid-release-source: ' + file);
    }
  }
  fs.mkdirSync(destination, { mode: 0o700 });
  const source = path.join(destination, 'functions');
  for (const file of sourceFiles) {
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
  }

  const packageInfo = {
    name: 'bxh-arena-group-stages',
    private: true,
    main: 'group-stages/firebase-entry.cjs',
    engines: { node: '22' },
    dependencies: { 'firebase-admin': '13.10.0', 'firebase-functions': '6.6.0' },
  };
  const firebaseConfig = {
    functions: [{ source: 'functions', codebase: 'arena-group-stages', runtime: 'nodejs22' }],
  };
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(packageInfo, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'firebase.json'), JSON.stringify(firebaseConfig, null, 2) + '\n', { flag: 'wx' });
  return { destination, codebase: 'arena-group-stages', functions: ['groupStageCommand'] };
}

if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('usage: node group-stages/prepare-release.cjs NEW_DIRECTORY');
  console.log(JSON.stringify(prepareRelease(path.resolve(__dirname, '..'), process.argv[2])));
}

module.exports = { prepareRelease };

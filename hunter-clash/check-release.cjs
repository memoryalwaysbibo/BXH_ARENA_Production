'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { releaseDecision } = require('./contracts.cjs');
function checkFile(file) {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (checkpoint.schemaVersion !== 1) throw Error('unsupported-checkpoint');
    return releaseDecision(checkpoint.evidence);
  } catch (error) {
    return { allowed: false, blockers: ['invalid-checkpoint'], reason: error.message };
  }
}
if (require.main === module) {
  const result = checkFile(process.argv[2] || path.join(__dirname, 'checkpoint.json'));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.allowed ? 0 : 1;
}
module.exports = { checkFile };

'use strict';
// Regression guard for iOS installed-PWA profile recovery (PR #547).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'modules/cloud/cloud-runtime.js'), 'utf8');
const profileRead = source.match(/async getUserProfile\(uid\)\{([\s\S]*?)\n    \},\n\n    async saveInterfaceTheme/);
assert.ok(profileRead, 'getUserProfile must exist');
assert.match(profileRead[1], /snap\.exists\(\) \? snap\.data\(\) : null/, 'Only absent document returns null');
assert.match(profileRead[1], /catch\(e\)\{[\s\S]*?throw failure;/, 'Read errors must propagate');
const create = source.match(/async completeNewPlayerProfile\(uid,[\s\S]*?\n    \},\n\n    \/\/ For an EXISTING/);
assert.ok(create, 'completeNewPlayerProfile must exist');
assert.match(create[0], /authHandle\?\.currentUser\?\.uid!==uid/, 'Creation requires matching current user');
assert.match(create[0], /getDocFromServer\(fx\.doc\(dbHandle, USERS_COLLECTION, uid\)\)/, 'Creation checks server document');
assert.match(create[0], /if\(existing\.exists\(\)\) return/, 'Creation refuses existing profile');
console.log('PASS PWA profile read and onboarding safeguards (static regression)');

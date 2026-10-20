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
const existing = source.match(/async completeExistingAccountPlayerProfile\(uid,[\s\S]*?\n    \},\n\n    async updateMyPlayerProfile/);
assert.ok(existing, 'existing-account completion must exist');
assert.match(existing[0], /existing\.profileCompleted===true/, 'completed profiles must not be initialized again');
assert.doesNotMatch(existing[0], /realNameVerified\s*:\s*false/, 'existing verification must be preserved');
const status = source.match(/async getUserProfileStatus\(uid\)\{([\s\S]*?)\n    \},\n\n    async getUserProfile/);
assert.ok(status, 'PWA recovery status API must exist');
for (const value of ['auth_not_ready','auth_mismatch','not_found','found','permission_denied','read_failed']) {
  assert.ok(status[1].includes(value), 'PWA status missing: '+value);
}
assert.match(status[1], /getDocFromServer/, 'PWA recovery must query authoritative server data');
const core = fs.readFileSync(path.join(__dirname, '..', 'modules/main-app/core.js'), 'utf8');
assert.match(core, /data-action="player-profile-retry"/, 'Blocked profile screen needs retry control');
assert.match(core, /data-action="player-logout"/, 'Blocked profile screen needs sign-out control');
assert.match(core, /if\(action==="player-profile-retry"\)/, 'Retry handler must exist');
assert.match(core, /getUserProfileStatus\(pending\.uid\)/, 'Retry must query authoritative profile status');
assert.match(core, /const status=await window\.cloudAuth\.getUserProfileStatus\(pending\.uid\)/, 'Submit must check authoritative status');
assert.match(core, /status\.status==="found" && !isExistingAccount/, 'Existing accounts must not enter new account creation');
assert.match(core, /status\.status!=="found" && status\.status!=="not_found"/, 'Failed status must block writes');
assert.match(core, /status\.status==="not_found" && isExistingAccount/, 'Existing account completion must reject missing server profile');
console.log('PASS PWA profile read and onboarding safeguards (static regression)');

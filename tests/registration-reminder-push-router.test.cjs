'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sw=fs.readFileSync(path.join(__dirname,'..','firebase-messaging-sw.js'),'utf8');

assert.match(sw,/kind===['"]registration-reminder['"]/,'registration reminder route missing');
assert.match(sw,/BXH 報名提醒/,'registration reminder title missing');
assert.match(sw,/eventId:safe\(data\.eventId/,'eventId must be preserved');
assert.match(sw,/reminderMinutes:safe\(data\.reminderMinutes/,'reminderMinutes must be preserved');
assert.match(sw,/\['bxh-registration',data\.eventId,data\.openAt,data\.reminderMinutes\]/,'registration dedupe tag missing');
assert.match(sw,/\['bxh-call',kind,data\.code,data\.matchId,data\.sequence\]/,'court-call tag compatibility missing');
assert.match(sw,/u\.origin===self\.location\.origin/,'same-origin click guard missing');

console.log('registration reminder push router: PASS');

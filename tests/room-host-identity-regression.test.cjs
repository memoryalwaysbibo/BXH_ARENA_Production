'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
const update=source.slice(source.indexOf('async pushUpdate('),source.indexOf('async saveStaffAssignments('));
test('editing a room preserves the original creator and host rather than assigning the editor',()=>{
  assert.match(update,/const creatorUid=remoteDoc\.createdBy\|\|remoteState\?\.createdBy\|\|null/);
  assert.match(update,/privatePayload\.createdBy=creatorUid/);
  assert.match(update,/const creatorName=String\(remoteDoc\.createdByName/);
  assert.match(update,/privatePayload\.hostName=hostName/);
  assert.match(update,/publicPayload\.hostName=hostName/);
  assert.match(update,/const originalOwner=remoteDoc\.ownerUid\|\|remoteState\?\.ownerUid/);
  assert.match(update,/privatePayload\.ownerUid=originalOwner/);
  assert.match(update,/publicPayload\.ownerUid=originalOwner/);
});
test('the update path does not use the current editor as the authoritative host',()=>{
  const tx=update.slice(update.indexOf('await fx.runTransaction('));
  assert.doesNotMatch(tx,/hostName:\s*currentUserDisplayNameForWrites\(\)/);
  assert.match(tx,/const hostName=creatorName\|\|String\(remoteDoc\.hostName/);
});

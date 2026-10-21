'use strict';
// Isolated, in-memory experiment: no production Firebase connections or writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
const begin=source.indexOf('async pushUpdate(');
const end=source.indexOf('async saveStaffAssignments(',begin);
assert.ok(begin>=0&&end>begin,'cloud update implementation found');
const update=source.slice(begin,end);
const start=update.indexOf('const creatorUid=remoteDoc.createdBy');
const stop=update.indexOf('if(remoteState){',start);
assert.ok(start>=0&&stop>start,'owner preservation block found');
const preserve=new Function('remoteDoc','remoteState','data','privatePayload','publicPayload',update.slice(start,stop));
const SHIANG='PPW5moDMXqZ1bWpc3QGATd6f1653';
const BLACK='dFNwrNCZKASxabKsOCcQoMJkryA2';
function room(){return {createdBy:SHIANG,createdByName:'翔宇',ownerUid:SHIANG,hostName:'翔宇'};}
function simulate(action, remote, editor=BLACK){
 const data={createdBy:editor,ownerUid:editor,meta:{name:'北京麻辣鍋',action}};
 const privatePayload={createdBy:editor,createdByName:'黑爸',hostName:'黑爸'};
 const publicPayload={hostName:'黑爸',ownerUid:editor};
 preserve(remote,null,data,privatePayload,publicPayload);
 return {data,privatePayload,publicPayload};
}
for(const action of ['edit-settings','republish','resync','settlement','reopen']){
 test('original host survives '+action,()=>{
  const {data,privatePayload,publicPayload}=simulate(action,room());
  assert.equal(data.createdBy,SHIANG);
  assert.equal(data.ownerUid,SHIANG);
  assert.equal(privatePayload.createdBy,SHIANG);
  assert.equal(privatePayload.createdByName,'翔宇');
  assert.equal(privatePayload.hostName,'翔宇');
  assert.equal(publicPayload.hostName,'翔宇');
 });
}
test('missing creator name retains old label but requires data remediation',()=>{
 const {privatePayload}=simulate('legacy', {createdBy:SHIANG,hostName:'黑爸'});
 assert.equal(privatePayload.hostName,'黑爸');
});
test('public mirror is separate from top-level hostName and requires explicit display-source verification',()=>{
 const mirror=source.slice(source.indexOf('function buildPublicMirrorFields('),source.indexOf('function currentUserUidForWrites('));
 assert.ok(mirror.includes('eventInfo:buildPublicEventInfo(state)'));
 assert.ok(!/hostName\s*:/.test(mirror));
});

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

test('翔宇建立、黑爸編輯：實際執行主辦者保護區塊',()=>{
  const start=update.indexOf('const creatorUid=remoteDoc.createdBy');
  const end=update.indexOf('if(remoteState){',start);
  assert.ok(start>=0&&end>start,'room identity preservation block exists');
  const block=update.slice(start,end);
  const apply=new Function('remoteDoc','remoteState','data','privatePayload','publicPayload',block);
  const creator='PPW5moDMXqZ1bWpc3QGATd6f1653';
  const editor='dFNwrNCZKASxabKsOCcQoMJkryA2';
  const room={createdBy:editor,ownerUid:editor};
  const privatePayload={createdBy:editor,hostName:'黑爸',createdByName:'黑爸'};
  const publicPayload={hostName:'黑爸',ownerUid:editor};
  apply({createdBy:creator,createdByName:'翔宇',ownerUid:creator,hostName:'翔宇'},null,room,privatePayload,publicPayload);
  assert.equal(room.createdBy,creator);
  assert.equal(room.ownerUid,creator);
  assert.equal(privatePayload.createdBy,creator);
  assert.equal(privatePayload.createdByName,'翔宇');
  assert.equal(privatePayload.hostName,'翔宇');
  assert.equal(publicPayload.hostName,'翔宇');
  assert.equal(publicPayload.ownerUid,creator);
});
test('歷史房間缺少建立者姓名時，不偽造編輯者為房主',()=>{
  const start=update.indexOf('const creatorUid=remoteDoc.createdBy');
  const end=update.indexOf('if(remoteState){',start);
  const apply=new Function('remoteDoc','remoteState','data','privatePayload','publicPayload',update.slice(start,end));
  const data={createdBy:'editor'};
  const priv={createdBy:'editor'};
  const pub={hostName:'editor'};
  apply({createdBy:'original',hostName:'legacy-host'},null,data,priv,pub);
  assert.equal(data.createdBy,'original');
  assert.equal(priv.hostName,'legacy-host');
  assert.equal(pub.hostName,'legacy-host');
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {removalReason,historyView,mayReadReason}=require('./history.cjs');
test('other removal reason requires explanation; preset reason allows optional note',()=>{
 assert.throws(()=>removalReason('other','  '),/other-reason-required/);assert.throws(()=>removalReason('fake','x'),/reason-required/);
 assert.equal(removalReason('inactive','').label,'長期未活躍');assert.equal(removalReason('other',' 測試 ').note,'測試');
});
test('date and time are separate Taiwan values and retain historical operator name',()=>{
 const v=historyView({occurredAt:Date.parse('2026-10-27T10:10:00Z'),subjectName:'小賈',actorName:'黑爸',actorRole:'captain',method:'remove'});
 assert.deepEqual(v,{name:'小賈',date:'2026/10/27',time:'18:10',method:'隊長－黑爸移除'});
});
test('removal reasons limited to subject and current leadership',()=>{
 const record={subjectUid:'removed'},team={captainUid:'c',memberUids:['c','d','m'],roles:{d:'deputy'}};
 for(const viewerUid of ['removed','c','d'])assert.equal(mayReadReason({viewerUid,record,team}),true);
 for(const viewerUid of ['m','outsider',null])assert.equal(!!mayReadReason({viewerUid,record,team}),false);
});

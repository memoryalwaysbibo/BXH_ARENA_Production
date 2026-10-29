'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('../functions/service.cjs'),{MockDB,user,fixture}=require('./mock-db.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNf8AAAAASUVORK5CYII=';
const request=(uid,action,extra={})=>({auth:{uid},data:{action,...extra}});
const entry=extra=>({decisions:0,events:0,size:null,precision:'unknown',period:'2026年初',note:'依印象',...extra});
function setup(seed=fixture(),options={}){const db=new MockDB(seed);return {db,handle:createService(db,{clock:()=>10000,...options})};}
const op=(operationId,expectedRevision,extra={})=>({targetUid:'alice',operationId,expectedRevision,...extra});
const error=reason=>e=>e.message===reason;

test('disabled by default, authenticated self read only; test/inactive actors denied',async()=>{
  const {db,handle}=setup();
  await assert.rejects(handle({data:{action:'get'}}),error('auth-required'));
  await assert.rejects(handle(request('alice','get',{targetUid:'admin'})),error('self-only'));
  db.put('systemConfig/refereeCertificatesV1',{enabled:false});
  await assert.rejects(handle(request('alice','get')),error('referee-certificates-disabled'));
  assert.equal(db.read('refereeCertificates/alice'),undefined);
  db.put('systemConfig/refereeCertificatesV1',{enabled:true});
  for(const patch of [{active:false},{isTestAccount:true},{role:'tester'},{accountStatus:'frozen'},{deleted:true}]){
    db.put('users/alice',user('player',patch));await assert.rejects(handle(request('alice','get')),error('active-nontest-account-required'));
  }
});
test('get issues L1 once under concurrent transaction retries; numbers never reuse after withdrawal',async()=>{
  const {db,handle}=setup();
  const results=await Promise.all([handle(request('alice','get')),handle(request('alice','get'))]);
  for(const result of results){assert.equal(result.snapshot.certificate.number,'R000001');assert.equal(result.snapshot.certificate.awardedLevel,1);assert.equal(result.snapshot.revision,1);}
  assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,1);
  assert.equal(db.list('refereeCertificates/alice/audit').length,1);
  const room=db.read('tournaments/BXH-AAAA'),state=JSON.parse(room.data);state.matches[0].completed=false;db.put('tournaments/BXH-AAAA',{...room,data:JSON.stringify(state)});
  const withdrawn=await handle(request('alice','get'));assert.equal(withdrawn.snapshot.stats.decisions,0);assert.equal(withdrawn.snapshot.certificate.number,'R000001');assert.equal(withdrawn.snapshot.certificate.awardedLevel,1);
  Object.entries(fixture({uid:'bob',code:'BXH-BBBB'})).filter(([p])=>!p.startsWith('systemConfig/')&&p!=='users/admin').forEach(([p,v])=>db.put(p,v));
  assert.equal((await handle(request('bob','get'))).snapshot.certificate.number,'R000002');
});
test('two referees concurrently receive distinct permanent numbers',async()=>{
  const seed={...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})};const {db,handle}=setup(seed);
  const snapshots=(await Promise.all([handle(request('alice','get')),handle(request('bob','get'))])).map(r=>r.snapshot);
  assert.deepEqual(new Set(snapshots.map(s=>s.certificate.number)),new Set(['R000001','R000002']));assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,2);
});
test('empty self has null certificate and revision zero without fabricated counts',async()=>{
  const {db,handle}=setup({'systemConfig/refereeCertificatesV1':{enabled:true},'users/alice':user()});
  const result=await handle(request('alice','get'));assert.equal(result.snapshot.certificate,null);assert.equal(result.snapshot.revision,0);assert.equal(result.snapshot.stats.decisions,0);assert.equal(result.snapshot.stats.eventCount,0);assert.equal(db.commits,0);
});
test('only super_admin mutates backfills; ordinary admin and self cannot',async()=>{
  const {db,handle}=setup();db.put('users/admin2',user('admin'));
  const payload=op('backfill_0001',0,{entry:entry({decisions:10})});
  for(const uid of ['alice','admin2'])await assert.rejects(handle(request(uid,'saveBackfill',payload)),error('super-admin-required'));
  assert.equal(db.list('refereeCertificates/alice/records').length,0);
});
test('backfill create/edit/revoke/restore counts only current active version and retains audit',async()=>{
  const {db,handle}=setup();let result=await handle(request('alice','get'));
  const create=op('backfill_0002',result.snapshot.revision,{entry:entry({decisions:199,events:3,size:128,precision:'exact'})});
  result=await handle(request('admin','saveBackfill',create));
  assert.equal(result.snapshot.stats.decisions,200);assert.equal(result.snapshot.stats.eventCount,4);assert.equal(result.snapshot.eligibleLevel,5);assert.equal(result.snapshot.certificate.awardedLevel,1);
  const id=result.snapshot.backfills[0].id;
  result=await handle(request('admin','grant',op('grant_rank_005',result.snapshot.revision,{level:5})));
  result=await handle(request('admin','saveBackfill',op('backfill_edit2',result.snapshot.revision,{entry:{id,...entry({decisions:19,events:2,size:96,precision:'at_least'})}})));
  assert.equal(result.snapshot.stats.decisions,20);assert.equal(result.snapshot.stats.eventCount,3);assert.equal(result.snapshot.stats.milestones[100],0);assert.equal(result.snapshot.certificate.awardedLevel,5);
  assert.equal(result.snapshot.backfills[0].history.length,2);
  result=await handle(request('admin','revokeBackfill',op('backfill_revoke2',result.snapshot.revision,{entryId:id})));
  assert.equal(result.snapshot.stats.decisions,1);assert.equal(result.snapshot.stats.eventCount,1);assert.equal(result.snapshot.backfills[0].status,'revoked');assert.equal(result.snapshot.certificate.awardedLevel,5);
  result=await handle(request('admin','restoreBackfill',op('backfill_restore2',result.snapshot.revision,{entryId:id})));
  assert.equal(result.snapshot.stats.decisions,20);assert.equal(result.snapshot.backfills[0].history.length,4);assert.equal(db.list('refereeCertificates/alice/records').length,1);
  assert.equal(result.snapshot.backfills[0].source,'official-memory-estimate');assert.equal(db.read('refereeCertificates/alice/records/'+id).source,'official-memory-estimate');
});
test('receipt handles same-operation retries before revision check but rejects changed payload or revoked actor',async()=>{
  const {db,handle}=setup();await handle(request('alice','get'));
  const payload=op('dedupe_operation',1,{entry:entry({decisions:10})});
  const first=await handle(request('admin','saveBackfill',payload));
  const again=await handle(request('admin','saveBackfill',payload));assert.equal(again.replayed,true);assert.equal(again.snapshot.revision,first.snapshot.revision);assert.equal(again.snapshot.stats.decisions,11);
  await assert.rejects(handle(request('admin','saveBackfill',{...payload,entry:entry({decisions:20})})),error('operation-conflict'));
  db.put('users/admin',user('player'));
  await assert.rejects(handle(request('admin','saveBackfill',payload)),error('super-admin-required'));assert.equal(db.list('refereeCertificates/alice/records').length,1);
});
test('concurrent revisions cannot both commit separate backfills',async()=>{
  const {db,handle}=setup();await handle(request('alice','get'));
  const results=await Promise.allSettled(['parallel_AAA','parallel_BBB'].map(id=>handle(request('admin','saveBackfill',op(id,1,{entry:entry({decisions:10})})))));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.message,'revision-conflict');assert.equal(db.list('refereeCertificates/alice/records').length,1);
});
test('grant rechecks server totals and live authorization, not client-supplied eligibility',async()=>{
  const {db,handle}=setup(fixture({decisions:20}));await handle(request('alice','get'));
  await assert.rejects(handle(request('admin','grant',op('grant_wrong_99',1,{level:9,eligibleLevel:9}))),error('rank-not-eligible'));
  let changed=false;
  db.beforeCommit=({writes})=>{
    if(!changed&&writes.some(w=>w.path.startsWith('refereeCertificateOperations/'))){changed=true;const room=db.read('tournaments/BXH-AAAA'),state=JSON.parse(room.data);state.matches[0].completed=false;db.put('tournaments/BXH-AAAA',{...room,data:JSON.stringify(state)});}
  };
  await assert.rejects(handle(request('admin','grant',op('grant_stale_02',1,{level:2}))),error('rank-not-eligible'));
  assert.equal(db.read('refereeCertificates/alice').awardedLevel,1);
});
test('actor revocation during a transaction aborts all receipt/profile/number writes',async()=>{
  const {db,handle}=setup();let changed=false;
  db.beforeCommit=({writes})=>{if(!changed&&writes.length){changed=true;db.put('users/admin',user('player'));}};
  await assert.rejects(handle(request('admin','saveBackfill',op('revoked_midflight',0,{entry:entry({decisions:1})}))),error('super-admin-required'));
  assert.equal(db.read('refereeCertificates/alice'),undefined);assert.equal(db.read('refereeCertificateSystem/numbering'),undefined);assert.equal(db.list('refereeCertificateOperations').length,0);
});
test('chief is globally single with global revision; assignment never changes earned grade',async()=>{
  const seed={...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})};const {db,handle}=setup(seed);
  await handle(request('alice','get'));await handle(request('bob','get'));
  let result=await handle(request('admin','setChief',op('chief_alice_01',1,{appointed:true,expectedChiefRevision:0})));
  assert.equal(result.snapshot.certificate.isChief,true);assert.equal(result.snapshot.certificate.awardedLevel,1);
  await assert.rejects(handle(request('admin','setChief',{...op('chief_bob_bad',1,{appointed:true,expectedChiefRevision:0}),targetUid:'bob'})),error('chief-revision-conflict'));
  result=await handle(request('admin','setChief',{...op('chief_bob_good',1,{appointed:true,expectedChiefRevision:1}),targetUid:'bob'}));
  assert.equal(result.snapshot.certificate.isChief,true);assert.equal((await handle(request('alice','get'))).snapshot.certificate.isChief,false);assert.equal(db.read('refereeCertificateSystem/chief').uid,'bob');
  const trail=db.list('refereeCertificateSystem/chief/audit').map(([,row])=>row);assert.equal(trail.length,2);assert.ok(trail.some(row=>row.previousUid==='alice'&&row.uid==='bob'));
});
test('inactive chief cannot be newly appointed but can be removed even after becoming a test account',async()=>{
  const {db,handle}=setup();await handle(request('alice','get'));
  db.put('users/alice',user('player',{active:false}));
  await assert.rejects(handle(request('admin','setChief',op('chief_inactive',1,{appointed:true,expectedChiefRevision:0}))),error('chief-target-inactive'));
  db.put('users/alice',user());
  const assigned=await handle(request('admin','setChief',op('chief_active_01',1,{appointed:true,expectedChiefRevision:0})));
  db.put('users/alice',user('tester',{active:false,isTestAccount:true}));
  const removed=await handle(request('admin','setChief',op('chief_remove_01',assigned.snapshot.revision,{appointed:false,expectedChiefRevision:1})));
  assert.equal(removed.snapshot.isChief,false);assert.equal(db.read('refereeCertificateSystem/chief').uid,null);
});
test('self photo is allowed and cannot read/change another person; audit stores no image bytes',async()=>{
  const {db,handle}=setup();await handle(request('alice','get'));
  const result=await handle(request('alice','photo',op('photo_alice_01',1,{dataUrl:PNG})));
  assert.equal(result.snapshot.certificate.photoDataUrl,PNG);
  await assert.rejects(handle(request('alice','photo',{...op('photo_admin_01',0,{dataUrl:PNG}),targetUid:'admin'})),error('super-admin-required'));
  assert.ok(!JSON.stringify(db.list('refereeCertificates/alice/audit')).includes(PNG));assert.ok(!JSON.stringify(db.list('refereeCertificateOperations')).includes(PNG));
});
test('photo before the first decision stays readable without issuing a certificate or number',async()=>{
  const {db,handle}=setup({'systemConfig/refereeCertificatesV1':{enabled:true},'users/alice':user()});
  const result=await handle(request('alice','photo',op('photo_before_L1',0,{dataUrl:PNG})));
  assert.equal(result.snapshot.certificate,null);assert.equal(result.snapshot.photoDataUrl,PNG);assert.equal(result.snapshot.revision,1);
  assert.equal((await handle(request('alice','get'))).snapshot.photoDataUrl,PNG);assert.equal(db.read('refereeCertificateSystem/numbering'),undefined);
});
test('bounded search is super-only and returns only minimal identity fields',async()=>{
  const {db,handle}=setup();db.put('users/bob',user('staff',{realName:'陳甲',email:'private@example.invalid'}));db.put('users/bad',user('player',{realName:'陳乙',isTestAccount:true}));
  await assert.rejects(handle(request('alice','search',{query:'陳'})),error('super-admin-required'));
  const result=await handle(request('admin','search',{query:'陳'}));assert.deepEqual(result.items,[{uid:'bob',realName:'陳甲',nickname:'裁判測試',active:true,accountStatus:null}]);
  db.put('users/bob',user('staff',{active:false,realName:'陳甲'}));
  assert.equal((await handle(request('admin','search',{query:'陳'}))).items[0].uid,'bob');
  assert.equal((await handle(request('admin','search',{query:'bad'}))).items[0].uid,'bad');
});
test('new record cap refuses overflow without making existing records uneditable',async()=>{
  const {handle}=setup(fixture(),{limits:{backfills:1}});let result=await handle(request('admin','saveBackfill',op('record_cap_01',0,{entry:entry({decisions:1})})));
  const id=result.snapshot.backfills[0].id;
  await assert.rejects(handle(request('admin','saveBackfill',op('record_cap_02',result.snapshot.revision,{entry:entry({decisions:1})}))),error('backfill-limit-reached'));
  result=await handle(request('admin','saveBackfill',op('record_cap_edit',result.snapshot.revision,{entry:{id,...entry({decisions:2})}})));
  assert.equal(result.snapshot.stats.backfillDecisions,2);
});
test('history display limit does not truncate counts, block grants, or block later revocation',async()=>{
  const {db,handle}=setup(fixture(),{limits:{auditHistory:1}});
  let result=await handle(request('admin','saveBackfill',op('history_create_01',0,{entry:entry({decisions:199,events:3,size:128,precision:'exact'})})));
  const id=result.snapshot.backfills[0].id;
  result=await handle(request('admin','saveBackfill',op('history_edit_01',result.snapshot.revision,{entry:{id,...entry({decisions:200,events:3,size:128,precision:'exact'})}})));
  assert.equal(result.snapshot.historyTruncated,true);assert.equal(result.snapshot.incomplete,false);assert.equal(result.snapshot.stats.decisions,201);
  result=await handle(request('admin','grant',op('history_grant_05',result.snapshot.revision,{level:5})));
  assert.equal(result.snapshot.certificate.awardedLevel,5);assert.equal(result.snapshot.historyTruncated,true);
  result=await handle(request('admin','revokeBackfill',op('history_revoke_01',result.snapshot.revision,{entryId:id})));
  assert.equal(result.snapshot.stats.decisions,1);assert.equal(result.snapshot.backfills[0].history.length,1);assert.equal(result.snapshot.backfills[0].history[0].action,'revokeBackfill');
  assert.equal(result.snapshot.incomplete,false);assert.equal(db.list('refereeCertificates/alice/audit').length,4);
  const loaded=(await handle(request('alice','get'))).snapshot;
  assert.equal(loaded.historyTruncated,true);assert.equal(loaded.backfills[0].history[0].action,'revokeBackfill');
});

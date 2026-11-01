'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('../functions/service.cjs'),{createPublicSummary}=require('../functions/public-summary.cjs');
const {MockDB,user,fixture}=require('./mock-db.cjs'),I=require('../functions/identities.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNf8AAAAASUVORK5CYII=';
const request=(uid,action,data={})=>({auth:{uid},data:{action,...data}});
const op=(id,revision,data={})=>({targetUid:'alice',operationId:id,expectedRevision:revision,...data});
const error=reason=>e=>e.message===reason;
function setup(seed=fixture(),options={}){const db=new MockDB({'refereeCertificateSystem/numbering':{lastIssuedNumber:18},...seed});return {db,handle:createService(db,{clock:()=>10000,...options}),pub:createPublicSummary(db,{clock:()=>10000})};}
const entry=(extra={})=>({kind:'decision',decisions:1,events:0,size:null,precision:'unknown',sourceKey:'match:BXH-AAAA:m0',basis:'核實此場責任裁判；操作人可為他人',period:'2026',note:'private note',...extra});
async function approve(handle,uid='alice',id='approve_0001',revision=0,personId='person-alice'){
 return handle(request('admin','grant',{targetUid:uid,operationId:id,expectedRevision:revision,level:1,personId,basis:'人員身份經管理員明確核實'}));
}

test('get is pure and private; logs/photo/backfills never issue; inactive self may read own qualification',async()=>{
 const {db,handle}=setup();
 await assert.rejects(handle({data:{action:'get'}}),error('auth-required'));
 await assert.rejects(handle(request('alice','get',{targetUid:'admin'})),error('self-only'));
 const snap=(await handle(request('alice','get'))).snapshot;assert.equal(snap.certificate,null);assert.equal(snap.stats.decisions,0);assert.equal(snap.stats.pendingLogCount,1);assert.equal(db.commits,0);
 await handle(request('alice','photo',op('photo_before_approval',0,{dataUrl:PNG})));
 const saved=await handle(request('admin','saveBackfill',op('recognize_no_issue',1,{entry:entry()})));
 assert.equal(saved.snapshot.stats.decisions,1);assert.equal(saved.snapshot.certificate,null);assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,18);
 db.put('users/alice',user('player',{active:false}));assert.equal((await handle(request('alice','get'))).snapshot.certificate,null);
 db.put('systemConfig/refereeCertificatesV1',{enabled:false});await assert.rejects(handle(request('alice','get')),error('referee-certificates-disabled'));
});
test('only super_admin explicitly approves zero-experience L1 independent of target role/active',async()=>{
 const {db,handle}=setup({'systemConfig/refereeCertificatesV1':{enabled:true},'users/alice':user('player',{active:false}),'users/admin':user('super_admin'),'users/admin2':user('admin')});
 for(const who of ['alice','admin2'])await assert.rejects(handle(request(who,'grant',op('not_allowed_01',0,{level:1,personId:'person-alice',basis:'verified'}))),error(who==='alice'?'active-account-required':'super-admin-required'));
 const before=db.read('users/alice'),result=await approve(handle);
 assert.equal(result.snapshot.certificate.number,'R000019');assert.equal(result.snapshot.certificate.approvedBy,'admin');assert.equal(result.snapshot.stats.decisions,0);assert.equal(result.snapshot.certificate.status,'active');
 assert.deepEqual(db.read('users/alice'),before);assert.equal(db.read('refereeCertificatePersons/person-alice').primaryUid,'alice');
});
test('concurrent approval, lost reply replay and distinct identity contention do not duplicate numbers',async()=>{
 const {db,handle}=setup({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})});
 const result=await Promise.all([approve(handle),approve(handle)]);assert.equal(result[0].snapshot.certificate.number,result[1].snapshot.certificate.number);
 assert.equal(result[1].replayed,true);assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,19);
 assert.equal(db.list('refereeCertificates/alice/audit').length,1);
 await assert.rejects(approve(handle,'bob','approve_bob_01',0,'person-alice'),error('person-already-bound'));
 const b=await approve(handle,'bob','approve_bob_02',0,'person-bob');assert.equal(b.snapshot.certificate.number,'R000020');
 await assert.rejects(approve(handle,'alice','approve_again',1),error('certificate-already-issued'));
});
test('separate concurrent identities get permanent distinct numbers and stale revision fails',async()=>{
 const {db,handle}=setup({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})});
 const r=await Promise.all([approve(handle),approve(handle,'bob','approve_bob_03',0,'person-bob')]);assert.equal(new Set(r.map(x=>x.snapshot.certificate.number)).size,2);
 const results=await Promise.allSettled(['recognize_A','recognize_B'].map(id=>handle(request('admin','saveBackfill',op(id,1,{entry:entry()})))));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.message,'revision-conflict');
});
test('disable/restore are audited, replay-idempotent, keep number, never change role or seats',async()=>{
 const {db,handle}=setup();await approve(handle);const userBefore=db.read('users/alice'),roomBefore=db.read('tournaments/BXH-AAAA');
 const payload=op('disable_once_01',1,{basis:'明確暫停資格'});
 let r=await handle(request('admin','disable',payload));assert.equal(r.snapshot.certificate.status,'disabled');
 assert.equal((await handle(request('admin','disable',payload))).replayed,true);
 r=await handle(request('admin','restoreQualification',op('restore_once_01',2,{basis:'核實恢復'})));
 assert.equal(r.snapshot.certificate.status,'active');assert.equal(r.snapshot.certificate.number,'R000019');
 assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,19);assert.deepEqual(db.read('users/alice'),userBefore);assert.deepEqual(db.read('tournaments/BXH-AAAA'),roomBefore);
 assert.deepEqual(r.snapshot.qualificationHistory.map(x=>x.action),['grant','disable','restoreQualification']);
});
test('known alternate cannot be issued; explicit link never merges histories and rejects third-party ownership',async()=>{
 const seed={...fixture({uid:I.OWNER}),['users/'+I.ALIAS]:user(),['staffActivityLogs/'+I.ALIAS+'/matches/old']:{uid:I.ALIAS,tournamentCode:'BXH-AAAA',matchId:'m0'}};
 seed['refereeCertificateSystem/numbering']={lastIssuedNumber:0};seed['systemConfig/refereeCertificatesV1']={enabled:true,initialRosterApproved:true};
 const {db,handle}=setup(seed);
 await assert.rejects(approve(handle,I.ALIAS,'alias_approve_01',0,'person-alias'),error('known-alias-cannot-receive-certificate'));
 await approve(handle,I.OWNER,'owner_approve_01',0,'initial-01');
 const r=await handle(request('admin','linkAccount',{targetUid:I.OWNER,operationId:'link_alias_01',expectedRevision:1,aliasUid:I.ALIAS,basis:'owner explicitly verified same natural person'}));
 assert.equal(r.snapshot.stats.decisions,0);assert.equal(db.read('refereeCertificates/'+I.ALIAS),undefined);assert.equal(db.read('refereeCertificateUidBindings/'+I.ALIAS).primaryUid,I.OWNER);
 assert.equal(db.list('staffActivityLogs/'+I.ALIAS+'/matches').length,1);assert.equal(db.list('refereeCertificates/'+I.OWNER+'/records').length,0);
});
test('decision, event and auxiliary recognition separate; native ongoing final counts before event completion',async()=>{
 const {db,handle}=setup(fixture({size:148,archived:false}));
 let r=await handle(request('admin','saveBackfill',op('native_decision_01',0,{entry:entry()})));
 assert.equal(r.snapshot.stats.decisions,1);assert.equal(r.snapshot.stats.eventCount,0);
 r=await handle(request('admin','saveBackfill',op('auxiliary_01',1,{entry:entry({kind:'auxiliary',decisions:0,auxiliary:8,sourceKey:'historical:assist'})})));
 assert.equal(r.snapshot.stats.decisions,1);assert.equal(r.snapshot.stats.auxiliaryCount,8);
 const ev=entry({kind:'event',decisions:0,events:1,sourceKey:'event:BXH-AAAA',size:1000,precision:'exact'});
 await assert.rejects(handle(request('admin','saveBackfill',op('event_early_01',2,{entry:ev}))),error('event-not-completed'));
 const room=db.read('tournaments/BXH-AAAA'),state=JSON.parse(room.data);state.archiveStatus='completed';db.put('tournaments/BXH-AAAA',{...room,data:JSON.stringify(state)});
 r=await handle(request('admin','saveBackfill',op('event_done_01',2,{entry:ev})));
 assert.deepEqual(r.snapshot.stats.scales,{64:1,96:1,128:1});assert.equal(r.snapshot.stats.milestones[100],1);assert.equal(r.snapshot.stats.milestones[200],0);assert.equal(r.snapshot.stats.knownMaxSize,148);
});
test('recognition deduplication, edit/revoke/restore audit and current cancellation revalidation',async()=>{
 const {db,handle}=setup();let r=await handle(request('admin','saveBackfill',op('recognize_01',0,{entry:entry()})));const id=r.snapshot.backfills[0].id;
 await assert.rejects(handle(request('admin','saveBackfill',op('duplicate_01',1,{entry:entry()}))),error('duplicate-recognition-source'));
 r=await handle(request('admin','saveBackfill',op('recognize_edit',1,{entry:{...entry({basis:'補充責任依據'}),id}})));
 r=await handle(request('admin','revokeBackfill',op('recognize_revoke',2,{entryId:id})));assert.equal(r.snapshot.stats.decisions,0);
 r=await handle(request('admin','restoreBackfill',op('recognize_restore',3,{entryId:id})));assert.equal(r.snapshot.stats.decisions,1);assert.equal(r.snapshot.backfills[0].history.length,4);
 const room=db.read('tournaments/BXH-AAAA');db.put('tournaments/BXH-AAAA',{...room,eventCancelled:true});
 r=await handle(request('alice','get'));assert.equal(r.snapshot.stats.decisions,0);assert.equal(r.snapshot.stats.pendingBackfills,1);
});
test('cross-UID recognition needs explicit verified binding and never permits silent name matching',async()=>{
 const {db,handle}=setup({...fixture(),'users/alternate':user()});
 await assert.rejects(handle(request('admin','saveBackfill',op('cross_unverified',0,{entry:entry({sourceUid:'alternate'})}))),error('cross-account-link-unverified'));
 await approve(handle);await handle(request('admin','linkAccount',op('link_alternate_01',1,{aliasUid:'alternate',basis:'verified same person'})));
 const r=await handle(request('admin','saveBackfill',op('cross_verified',2,{entry:entry({sourceUid:'alternate'})})));
 assert.equal(r.snapshot.stats.decisions,1);assert.equal(r.snapshot.backfills[0].sourceUid,'alternate');
});
test('L2 gate stays explicit, zero experience cannot skip levels and current authority rechecked on retry',async()=>{
 const {db,handle}=setup();await approve(handle);
 await assert.rejects(handle(request('admin','grant',op('grant_l2_empty',1,{level:2}))),error('rank-not-eligible'));
 const payload=op('record_drop_reply',1,{entry:entry()});await handle(request('admin','saveBackfill',payload));assert.equal((await handle(request('admin','saveBackfill',payload))).replayed,true);
 db.put('users/admin',user('admin'));await assert.rejects(handle(request('admin','saveBackfill',payload)),error('super-admin-required'));
});
test('privilege revoked mid transaction aborts number/registry/receipt writes',async()=>{
 const {db,handle}=setup();let changed=false;db.beforeCommit=({writes})=>{if(!changed&&writes.length){changed=true;db.put('users/admin',user('player'));}};
 await assert.rejects(approve(handle),error('super-admin-required'));
 assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,18);assert.equal(db.list('refereeCertificatePersons').length,0);assert.equal(db.list('refereeCertificateOperations').length,0);
});
test('twenty individually keyed recognized decisions enable explicit L2 without automatic promotion',async()=>{
 const {db,handle}=setup();await approve(handle);
 const keys=Array.from({length:20},(_,i)=>'historical:verified-decision-'+i);
 let r=await handle(request('admin','saveBackfill',op('twenty_decisions',1,{entry:entry({sourceKey:keys[0],sourceKeys:keys,decisions:20})})));
 assert.equal(r.snapshot.stats.decisions,20);assert.equal(r.snapshot.eligibleLevel,2);assert.equal(r.snapshot.certificate.awardedLevel,1);
 r=await handle(request('admin','grant',op('explicit_l2_grant',2,{level:2})));
 assert.equal(r.snapshot.certificate.awardedLevel,2);assert.equal(r.snapshot.certificate.number,'R000019');
 assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,19);
});
test('public read separate, default closed, exact whitelist, no certificate hidden, disabled/expired current',async()=>{
 const {db,handle,pub}=setup();const req={data:{targetUid:'alice'}};
 await assert.rejects(pub(req),error('public-summary-disabled'));db.put('systemConfig/refereeCertificatesV1',{enabled:true,publicSummaryEnabled:true});
 assert.equal((await pub(req)).summary,null);await approve(handle);
 db.put('users/alice',user('player',{active:false,email:'secret',phone:'secret',realName:'姓名'}));
 let p=(await pub(req)).summary;assert.deepEqual(Object.keys(p).sort(),['experience','level','name','number','status']);assert.equal(p.status,'active');
 assert.ok(!/alice|admin|secret|basis|approvedBy|photo|audit|uid/i.test(JSON.stringify(p)));
 await handle(request('admin','disable',op('public_disable_01',1,{basis:'private suspension reason'})));
 assert.equal((await pub(req)).summary.status,'disabled');
 db.put('refereeCertificates/alice',{...db.read('refereeCertificates/alice'),qualificationStatus:'active',expiresAt:9999});assert.equal((await pub(req)).summary.status,'expired');
 const commits=db.commits;await pub(req);assert.equal(db.commits,commits);
});
test('initialization is only an ordered preview; the 0-log ninth candidate remains eligible for approval',()=>{
 const p=require('../functions/initial-preview.json');assert.equal(p.mode,'preview-only-no-writes');assert.equal(p.people.length,18);
 assert.deepEqual(p.people.map(x=>x.order),Array.from({length:18},(_,i)=>i+1));assert.equal(p.people[8].name,'林一棟');assert.equal(p.people[8].proposedNumber,'R000009');assert.equal(p.people[9].name,'黃啟睿');assert.equal(p.people.some(x=>x.uid===I.ALIAS),false);
});
test('initial 18 require explicit preview gate and strict order; later new people start at 19',async()=>{
 const plan=require('../functions/initial-preview.json'),seed={'systemConfig/refereeCertificatesV1':{enabled:true},'users/admin':user('super_admin'),'refereeCertificateSystem/numbering':{lastIssuedNumber:0}};
 for(const p of plan.people)seed['users/'+p.uid]=user('player',{realName:p.name});
 const {db,handle}=setup(seed);
 const first=plan.people[0],ninth=plan.people[8];
 await assert.rejects(approve(handle,first.uid,'initial_gate_01',0,first.personId),error('initialization-preview-only'));
 db.put('systemConfig/refereeCertificatesV1',{enabled:true,initialRosterApproved:true});
 await assert.rejects(approve(handle,ninth.uid,'initial_ninth_early',0,ninth.personId),error('initial-sequence-not-ready'));
 for(const p of plan.people){const r=await approve(handle,p.uid,'initial_approve_'+p.order,0,p.personId);assert.equal(r.snapshot.certificate.number,p.proposedNumber);assert.equal(r.snapshot.stats.decisions,0);}
 db.put('users/new-person',user());const r=await approve(handle,'new-person','after_eighteen_01',0,'new-verified-person');assert.equal(r.snapshot.certificate.number,'R000019');
});
test('explicit native recognition removes pending label but does not double-count system/operator evidence',async()=>{
 const {handle}=setup();const r=await handle(request('admin','saveBackfill',op('recognize_pending',0,{entry:entry()})));
 assert.equal(r.snapshot.stats.pendingLogCount,0);assert.equal(r.snapshot.stats.systemDecisions,0);assert.equal(r.snapshot.stats.backfillDecisions,1);assert.equal(r.snapshot.systemRecords[0].status,'recognized_manual');
});

test('recompleted changed result is pending until explicit new recognition, with server fingerprint audit',async()=>{
 const {db,handle}=setup();let r=await handle(request('admin','saveBackfill',op('original_result',0,{entry:entry()})));
 const row=r.snapshot.backfills[0],old=row.sourceFingerprints;
 const room=db.read('tournaments/BXH-AAAA'),state=JSON.parse(room.data),m=state.matches.find(m=>m.id==='m0');
 m.winnerId=m.winnerId===m.a.playerId?m.b.playerId:m.a.playerId;m.confirmedByUid='bob';m.confirmedAt=9999;m.refereeSeatScoreRevision=42;
 db.put('tournaments/BXH-AAAA',{...room,data:JSON.stringify(state)});
 r=await handle(request('alice','get'));assert.equal(r.snapshot.stats.decisions,0);assert.equal(r.snapshot.backfills[0].recognitionReason,'source-result-changed-requires-recognition');
 r=await handle(request('admin','saveBackfill',op('rerecognize_result',1,{entry:{...entry(),id:row.id,sourceFingerprints:old}})));
 assert.equal(r.snapshot.stats.decisions,1);assert.notDeepEqual(r.snapshot.backfills[0].sourceFingerprints,old);
 assert.deepEqual(r.snapshot.backfills[0].history[1].before.sourceFingerprints,old);
});
test('global responsibility claim serializes different UID recognition; revoke enables explicit reassignment; restore conflicts',async()=>{
 const {db,handle}=setup({...fixture(),'users/bob':user()});
 const make=uid=>handle(request('admin','saveBackfill',{targetUid:uid,operationId:'claim_match_'+uid,expectedRevision:0,entry:entry()}));
 const results=await Promise.allSettled(['alice','bob'].map(make));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.message,'decision-responsibility-already-claimed');
 const winner=results[0].status==='fulfilled'?'alice':'bob',other=winner==='alice'?'bob':'alice',row=results.find(r=>r.status==='fulfilled').value.snapshot.backfills[0];
 await handle(request('admin','revokeBackfill',{targetUid:winner,operationId:'release_match_claim',expectedRevision:1,entryId:row.id}));
 await make(other);
 await assert.rejects(handle(request('admin','restoreBackfill',{targetUid:winner,operationId:'restore_claim_conflict',expectedRevision:2,entryId:row.id})),error('decision-responsibility-already-claimed'));
 assert.equal((await handle(request(winner,'get'))).snapshot.stats.decisions,0);assert.equal((await handle(request(other,'get'))).snapshot.stats.decisions,1);
 assert.equal(db.list('refereeCertificateDecisionClaims').length,1);
});
test('inactive deleted frozen and test actors cannot mutate photos; self pure read remains permitted',async()=>{
 for(const change of [{active:false},{deleted:true},{accountStatus:'frozen'},{role:'tester'},{isTestAccount:true}]){
  const {db,handle}=setup();db.put('users/alice',user('player',change));const before=db.commits;
  await assert.rejects(handle(request('alice','photo',op('blocked_photo_01',0,{dataUrl:''}))),error('active-account-required'));
  await handle(request('alice','get'));assert.equal(db.commits,before);
 }
});
test('photo transaction retries recheck actor revocation before any receipt or photo writes',async()=>{
 const {db,handle}=setup();let changed=false;db.beforeCommit=({writes})=>{if(writes.length&&!changed){changed=true;db.put('users/alice',user('player',{accountStatus:'frozen'}));}};
 await assert.rejects(handle(request('alice','photo',op('photo_retry_frozen',0,{dataUrl:PNG}))),error('active-account-required'));
 assert.equal(db.read('refereeCertificates/alice'),undefined);assert.equal(db.list('refereeCertificateOperations').length,0);
});

test('bounded search is super-only, capped and minimal; exact historical UID remains available',async()=>{
 const {db,handle}=setup(fixture(),{limits:{searchPerField:1}});
 db.put('users/bob',user('staff',{realName:'陳甲',email:'private@example.invalid'}));db.put('users/carol',user('player',{realName:'陳乙'}));db.put('users/test-user',user('tester',{realName:'測試'}));
 await assert.rejects(handle(request('alice','search',{query:'陳'})),error('super-admin-required'));
 const r=await handle(request('admin','search',{query:'陳'}));assert.equal(r.items.length,1);assert.equal(r.incomplete,true);assert.ok(!JSON.stringify(r).includes('email'));
 assert.deepEqual(Object.keys(r.items[0]).sort(),['accountStatus','active','nickname','realName','uid']);
 assert.equal((await handle(request('admin','search',{query:'test-user'}))).items[0].uid,'test-user');
});
test('record cap denies new row but existing row can be edited and revoked',async()=>{
 const {handle}=setup(fixture(),{limits:{backfills:1}});
 let r=await handle(request('admin','saveBackfill',op('cap_first_row',0,{entry:entry()})));const id=r.snapshot.backfills[0].id;
 await assert.rejects(handle(request('admin','saveBackfill',op('cap_overflow_row',1,{entry:entry({sourceKey:'historical:other'})}))),error('backfill-limit-reached'));
 r=await handle(request('admin','saveBackfill',op('cap_edit_row',1,{entry:{...entry({basis:'updated verified basis'}),id}})));assert.equal(r.snapshot.stats.decisions,1);
 r=await handle(request('admin','revokeBackfill',op('cap_revoke_row',2,{entryId:id})));assert.equal(r.snapshot.stats.decisions,0);
});
test('history display truncation does not truncate totals, block eligible grants or later revocation',async()=>{
 const {db,handle}=setup(fixture(),{limits:{auditHistory:1}});await approve(handle);
 const keys=Array.from({length:20},(_,i)=>'historical:history-'+i);
 let r=await handle(request('admin','saveBackfill',op('history_twenty',1,{entry:entry({sourceKey:keys[0],sourceKeys:keys,decisions:20})})));const id=r.snapshot.backfills[0].id;
 assert.equal(r.snapshot.historyTruncated,true);assert.equal(r.snapshot.incomplete,false);assert.equal(r.snapshot.stats.decisions,20);
 r=await handle(request('admin','grant',op('history_l2_grant',2,{level:2})));assert.equal(r.snapshot.certificate.awardedLevel,2);
 r=await handle(request('admin','revokeBackfill',op('history_revoke',3,{entryId:id})));assert.equal(r.snapshot.stats.decisions,0);assert.equal(r.snapshot.backfills[0].history.length,1);
 assert.equal((await handle(request('alice','get'))).snapshot.historyTruncated,true);assert.equal(db.list('refereeCertificates/alice/audit').length,4);
});
test('photo before approval persists without issuance, rejects other target and invalid bytes, audit omits photo',async()=>{
 const {db,handle}=setup();let r=await handle(request('alice','photo',op('preapproval_photo',0,{dataUrl:PNG})));
 assert.equal(r.snapshot.photoDataUrl,PNG);assert.equal(r.snapshot.certificate,null);assert.equal((await handle(request('alice','get'))).snapshot.photoDataUrl,PNG);
 await assert.rejects(handle(request('alice','photo',{...op('other_target_photo',0,{dataUrl:PNG}),targetUid:'admin'})),error('super-admin-required'));
 for(const dataUrl of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+'A'.repeat(600001),'https://example.invalid/x.png'])await assert.rejects(handle(request('alice','photo',op('invalid_photo_input',1,{dataUrl}))));
 assert.ok(!JSON.stringify(db.list('refereeCertificates/alice/audit')).includes(PNG));assert.ok(!JSON.stringify(db.list('refereeCertificateOperations')).includes(PNG));
 assert.equal(db.read('refereeCertificateSystem/numbering').lastIssuedNumber,18);
});
test('global chief contention uses shared revision; removal works after target becomes test account',async()=>{
 const {db,handle}=setup({...fixture(),'users/bob':user()});await approve(handle);await approve(handle,'bob','chief_approve_bob',0,'person-bob');
 const result=await Promise.allSettled(['alice','bob'].map(uid=>handle(request('admin','setChief',{targetUid:uid,operationId:'chief_race_'+uid,expectedRevision:1,expectedChiefRevision:0,appointed:true}))));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.message,'chief-revision-conflict');
 const uid=db.read('refereeCertificateSystem/chief').uid;db.put('users/'+uid,user('tester',{active:false}));
 const r=await handle(request('admin','setChief',{targetUid:uid,operationId:'chief_remove_test',expectedRevision:2,expectedChiefRevision:1,appointed:false}));
 assert.equal(r.snapshot.certificate.awardedLevel,1);assert.equal(r.snapshot.isChief,false);assert.equal(db.list('refereeCertificateSystem/chief/audit').length,2);
});
test('incomplete sources block L2 but not explicit zero-experience L1; ledger overflow blocks edits',async()=>{
 const {db,handle}=setup(fixture({decisions:2}),{limits:{logs:1,backfills:1}});await approve(handle);
 await assert.rejects(handle(request('admin','grant',op('incomplete_l2',1,{level:2}))),error('sources-incomplete'));
 for(const id of ['a','b'])db.put('refereeCertificates/alice/records/'+id,{...entry({sourceKey:'historical:'+id}),status:'active',revision:1});
 assert.equal((await handle(request('alice','get'))).snapshot.incomplete,true);
 await assert.rejects(handle(request('admin','revokeBackfill',op('overflow_revoke',1,{entryId:'a'}))),error('ledger-incomplete'));
});
test('initial preview is read-only, outsiders cannot preempt 18 and inconsistent original counter requires reconciliation',()=>{
 const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
 const script=path.join(__dirname,'../../scripts/preview-referee-initialization.cjs'),text=fs.readFileSync(script,'utf8');assert.ok(!/firebase|writeFile|fetch\(/.test(text));
 const preview=JSON.parse(cp.execFileSync(process.execPath,[script]));assert.equal(preview.mode,'preview-only-no-writes');
 assert.throws(()=>I.checkSequence('outsider',0,true));assert.throws(()=>I.checkSequence(I.OWNER,18,true),/reconciliation/);
});
test('receipt rejects changed payload and server ignores forged client eligibility',async()=>{
 const {handle}=setup();const payload=op('receipt_payload_test',0,{entry:entry()});await handle(request('admin','saveBackfill',payload));
 await assert.rejects(handle(request('admin','saveBackfill',{...payload,entry:entry({basis:'different payload'})})),error('operation-conflict'));
 await approve(handle,'alice','approve_after_record',1);
 await assert.rejects(handle(request('admin','grant',op('forged_level_grant',2,{level:9,eligibleLevel:9,stats:{decisions:999999}}))),error('rank-not-eligible'));
});
test('each changed confirmation or result field invalidates previously recognized final match',async()=>{
 for(const [field,value] of [['scoreA',99],['confirmedByUid','other'],['confirmedAt',9999],['completedAt',9999],['refereeSeatScoreRevision',42]]){
  const {db,handle}=setup();await handle(request('admin','saveBackfill',op('fingerprint_field',0,{entry:entry()})));
  const room=db.read('tournaments/BXH-AAAA'),state=JSON.parse(room.data);state.matches[0][field]=value;db.put('tournaments/BXH-AAAA',{...room,data:JSON.stringify(state)});
  assert.equal((await handle(request('alice','get'))).snapshot.stats.decisions,0,field);
 }
});
test('disabled qualification cannot acquire new global chief title; target account status stays independent',async()=>{
 const {db,handle}=setup();await approve(handle);await handle(request('admin','disable',op('chief_disable',1,{basis:'verified suspension'})));
 await assert.rejects(handle(request('admin','setChief',op('disabled_chief',2,{appointed:true,expectedChiefRevision:0}))),error('chief-certificate-not-active'));
 await handle(request('admin','restoreQualification',op('chief_restore',2,{basis:'verified restoration'})));db.put('users/alice',user('player',{active:false}));
 assert.equal((await handle(request('admin','setChief',op('inactive_account_chief',3,{appointed:true,expectedChiefRevision:0})))).snapshot.isChief,true);
});

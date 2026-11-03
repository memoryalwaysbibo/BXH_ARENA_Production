'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../functions/domain.cjs'),{createService}=require('../functions/service.cjs');
const {MockDB,user,fixture}=require('./mock-db.cjs');
const req=(uid,action,data={})=>({auth:{uid},data:{action,...data}});
const legacy=(uid,code,id)=>'historical:legacy_'+D.hash(JSON.stringify([uid,code,id]));
const entry=(keys)=>({kind:'decision',decisions:keys.length,events:0,auxiliary:0,size:null,precision:'unknown',sourceKeys:keys,sourceKey:keys[0],sourceUid:null,basis:'已授權歷史逐局認列',period:'歷史快照',note:''});
function setup(seed=fixture(),options={}) {const db=new MockDB(seed);return {db,call:createService(db,{clock:()=>10000,...options})};}
const approved={number:'R000019',personId:'person-alice',approvedBy:'admin',approvedAt:1,issuedAt:1,awardedLevel:1,qualificationStatus:'active',revision:0};
const op={operationId:'auto_progress_01',expectedRevision:0};

test('legacy approved exact tuples clear pending and recover one actual 128-person event, never duplicate decisions',async()=>{
 const {db,call}=setup(fixture({size:128,decisions:2}));
 const result=await call(req('admin','saveBackfill',{targetUid:'alice',...op,entry:entry(['m0','m1'].map(id=>legacy('alice','BXH-AAAA',id)))}));
 const s=result.snapshot;
 assert.equal(s.stats.decisions,2);assert.equal(s.stats.pendingLogCount,0);assert.equal(s.stats.eventCount,1);
 assert.deepEqual(s.stats.scales,{64:1,96:1,128:1});assert.equal(s.stats.milestones[100],1);
 assert(s.systemRecords.every(r=>r.status==='recognized_manual'));
 const again=(await call(req('alice','get'))).snapshot;
 assert.equal(again.stats.eventCount,1);assert.equal(db.commits,1,'get does not persist invented history');
});
test('a 96-person event counts 64/96 only; native event plus approved decision counts the event once',async()=>{
 const {call}=setup(fixture({size:96}));
 await call(req('admin','saveBackfill',{targetUid:'alice',...op,entry:entry([legacy('alice','BXH-AAAA','m0')])}));
 const s=(await call(req('admin','saveBackfill',{targetUid:'alice',operationId:'event_once_01',expectedRevision:1,
  entry:{kind:'event',events:1,decisions:0,size:null,precision:'unknown',sourceKey:'event:BXH-AAAA',basis:'活動執勤已核實',period:'2026',note:''}}))).snapshot;
 assert.equal(s.stats.eventCount,1);assert.deepEqual(s.stats.scales,{64:1,96:1,128:0});
});
test('missing/unfinished/test events never acquire capacity-based scale; unmatched pending log remains visible',async()=>{
 for(const changes of [{archived:false},{roomExtra:{testMode:true}},{stateExtra:{players:[],matches:[]}}]) {
  const {call}=setup(fixture({size:128,decisions:2,...changes}));
  const s=(await call(req('admin','saveBackfill',{targetUid:'alice',...op,entry:entry([legacy('alice','BXH-AAAA','m0')])}))).snapshot;
  assert.equal(s.stats.eventCount,0);assert.deepEqual(s.stats.scales,{64:0,96:0,128:0});
  assert.equal(s.stats.decisions,1);
 }
 const {db,call}=setup(fixture({decisions:2}));db.rows.delete('tournaments/BXH-AAAA');
 const s=(await call(req('admin','saveBackfill',{targetUid:'alice',...op,entry:entry([legacy('alice','BXH-AAAA','m0')])}))).snapshot;
 assert.equal(s.stats.pendingLogCount,1);assert.equal(s.systemRecords[0].status,'recognized_manual');assert.equal(s.systemRecords[1].status,'pending');
});
test('native and legacy aliases cannot double-count the same decision even across ledger rows',()=>{
 const source=D.emptySource();source.systemRecords=[{identityValid:true,sourceUid:'alice',tournamentCode:'BXH-AAAA',matchId:'m0',status:'pending'}];source.pendingLogCount=1;
 const entries=[legacy('alice','BXH-AAAA','m0'),'match:BXH-AAAA:m0'].map(key=>({...entry([key]),status:'active',recognitionValid:true}));
 assert.equal(D.aggregate(source,entries).decisions,1);assert.equal(D.aggregate(source,entries).pendingLogCount,0);
 const other=[{...entry([legacy('bob','BXH-AAAA','m0')]),status:'active',recognitionValid:true}];
 assert.equal(D.aggregate(source,other).pendingLogCount,1,'another account hash never clears this account log');
});
test('private paginated list includes inactive certificates, sorts by permanent number, denies ordinary users',async()=>{
 const seed=fixture();for(let i=1;i<=43;i++)seed['refereeCertificates/u'+i]={number:'R'+String(i).padStart(6,'0'),awardedLevel:2,qualificationStatus:i===1?'disabled':'active'};
 const {db,call}=setup(seed);
 await assert.rejects(call(req('alice','list')),/super-admin-required/);
 const a=await call(req('admin','list'));assert.equal(a.items.length,40);assert.equal(a.items[0].status,'disabled');assert.equal(a.nextCursor,'R000040');
 const b=await call(req('admin','list',{cursor:a.nextCursor}));assert.equal(b.items.length,3);assert.equal(b.nextCursor,null);assert.equal(b.items[0].number,'R000041');assert.equal(db.commits,0);
 await assert.rejects(call(req('admin','list',{cursor:'bad'})),/cursor-invalid/);
});
function seedProgress(extra={}) {return {...fixture(), 'refereeCertificates/alice':{...approved,...extra},
 'refereeCertificates/alice/records/old':{...entry(Array.from({length:50},(_,i)=>'historical:approved_'+i)),status:'active',revision:1},
 'refereeCertificates/alice/records/event':{kind:'event',decisions:0,events:1,size:128,precision:'exact',sourceKey:'historical:verified_event',sourceUid:null,basis:'已核實外部歷史賽事',period:'歷史',note:'',status:'active',revision:1}};}
test('approved self automatically receives highest eligible rank, audits once and replay never increments again',async()=>{
 const {db,call}=setup(seedProgress());const before=db.read('users/alice');
 const s=(await call(req('alice','syncProgress',op))).snapshot;
 assert.equal(s.certificate.awardedLevel,3);assert.equal(s.certificate.number,approved.number);assert.equal(s.certificate.approvedBy,'admin');
 assert.equal(s.qualificationHistory.at(-1).automatic,true);assert.equal(s.qualificationHistory.at(-1).fromLevel,1);
 assert.deepEqual(db.read('users/alice'),before);assert.equal(db.list('refereeCertificates/alice/audit').length,1);
 assert.equal((await call(req('alice','syncProgress',op))).replayed,true);assert.equal(db.commits,1);
 await assert.rejects(call(req('alice','syncProgress',{...op,operationId:'stale_auto_01'})),/revision-conflict/);
});
test('auto advancement never issues identity, downgrades, bypasses inactivity or promotes incomplete data',async()=>{
 for(const cert of [null,{...approved,qualificationStatus:'disabled'},{...approved,expiresAt:9999}]) {
  const seed=seedProgress();if(cert)seed['refereeCertificates/alice']=cert;else delete seed['refereeCertificates/alice'];
  const {db,call}=setup(seed);await assert.rejects(call(req('alice','syncProgress',op)));assert.equal(db.commits,0);
 }
 const {call}=setup(seedProgress({awardedLevel:7}));assert.equal((await call(req('alice','syncProgress',op))).snapshot.certificate.awardedLevel,7);
 const partial=setup(seedProgress(),{limits:{backfills:1}});await assert.rejects(partial.call(req('alice','syncProgress',op)),/sources-incomplete/);assert.equal(partial.db.commits,0);
 const other=setup(seedProgress());await assert.rejects(other.call(req('alice','syncProgress',{...op,targetUid:'admin'})),/super-admin-required/);
 other.db.put('users/alice',user('player',{active:false}));await assert.rejects(other.call(req('alice','syncProgress',op)),/active-account-required/);
});

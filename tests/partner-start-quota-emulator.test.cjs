'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const project='demo-bxh-partner-start';
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8186$/,'local emulator required');
assert.ok(!process.env.GCLOUD_PROJECT||process.env.GCLOUD_PROJECT===project,'production projects forbidden');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const app=initializeApp({projectId:project},'partner-start-test'),db=getFirestore(app);
const {writeSynchronizedStart}=require('../scripts/lib/rdw-synchronized-start-reference.cjs');
const {createAuthorizedMirrorStart}=require('../scripts/lib/rdw-authorized-mirror-start.cjs');
const {buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const {createHunterVerifiedRankedStart}=require('../scripts/lib/rdw-hunter-start-wiring.cjs');
const {createWiredRankedStart}=require('../scripts/lib/rdw-wired-ranked-start.cjs');
const {EXPECTED_FILES}=require('../scripts/lib/rdw-hunter-bundle-loader.cjs');
after(()=>deleteApp(app));
const uid=()=>randomBytes(8).toString('hex'),eventCode=()=>'BXH-'+randomBytes(3).toString('hex').toUpperCase();
const tiers=(uids,now)=>uids.map(uid=>({ok:true,uid,tier:'d',computedAt:now-2000,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)}));
async function fixture(options={}){
 const code=eventCode(),owner=options.shared?.owner||uid(),order=options.shared?.order||'BXH-CO-20261027-'+randomBytes(6).toString('hex').toUpperCase(),now=Date.now();
 const players=[{id:'p1',uid:uid()},{id:'p2',uid:uid()}],matches=[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false,station:1,bracket:'SE',round:0,indexInRound:0,seq:1,scoreA:0,scoreB:0,log:[],faultActions:[],winnerId:null,loserId:null,status:'ready',startedAt:null}];
 const state={cloudCode:code,createdBy:owner,registrationRosterRevision:4,bracketSize:2,bracketDraw:{id:'synthetic-draw',revision:7},meta:{ladderMode:'ranked',eventAuthority:'official',formatType:'single',stations:1},players,matches,drawnAt:now-3000,startedAt:null,rosterLocked:false};
 const grant={status:'active',scope:'contract',rankedMode:true,organizationId:'org',orderCode:order,startsAtMs:now-86400000,expiresAtMs:now+86400000};
 const profile={uid:owner,role:'player',active:true,isTestAccount:false,partnerOrganizer:grant,partnerContractOrderCode:order};
 const contract={orderCode:order,status:'active',quotaPolicy:'start-v1',targetUid:owner,organizationCode:'org',signedBy:owner,signatureHash:'a'.repeat(64),termsHash:'b'.repeat(64),termsVersion:1,paymentReference:'SYNTHETIC',startsAt:new Date(grant.startsAtMs).toISOString(),expiresAt:new Date(grant.expiresAtMs).toISOString(),includedEvents:1,usedEvents:0,minParticipants:2,maxParticipants:32,...options.contract};
 if(options.missingCounter)delete contract.usedEvents;
 const room={code,createdBy:owner,createdByRole:'partner_organizer',eventAuthority:'official',partnerOrganizationCode:'org',partnerContractOrderCode:order,partnerQuotaPolicy:'start-v1',partnerStartState:'draft',data:JSON.stringify(state),...options.room};
 const r={eventRef:db.doc('tournaments/'+code),publicRef:db.doc('publicTournaments/'+code),snapshotRef:db.doc('rdwSnapshots/'+code),receiptRef:db.doc('partnerEventDebits/'+code),contractRef:db.doc('partnerContracts/'+order),ownerRef:db.doc('users/'+owner)};
 const snapshot=buildRosterSnapshot({eventCode:code,drawRevision:7,rosterUids:players.map(p=>p.uid),verifiedTiers:tiers(players.map(p=>p.uid),now),capturedAt:now-1000});
 await Promise.all([r.eventRef.set(room),r.publicRef.set({partnerQuotaPolicy:'start-v1',partnerStartState:'draft',bracketView:JSON.stringify({...state,createdBy:undefined})}),...(!options.newSnapshot?[r.snapshotRef.set(snapshot)]:[]),...(!options.shared?[r.contractRef.set(contract),r.ownerRef.set({...profile,...options.profile})]:[])]);
 const args={...r,eventCode:code,expectedRosterRevision:4,drawRevision:7,serverTime:now,authorized:true,bracketVerified:true,quotaContext:{db,actorUid:owner},dispatchCandidate:{matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null}}},...(options.newSnapshot?{snapshotCandidate:snapshot}:{})};
 const writer=(override={})=>db.runTransaction(tx=>writeSynchronizedStart({...args,...override,tx}));
 const start=createAuthorizedMirrorStart({db,clock:()=>now,enabled:true,
  verifyBracketInTransaction:async({tx})=>{const v=JSON.parse((await tx.get(r.eventRef)).data().data);return v.startedAt==null&&v.registrationRosterRevision===4;},
  buildServerDispatch:async({tx})=>({matches:JSON.parse((await tx.get(r.eventRef)).data().data).matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null}}})});
 const request={eventCode:code,actorUid:owner,expectedRosterRevision:4,drawRevision:7};
 return {owner,order,code,now,r,args,writer,start,request,state};
}
async function read(f){const [a,b,c,d,e]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get(),f.r.snapshotRef.get(),f.r.receiptRef.get(),f.r.contractRef.get()]);return {room:a.data(),privateState:JSON.parse(a.data().data),publicState:JSON.parse(b.data().bracketView),snapshot:c,receipt:d,counter:e.data().usedEvents};}
test('start, both mirrors, new snapshot, debit and immutable receipt commit together',async()=>{
 const f=await fixture({newSnapshot:true}),out=await f.writer();assert.equal(out.committed,true);
 const v=await read(f);assert.equal(v.counter,1);assert.equal(v.privateState.startedAt,f.now);assert.equal(v.publicState.startedAt,f.now);assert.equal(v.snapshot.exists,true);assert.equal(v.receipt.exists,true);assert.deepEqual(v.room.partnerQuotaDebit,v.receipt.data());
});
test('crash after all staged writes rolls back start, snapshot and quota',async()=>{
 const f=await fixture({newSnapshot:true});await assert.rejects(db.runTransaction(async tx=>{assert.equal((await writeSynchronizedStart({...f.args,tx})).committed,true);throw Error('INJECTED_AFTER_WRITES');}),/INJECTED_AFTER_WRITES/);
 const v=await read(f);assert.equal(v.counter,0);assert.equal(v.privateState.startedAt,null);assert.equal(v.publicState.startedAt,null);assert.equal(v.snapshot.exists,false);assert.equal(v.receipt.exists,false);
});
test('bad court dispatch never consumes a prepared debit',async()=>{
 const f=await fixture();assert.equal((await f.writer({dispatchCandidate:null})).committed,false);const v=await read(f);assert.equal(v.counter,0);assert.equal(v.receipt.exists,false);assert.equal(v.privateState.startedAt,null);
});
test('concurrent identical requests both return success and debit exactly once',async()=>{
 const f=await fixture(),out=await Promise.all([f.start(f.request),f.start(f.request)]);assert.ok(out.every(x=>x.ok));assert.equal(out.filter(x=>x.replayed).length,1);assert.equal((await read(f)).counter,1);
 const again=await f.start(f.request);assert.equal(again.ok,true);assert.equal(again.replayed,true);assert.equal((await read(f)).counter,1);
});
test('two rooms competing for the last slot can commit only one start',async()=>{
 const a=await fixture(),b=await fixture({shared:a}),out=await Promise.all([a.start(a.request),b.start(b.request)]);assert.equal(out.filter(x=>x.ok).length,1);assert.equal((await read(a)).counter,1);assert.equal((await a.r.receiptRef.get()).exists!==(await b.r.receiptRef.get()).exists,true);
});
test('legacy counters, policy, participant limits and authority mismatch fail without writes',async()=>{
 const cases=[{missingCounter:true},{room:{partnerQuotaPolicy:'creation-v1'}},{room:{systemClosed:true}},{room:{cancelled:true}},{contract:{quotaPolicy:'creation-v1'}},{contract:{minParticipants:3}},{contract:{maxParticipants:1}},{contract:{organizationCode:'other-org'}},{contract:{targetUid:'other-owner'}},{profile:{active:false}},{profile:{accountStatus:'frozen'}},{contract:{usedEvents:1}}];
 for(const options of cases){const f=await fixture(options),out=await f.writer();assert.equal(out.committed,false,JSON.stringify(options));const v=await read(f);assert.equal(v.privateState.startedAt,null);assert.equal(v.receipt.exists,false);assert.equal(v.counter,options.missingCounter?undefined:options.contract?.usedEvents??0);}
});
test('future and expired contract periods refuse first starts',async()=>{
 for(const direction of [-1,1]){const f=await fixture();const start=f.now+(direction===1?86400000:-172800000),end=f.now+(direction===1?172800000:-86400000);await f.r.contractRef.update({startsAt:new Date(start).toISOString(),expiresAt:new Date(end).toISOString()});assert.equal((await f.writer()).committed,false);assert.equal((await read(f)).counter,0);}
});
test('contract start is inclusive and expiry is exclusive with matching owner grant dates',async()=>{
 for(const [startOffset,endOffset,allowed] of [[0,86400000,true],[1,86400000,false],[-86400000,0,false]]){
  const f=await fixture(),start=f.now+startOffset,end=f.now+endOffset;
  await f.r.contractRef.update({startsAt:new Date(start).toISOString(),expiresAt:new Date(end).toISOString()});
  await f.r.ownerRef.update({'partnerOrganizer.startsAtMs':start,'partnerOrganizer.expiresAtMs':end});
  assert.equal((await f.writer()).committed,allowed);assert.equal((await read(f)).counter,allowed?1:0);
 }
});
test('lost response replays the original success after renewal without needing fresh tiers or debit',async()=>{
 const f=await fixture();assert.equal((await f.start(f.request)).ok,true);
 await f.r.ownerRef.update({'partnerOrganizer.orderCode':'BXH-CO-20261027-FFFFFFFFFFFF','partnerOrganizer.expiresAtMs':f.now-86400000,partnerContractOrderCode:'BXH-CO-20261027-FFFFFFFFFFFF'});await f.r.contractRef.update({status:'expired'});
 const again=await f.start(f.request);assert.equal(again.ok,true);assert.equal(again.replayed,true);assert.equal(again.startedAt,f.now);assert.equal((await read(f)).counter,1);
 assert.equal((await f.start({...f.request,drawRevision:8})).ok,false);assert.equal((await read(f)).counter,1);
});
test('wrong actor, missing quota context, frozen actor and tampered receipt cannot forge a successful start',async()=>{
 const f=await fixture();await db.doc('users/outsider').set({active:true,role:'player'});
 assert.equal((await f.writer({quotaContext:{db,actorUid:'outsider'}})).committed,false);assert.equal((await f.writer({quotaContext:null})).committed,false);assert.equal((await read(f)).counter,0);
 assert.equal((await f.start(f.request)).ok,true);await f.r.receiptRef.update({usedAfter:999});assert.equal((await f.start(f.request)).ok,false);assert.equal((await read(f)).counter,1);
 const g=await fixture();assert.equal((await g.start(g.request)).ok,true);await g.r.ownerRef.update({accountStatus:'frozen'});assert.equal((await g.start(g.request)).ok,false);assert.equal((await read(g)).counter,1);
});
test('full Hunter composition creates a fresh sealed snapshot, dispatch and quota in one transaction',async t=>{
 const f=await fixture({newSnapshot:true}),bundleRoot=fs.mkdtempSync(path.join(os.tmpdir(),'partner-hunter-emulator-'));
 t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));fs.mkdirSync(path.join(bundleRoot,'vendor'));
 const reader="module.exports={createReader:()=>async({uid})=>({uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1',overview:{grade:{tier:'d'}}})};";
 const manifest={};for(const name of EXPECTED_FILES){const text=name==='reader.cjs'?reader:'{}';fs.writeFileSync(path.join(bundleRoot,name),text);manifest[name]=createHash('sha256').update(text).digest('hex');}
 fs.writeFileSync(path.join(bundleRoot,'bundle-manifest.json'),JSON.stringify(manifest));
 await Promise.all(f.state.players.map(p=>db.doc('users/'+p.uid).set({uid:p.uid,active:true,role:'player',isTestAccount:false})));
 let dispatches=0;
 const start=createHunterVerifiedRankedStart({db,clock:()=>f.now,bundleRoot,enabled:true,
  verifyBracketInTransaction:async({tx})=>JSON.parse((await tx.get(f.r.eventRef)).data().data).startedAt==null,
  buildServerDispatch:async({tx})=>{dispatches++;return {matches:JSON.parse((await tx.get(f.r.eventRef)).data().data).matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null}}};}});
 const first=await start(f.request);assert.equal(first.ok,true);assert.equal(first.replayed,false);
 const v=await read(f);assert.equal(v.counter,1);assert.equal(v.snapshot.exists,true);assert.equal(v.snapshot.data().capturedAt,f.now);assert.equal(v.room.partnerQuotaDebit.snapshotDigest,v.snapshot.data().snapshotDigest);assert.equal(v.publicState.startedAt,f.now);
 const again=await start(f.request);assert.equal(again.ok,true);assert.equal(again.replayed,true);assert.equal(dispatches,1);assert.equal((await read(f)).counter,1);
});

test('concrete wired start uses real bracket reader and real engine, locks registration and debits once',async t=>{
 const f=await fixture({newSnapshot:true}),bundleRoot=fs.mkdtempSync(path.join(os.tmpdir(),'partner-wired-emulator-'));t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));fs.mkdirSync(path.join(bundleRoot,'vendor'));
 const reader="module.exports={createReader:()=>async({uid})=>({uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1',overview:{grade:{tier:'d'}}})};";const manifest={};for(const name of EXPECTED_FILES){const value=name==='reader.cjs'?reader:'{}';fs.writeFileSync(path.join(bundleRoot,name),value);manifest[name]=createHash('sha256').update(value).digest('hex');}fs.writeFileSync(path.join(bundleRoot,'bundle-manifest.json'),JSON.stringify(manifest));
 f.state.meta.checkinRequired=true;f.state.meta.registrationStatus='open';f.state.matches[0].refereeUid='private-referee';f.state.courtAssignments={court1:{currentMatchId:'m1',nextMatchId:null,lockedBy:'private-referee',lockedAt:100}};
 await Promise.all([f.r.eventRef.update({data:JSON.stringify(f.state),registrationStatus:'open'}),f.r.publicRef.update({bracketView:JSON.stringify({...f.state,players:f.state.players.map(p=>({id:p.id}))}),registrationStatus:'open'}),...f.state.players.map(p=>db.doc('users/'+p.uid).set({uid:p.uid,active:true,role:'player'}))]);
 const start=createWiredRankedStart({db,clock:()=>f.now,bundleRoot,enabled:true});assert.equal((await start(f.request)).ok,true);const v=await read(f);assert.equal(v.counter,1);assert.equal(v.room.registrationStatus,'started');assert.equal(v.room.tournamentPhase,'live');for(const state of [v.privateState,v.publicState]){assert.equal(state.meta.registrationStatus,'started');assert.equal(state.meta.checkinClosedEarly,true);assert.equal(state.meta.checkinClosedAt,f.now);assert.equal(state.matches[0].status,'in_progress');assert.equal(state.courtAssignments.court1.status,'in_progress');}
 assert.equal(v.privateState.matches[0].startedAt,f.now);assert.equal(v.privateState.matches[0].refereeUid,'private-referee');assert.ok(!JSON.stringify(v.publicState).includes('private-referee'));assert.equal((await f.r.publicRef.get()).data().registrationStatus,'started');assert.equal((await start(f.request)).replayed,true);assert.equal((await read(f)).counter,1);
});

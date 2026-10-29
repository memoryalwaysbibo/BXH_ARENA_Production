'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {createPromotionHandler}=require('./functions/service.cjs');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8091')throw Error('Dedicated local emulator required');
let app,db,n=0;
before(()=>{app=initializeApp({projectId:'demo-seated-promotion'},'promotion-regression');db=getFirestore(app);});
after(async()=>{await db?.terminate();await deleteApp(app);});
async function fixture({role='staff',assigned=true,capacity=88,confirmed=80,waiting=1,qr=false}={}){
 const code='BXH-PROMO'+(++n),actor='actor'+n,tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code),rr=tr.collection('registrations').doc('candidate');
 const players=Array.from({length:confirmed},(_,i)=>({id:'p'+i,name:'Synthetic '+i,source:'online',registrationId:'r'+i,checkedIn:i===0}));
 const candidate={id:'candidate',name:'Synthetic',registrationId:'candidate',registrationUid:'candidate',source:'online',checkedIn:true,waitRank:1};
 const state={id:code,meta:{registrationCapacity:capacity,checkinRequired:true},players,waitlistPlayers:[candidate],matches:[],registrationRosterRevision:5,courtLifecycleEpoch:1,...(qr?{qrCheckinManaged:true,qrCheckinRevision:3}:{})};
 const common={eventAuthority:'official',createdBy:'host',ownerUid:'host',createdByRole:'staff',assignedStaffUids:assigned?[actor]:['other'],tournamentPhase:'waiting',archiveStatus:'ongoing',registrationStatus:'open',capacity,confirmedCount:confirmed,waitlistCount:waiting,updatedAt:1,...(qr?{qrCheckinManaged:true,qrCheckinRevision:3}:{})};
 await Promise.all([tr.set({...common,refereeSeatsV1:{version:1,revision:7,courts:{},requests:{}},courtLifecycleEpoch:1,courtLifecycleWriteSeq:9,data:JSON.stringify(state),...(qr?{qrCheckin:{enabled:true,session:'synthetic'}}:{})}),pr.set({...common,bracketView:JSON.stringify({meta:{name:'Public'},players,matches:[]})}),rr.set({status:'waitlist',uid:'candidate',displayName:'Synthetic'}),db.doc('users/'+actor).set({active:true,role})]);
 const handler=createPromotionHandler(db,{clock:()=>1000,timestamp:()=>FieldValue.serverTimestamp()});
 const request={auth:{uid:actor},data:{code,registrationId:'candidate',expandBy:0,operationId:'operation-example-123'}};
 const run=patch=>handler({...request,data:{...request.data,...patch}});
 const snapshot=async()=>Promise.all([tr.get(),pr.get(),rr.get()].map(async p=>(await p).data()));
 return {tr,pr,rr,actor,state,handler,request,run,snapshot};
}
for(const role of ['staff','admin','super_admin'])for(const qr of [false,true])test(`non-creator ${role} QR=${qr}: 80/1 becomes 81/0, preserving seats/check-in`,async()=>{
 const h=await fixture({role,qr}),before=await h.snapshot(),out=await h.run(),[t,p,r]=await h.snapshot();
 assert.equal(out.verified,true);assert.equal(t.confirmedCount,81);assert.equal(p.confirmedCount,81);assert.equal(t.waitlistCount,0);assert.equal(p.waitlistCount,0);assert.equal(t.capacity,88);assert.equal(r.status,'confirmed');assert.equal(r.promotedBy,h.actor);assert.equal(JSON.parse(t.data).players.length,81);assert.equal(JSON.parse(t.data).waitlistPlayers.length,0);assert.equal(JSON.parse(t.data).players.at(-1).checkedIn,true);assert.deepEqual(t.refereeSeatsV1,before[0].refereeSeatsV1);assert.equal(t.courtLifecycleWriteSeq,10);assert.equal(JSON.parse(t.data).registrationRosterRevision,6);assert(!p.bracketView.includes('registrationUid'));assert(!p.bracketView.includes('refereeSeatsV1'));if(qr){assert.equal(t.qrCheckinRevision,4);assert.equal(p.qrCheckinRevision,4);assert.equal(JSON.parse(t.data).qrCheckinRevision,4);}
});
for(const mode of ['unassigned','player','inactive','test','frozen','started','archived','draw','onsite','counter','qr','team','payload','partner'])test(`rejects ${mode} atomically`,async()=>{
 const h=await fixture({qr:true,...(mode==='unassigned'?{assigned:false}:mode==='player'?{role:'player'}:{})});
 if(['inactive','test','frozen'].includes(mode))await db.doc('users/'+h.actor).update(mode==='inactive'?{active:false}:mode==='test'?{isTestAccount:true}:{accountStatus:'frozen'});
 if(mode==='started')await h.tr.update({tournamentPhase:'live'});
 if(mode==='archived')await h.tr.update({archiveStatus:'completed'});
 if(mode==='draw')await h.tr.update({registrationSelection:{status:'open'}});
 if(mode==='onsite')await h.tr.update({onsiteWaitlistServerOwned:true});
 if(mode==='counter')await h.pr.update({confirmedCount:79});
 if(mode==='qr')await h.pr.update({qrCheckinRevision:2});
 if(mode==='team')await h.tr.update({battleMode:'team'});
 if(mode==='partner')await h.tr.update({createdByRole:'partner_organizer'});
 const before=await h.snapshot();await assert.rejects(h.run(mode==='payload'?{state:{players:[]}}:{}));assert.deepEqual(await h.snapshot(),before);
});
test('full capacity requires explicit +8; onsite seats count too',async()=>{
 const h=await fixture({confirmed:80,capacity:81});const s=h.state;s.players.push({id:'onsite',name:'Onsite',source:'onsite'});await h.tr.update({data:JSON.stringify(s)});const before=await h.snapshot();await assert.rejects(h.run(),/capacity-full/);assert.deepEqual(await h.snapshot(),before);await h.run({expandBy:8});const [t,p]=await h.snapshot();assert.equal(t.capacity,89);assert.equal(p.capacity,89);assert.equal(t.confirmedCount,81);assert.equal(JSON.parse(t.data).players.length,82);
});
test('retries are idempotent and revoked users cannot replay private state',async()=>{
 const h=await fixture();await h.run();const before=await h.snapshot();assert.equal((await h.run()).replayed,true);assert.deepEqual(await h.snapshot(),before);await assert.rejects(h.run({expandBy:8}),/operation-conflict/);await db.doc('users/'+h.actor).update({active:false});await assert.rejects(h.run(),/permission-denied/);
});
test('concurrent promotions of the same candidate commit once',async()=>{
 const h=await fixture(),results=await Promise.allSettled([h.run(),h.run({operationId:'another-operation-456'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await h.snapshot())[0].confirmedCount,81);
});
test('existing online projection is moved once without duplicating the player',async()=>{
 const h=await fixture(),candidate=h.state.waitlistPlayers[0];h.state.players.push(candidate);await h.tr.update({data:JSON.stringify(h.state)});await h.run();const [t]=await h.snapshot(),s=JSON.parse(t.data);assert.equal(s.players.length,81);assert.equal(s.players.filter(p=>p.id==='candidate').length,1);assert.equal(s.waitlistPlayers.length,0);
});

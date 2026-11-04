'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('./functions/service.cjs');
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
function harness(){
 const room={createdBy:'host',eventAuthority:'official',assignedStaffUids:['main','backup'],refereeStationAssignments:{},updatedAt:1,data:JSON.stringify({id:'r',cloudCode:'BXH-TEST',meta:{eventAuthority:'official',stations:1},matches:[{id:'m',scoreA:2,faultActions:[{side:'A'}]}]})};
 const docs=new Map([['tournaments/BXH-TEST',room],['publicTournaments/BXH-TEST',{bracketView:JSON.stringify({meta:{},matches:[{id:'m',scoreA:2}]})}],['systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true}],...['host','main','backup'].map(uid=>['users/'+uid,{active:true,role:'staff',realName:uid}])]);
 let tail=Promise.resolve(),seq=0,retryNext=false;
 const snapshot=path=>({id:path.split('/').at(-1),exists:docs.has(path),data:()=>clone(docs.get(path))});
 const ref=path=>({
  path,get:async()=>snapshot(path),
  update:async patch=>{assert(docs.has(path));docs.set(path,{...docs.get(path),...clone(patch)});},
  collection:name=>({
   doc:id=>ref(path+'/'+name+'/'+id),
   orderBy:()=>({limit:count=>({get:async()=>({docs:[...docs.keys()]
    .filter(k=>k.startsWith(path+'/'+name+'/'))
    .sort((a,b)=>docs.get(b).createdAt-docs.get(a).createdAt).slice(0,count).map(snapshot)})})})
  })
 });
 const db={doc:ref,collection:name=>({where:(field,operator,value)=>({limit:count=>({query:{name,field,value,count}})})}),runTransaction:fn=>{
  const result=tail.then(async()=>{
   const attempt=async()=>{const writes=[];const out=await fn({
    get:async r=>{
     if(!r.query)return snapshot(r.path);
     const q=r.query,rows=[...docs.keys()].filter(k=>k.startsWith(q.name+'/')&&k.split('/').length===2&&docs.get(k)[q.field]===q.value).slice(0,q.count).map(snapshot);
     return {size:rows.length,docs:rows};
    },
    update:(r,patch)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...clone(patch)})),
    set:(r,data)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...clone(data)})),
    create:(r,data)=>writes.push(()=>{assert(!docs.has(r.path));docs.set(r.path,clone(data));})
   });return {writes,out};};
   if(retryNext){retryNext=false;await attempt();}
   const {writes,out}=await attempt();writes.forEach(w=>w());return out;
  });tail=result.catch(()=>{});return result;
 }};
 const handle=createHandler(db,{clock:()=>1000,uuid:()=> 'request-'+(++seq)});
 let opSeq=0;
 const run=(uid,action,args={})=>handle({auth:{uid},data:{code:'BXH-TEST',operationId:'operation-number-'+(++opSeq),action,...args}});
 const doc=()=>docs.get('tournaments/BXH-TEST');
 return {docs,handle,run,doc,retry:()=>{retryNext=true;}};
}
test('callable writes seats, mirrors and audit atomically without changing match or fault data',async()=>{const h=harness();await h.run('host','enable');await h.run('main','claim',{station:1,slot:'main',expectedCourtRevision:0});const d=h.doc(),s=JSON.parse(d.data),mirror=JSON.parse(h.docs.get('publicTournaments/BXH-TEST').bracketView);assert.equal(d.refereeSeatsV1.courts['1'].main.uid,'main');assert.equal(s.matches[0].scoreA,2);assert.deepEqual(s.matches[0].faultActions,[{side:'A'}]);assert.equal(mirror.meta.refereeSeatNames['1'].main.name,'main');assert(!JSON.stringify(mirror).includes('"uid"'));assert(!JSON.stringify(mirror).includes('requests'));assert.equal([...h.docs.keys()].filter(k=>k.includes('/refereeSeatAudit/')).length,2);});
test('idempotent retry returns previous receipt and never creates two claims',async()=>{const h=harness();await h.run('host','enable');const request={auth:{uid:'main'},data:{code:'BXH-TEST',operationId:'idempotency-example-123',action:'claim',station:1,slot:'main',expectedCourtRevision:0}};const a=await h.handle(request),b=await h.handle(request);assert.deepEqual(a,b);assert.equal(h.doc().refereeSeatsV1.revision,2);await assert.rejects(h.handle({...request,data:{...request.data,slot:'backup1'}}),/operation-conflict/);});
test('concurrent same-seat requests produce exactly one successful claim',async()=>{const h=harness();await h.run('host','enable');const results=await Promise.allSettled(['main','backup'].map(uid=>h.run(uid,'claim',{station:1,slot:'main',expectedCourtRevision:0})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.doc().refereeStationUids.length,1);});
test('a lost eligibility after request blocks acceptance without mutating seats',async()=>{const h=harness();await h.run('host','enable');await h.run('main','claim',{station:1,slot:'main',expectedCourtRevision:0});const r=await h.run('backup','request',{station:1,slot:'main',expectedCourtRevision:1,expectedUid:'main'});h.docs.get('users/backup').active=false;const before=clone(h.doc());await assert.rejects(h.run('main','respond',{station:1,slot:'main',requestId:r.requestId,response:'accept'}),/requester-ineligible/);assert.deepEqual(h.doc(),before);});
test('unverified deployment fails closed and unauthenticated requests cannot invoke it',async()=>{const h=harness();h.docs.get('systemConfig/refereeSeatsV1').perCourtScoringVerified=false;await assert.rejects(h.run('host','enable'),/release-not-ready/);await assert.rejects(h.handle({data:{}}),/unauthenticated/);assert(!h.doc().refereeSeatsV1);});

test('community host initializes two courts once and retry checks current eligibility',async()=>{
 const h=harness(),room=h.doc(),state=JSON.parse(room.data);
 Object.assign(room,{eventAuthority:'community',ladderMode:'general',ownerUid:'host',assignedStaffUids:[]});
 Object.assign(state.meta,{eventAuthority:'community',ladderMode:'general',stations:2});
 room.data=JSON.stringify(state);
 const host=h.docs.get('users/host');host.role='player';
 const request={auth:{uid:'host'},data:{code:'BXH-TEST',operationId:'community-enable-123',action:'enable'}};
 await assert.rejects(h.handle(request),/room-read-only/);
 h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 await assert.rejects(h.run('main','enable'),/permission-denied/);
 const result=await h.handle(request);
 assert.deepEqual(await h.handle(request),result);
 assert.deepEqual(Object.keys(h.doc().refereeSeatsV1.courts),['1','2']);
 assert.deepEqual(h.doc().assignedStaffUids,[]);
 assert.equal(JSON.parse(h.doc().data).matches[0].scoreA,2);
 assert.equal([...h.docs.keys()].filter(k=>k.includes('/refereeSeatAudit/')).length,1);
 host.active=false;
 await assert.rejects(h.handle(request),/not-event-staff/);
});

test('community host invites two players to separate courts; only the named player can accept',async()=>{
 const h=harness(),room=h.doc(),state=JSON.parse(room.data);
 Object.assign(room,{eventAuthority:'community',ladderMode:'general',ownerUid:'host',assignedStaffUids:[]});
 Object.assign(state.meta,{eventAuthority:'community',ladderMode:'general',stations:2});
 room.data=JSON.stringify(state);
 for(const uid of ['host','main','backup'])h.docs.get('users/'+uid).role='player';
 h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 await h.run('host','enable');
 for(const [station,uid,other] of [[1,'main','backup'],[2,'backup','main']]){
  const slot='main';
  const {requestId}=await h.run('host','invite',{station,slot,targetUid:uid,expectedCourtRevision:0});
  await assert.rejects(h.run(other,'accept-invite',{station,slot,requestId}),/request-unavailable/);
  const mailPath='users/'+uid+'/communityRefereeInbox/ref-invite-'+requestId;
  assert.equal(h.docs.get(mailPath).refereeInviteStatus,'pending');
  await h.run(uid,'accept-invite',{station,slot,requestId});
  assert.equal(h.doc().refereeSeatsV1.courts[station].main.uid,uid);
  assert.equal(h.docs.get(mailPath).refereeInviteStatus,'accepted');
 }
 assert.deepEqual(h.doc().assignedStaffUids,[]);
});

function communityFixture(){
 const h=harness(),room=h.doc(),state=JSON.parse(room.data);
 Object.assign(room,{eventAuthority:'community',ladderMode:'general',ownerUid:'host',assignedStaffUids:[]});
 Object.assign(state.meta,{eventAuthority:'community',ladderMode:'general',stations:2});room.data=JSON.stringify(state);
 for(const uid of ['host','main','backup'])h.docs.get('users/'+uid).role='player';
 h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 return h;
}
test('three simultaneous invitations on one court remain usable after another seat accepts',async()=>{
 const h=communityFixture();h.docs.set('users/third',{active:true,role:'player'});await h.run('host','enable');
 const invites=[];
 for(const [uid,slot] of [['main','main'],['backup','backup1'],['third','backup2']]){
  const r=await h.run('host','invite',{station:1,slot,targetUid:uid,expectedCourtRevision:0});invites.push({uid,slot,requestId:r.requestId});
 }
 for(const {uid,...args} of invites)await h.run(uid,'accept-invite',{station:1,...args});
 const court=h.doc().refereeSeatsV1.courts[1];assert.equal(court.main.uid,'main');assert.equal(court.backup1.uid,'backup');assert.equal(court.backup2.uid,'third');
 const r=await h.run('backup','request',{station:1,slot:'main',expectedCourtRevision:3,expectedUid:'main'});
 await h.run('main','respond',{station:1,slot:'main',requestId:r.requestId,response:'accept'});
 assert.equal(h.doc().refereeSeatsV1.courts[1].main.uid,'backup');assert.equal(h.doc().refereeSeatsV1.courts[1].backup1.uid,'main');
 assert.equal(h.doc().refereeSeatsV1.courts[2].revision,0);
});
test('referee inbox only lists own invitations and inactive accounts cannot read or mark mail',async()=>{
 const h=communityFixture();await h.run('host','enable');
 const {requestId}=await h.run('host','invite',{station:1,slot:'main',targetUid:'main',expectedCourtRevision:0});
 const list=await h.run('main','invite-mail-list');assert.equal(list.messages.length,1);assert.equal((await h.run('backup','invite-mail-list')).messages.length,0);
 await h.run('main','invite-mail-read',{messageId:'ref-invite-'+requestId});assert.equal(h.docs.get('users/main/communityRefereeInbox/ref-invite-'+requestId).readAt,1000);
 await assert.rejects(h.run('backup','invite-mail-read',{messageId:'ref-invite-'+requestId}));
 h.docs.get('users/main').active=false;await assert.rejects(h.run('main','invite-mail-list'),/permission-denied/);
 await assert.rejects(h.run('main','invite-mail-read',{messageId:'ref-invite-'+requestId}),/permission-denied/);
});
test('an ended community invitation cannot assign a seat or mark its mail accepted',async()=>{
 const h=communityFixture();await h.run('host','enable');
 const {requestId}=await h.run('host','invite',{station:1,slot:'main',targetUid:'main',expectedCourtRevision:0});
 h.doc().tournamentPhase='done';const before=clone(h.doc());
 await assert.rejects(h.run('main','accept-invite',{station:1,slot:'main',requestId}),/community-result-available/);
 assert.deepEqual(h.doc(),before);assert.equal(h.docs.get('users/main/communityRefereeInbox/ref-invite-'+requestId).refereeInviteStatus,'pending');
});

test('game ID lookup survives transaction retries without mutating the idempotency payload',async()=>{
 const h=communityFixture();h.docs.get('users/main').gameId='PLAYER-123';await h.run('host','enable');
 const request={auth:{uid:'host'},data:{code:'BXH-TEST',action:'invite',operationId:'gameid-invite-retry-123',targetGameId:'PLAYER-123',station:1,slot:'main',expectedCourtRevision:0}};
 h.retry();const result=await h.handle(request);assert.deepEqual(await h.handle(request),result);
 assert(!Object.hasOwn(request.data,'targetUid'));assert.equal(h.doc().refereeSeatsV1.requests[result.requestId].toUid,'main');
 assert.equal([...h.docs.keys()].filter(k=>k.includes('/communityRefereeInbox/')).length,1);
});

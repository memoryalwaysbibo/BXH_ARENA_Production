'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,release=path.resolve(root,'../../../release/buckets/settlement');
const specs=JSON.parse(fs.readFileSync(path.join(release,'patch-manifest.json'))).patches;
const NOW=1900000000000,code='BXH-TEST01',clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function memory(){
 const rows=new Map(),versions=new Map(),created=new Map(),writes=[];let interfere;let serial=0;
 const put=(p,d)=>{rows.set(p,clone(d));versions.set(p,++serial);if(!created.has(p))created.set(p,serial);};
 const snapshot=p=>{const value=clone(rows.get(p)),exists=rows.has(p),born=created.get(p),version=versions.get(p)||0;return {id:p.split('/').at(-1),ref:ref(p),exists,data:()=>clone(value),createTime:exists?{seconds:born,nanoseconds:0}:undefined,updateTime:{seconds:version,nanoseconds:0,toMillis:()=>version*1000}};};
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:c=>query(p+'/'+c),get:async()=>snapshot(p)});
 function query(p){let maximum=Infinity;const filters=[];const q={query:true,path:p,doc:id=>ref(p+'/'+id),where(...f){filters.push(f);return q;},limit(n){maximum=n;return q;},orderBy(){return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&filters.every(([f,op,v])=>op==='=='&&rows.get(k)[f]===v)).slice(0,maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}};return q;}
 function apply(kind,p,value,options){if(kind==='create')assert(!rows.has(p));writes.push({kind,path:p,value:clone(value),options:clone(options)});if(kind==='delete'){rows.delete(p);created.delete(p);versions.set(p,++serial);return;}const next=kind==='update'||options?.merge?{...rows.get(p)}:{};for(const [k,v]of Object.entries(value)){if(v&&v.__increment!==undefined)next[k]=Number(next[k]||0)+v.__increment;else if(v&&v.__arrayUnion){next[k]=[...(next[k]||[])];for(const item of v.__arrayUnion)if(!next[k].some(old=>JSON.stringify(old)===JSON.stringify(item)))next[k].push(clone(item));}else next[k]=clone(v);}put(p,next);}
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,collection:query,getAll:async(...refs)=>Promise.all(refs.map(r=>r.get())),runTransaction:async cb=>{for(let attempt=0;attempt<4;attempt++){
  const reads=new Map(),pending=[];const get=async r=>{assert.equal(pending.length,0,'read after write');if(r.query)return r.get();reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path);};
  const tx={get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d,o)=>pending.push(['set',r.path,d,o]),update:(r,d)=>pending.push(['update',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);if(interfere&&pending.length){const fn=interfere;interfere=null;fn();}
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;pending.forEach(args=>apply(...args));return result;
 }throw Error('retry exhausted');}};
 return {db,rows,put,writes,snapshot,remove:p=>{rows.delete(p);created.delete(p);versions.set(p,++serial);},set interfere(x){interfere=x;}};
}


function load(spec,candidate,m){
 const base=path.join(root,'fixtures',String(spec.sourceSet)),cache=new Map();class FixedDate extends Date{static now(){return NOW;}}
 const sdk={getFirestore:()=>m.db,FieldValue:{serverTimestamp:()=>NOW,increment:n=>({__increment:n})}};
 const actual=p=>p.includes('/bucket-settlement/')?path.join(release,'bucket-settlement',p.split('/bucket-settlement/')[1]):candidate&&p===path.join(base,spec.path)?path.join(release,'candidate',String(spec.sourceSet),spec.path):p;
 function moduleAt(p){if(cache.has(p))return cache.get(p).exports;const mod={exports:{}};cache.set(p,mod);
  const req=n=>{
   if(n==='firebase-admin/firestore')return sdk;
   if(n==='firebase-functions/v2/firestore')return {onDocumentWritten:(_o,fn)=>fn};
   if(n.startsWith('.')){const name=path.resolve(path.dirname(p),n),found=[name,name+'.js',name+'.cjs'].find(x=>fs.existsSync(actual(x)));if(!found||!found.startsWith(base+path.sep))throw Error('missing fixture '+n);return moduleAt(found);}return require(n);
  };
  vm.runInThisContext('(function(require,module,exports,Date,process){'+fs.readFileSync(actual(p),'utf8')+'\n})',{filename:actual(p)})(req,mod,mod.exports,FixedDate,{env:{GCLOUD_PROJECT:'bxh-arena'}});return mod.exports;
 }
 const exports=moduleAt(path.join(base,spec.path)),db=moduleAt(path.join(base,'_qr_checkin/admin-firestore.cjs')).getFirestore(),options={db,clock:()=>NOW,now:()=>NOW,serverTimestamp:()=>NOW,FieldValue:sdk.FieldValue,bucketRuntime:'emulator',bucketEnv:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'}};
 const fn=spec.function==='ladderAutoSettlement'?exports._ladderAutoSettlementTest.createSettlementService(options).settle:exports.createLadderSettlement(options);
 return {invoke:(overrides={})=>spec.function==='ladderAutoSettlement'?fn(code):fn({code,actor:{uid:'admin',name:'Admin'},...(candidate&&m.rows.get('tournaments/'+code)?.scoreStorage?{expectedRoom:{roomId:m.rows.get('tournaments/'+code).scoreStorage.roomId,epoch:m.rows.get('tournaments/'+code).scoreStorage.epoch}}:{}),...overrides}),module:exports};
}
function fixture({bucket=true,qr=false,courts=6}={}){
 const m=memory(),B=require(path.join(release,'bucket-settlement/state.cjs'));
 const players=Array.from({length:4},(_,i)=>({id:'p'+(i+1),name:'Player '+(i+1),registrationUid:'u'+(i+1),source:'online',checkedIn:true}));
 const match=(id,a,b,winner,round,station,bracket='SE')=>({id,a:{playerId:a},b:{playerId:b},winnerId:winner,loserId:winner===a?b:a,scoreA:4,scoreB:1,completed:true,status:'completed',round,indexInRound:id==='semi2'?1:0,seq:id==='final'?3:id==='bronze'?2.5:id==='semi1'?1:2,station,bracket,isBye:false,refereeSeatScoreRevision:2,dispatchRevision:0,log:[],confirmedByUid:'PRIVATE_UID'});
 const state={id:'room-1',cloudCode:code,meta:{name:'Synthetic',eventAuthority:'official',ladderMode:'ranked',formatType:'single',scoringMode:'standard',battleMode:'individual',playMode:'standard',stations:courts,bronzeMatch:true,date:'2026-11-03'},players,matches:[match('semi1','p1','p2','p1',0,1),match('semi2','p3','p4','p3',0,Math.min(5,courts)),match('bronze','p2','p4','p2',0,Math.min(5,courts),'BZ'),match('final','p1','p3','p1',1,1)],championId:'p1',runnerUpId:'p3',thirdId:'p2',fourthId:'p4',bronzeMatchId:'bronze',archiveStatus:'ongoing',startedAt:NOW-1000,updatedAt:1};
 if(qr){state.qrCheckinManaged=true;state.qrCheckinRevision=1;}
 const top={eventAuthority:'official',createdBy:'admin',ladderMode:'ranked',archiveStatus:'ongoing',tournamentPhase:'live',refereeSeatsV1:{version:1},data:JSON.stringify(state)};
 const pub={bracketView:JSON.stringify({meta:{stations:courts},players:players.map(p=>({id:p.id,name:p.name,checkedIn:true})),matches:[],championId:null}),archiveStatus:'ongoing'};
 m.put('users/admin',{active:true,role:'super_admin'});
 for(const p of players){m.put('users/'+p.registrationUid,{active:true,role:'player',realName:p.name});m.put('ladderPlayers/'+p.registrationUid,{uid:p.registrationUid,currentSeason:'S1',seasonPoints:5,careerPoints:10,totalEvents:0});}
 if(qr){Object.assign(top,{qrCheckinManaged:true,qrCheckinRevision:1,qrCheckin:{version:1}});Object.assign(pub,{qrCheckinManaged:true,qrCheckinRevision:1});}
 let manifest,buckets;
 if(bucket){manifest=B.makeManifest(state,'epoch-1');top.scoreStorage=manifest;buckets=B.encode(state,manifest).map(b=>({...b,revision:7}));pub.scoreBucketProjection={epoch:'epoch-1',versions:Object.fromEntries(buckets.map(b=>[b.bucketId,0]))};
  const stale=clone(state);stale.championId='p4';stale.runnerUpId='p2';stale.thirdId='p1';stale.fourthId='p3';stale.matches.forEach(x=>{x.scoreA=0;x.scoreB=0;});top.data=JSON.stringify(stale);
 }
 m.put('tournaments/'+code,top);m.put('publicTournaments/'+code,pub);m.put('ladderSystem/current',{status:'active',currentSeason:'S1'});
 m.put('systemConfig/fourCourtScoreBuckets',{enabled:true,settlementEnabled:true});
 for(const p of players)m.put('tournaments/'+code+'/registrations/'+p.registrationUid,{uid:p.registrationUid,status:'confirmed'});
 if(bucket)for(const b of buckets)m.put('tournaments/'+code+'/matchBuckets/'+b.bucketId,b);
 return {m,state,top,pub,buckets,manifest};
}
function normalized(m,result){return clone({result,rows:[...m.rows],writes:m.writes});}
function bracket(count){
 const size=2**Math.ceil(Math.log2(count)),half=size/2,players=Array.from({length:count},(_,i)=>({id:'p'+i,name:'P'+i,registrationUid:'u'+i,source:'online'}));let slots=[];
 for(let i=0;i<half;i++)slots.push(players[i].id,players[half+i]?.id||null);
 const matches=[];let round=0;
 while(slots.length>1){const next=[];for(let j=0;j<slots.length;j+=2){const a=slots[j],b=slots[j+1],isBye=!a||!b,winnerId=a||b||null;matches.push({id:'m'+round+'-'+j,a:a?{playerId:a}:null,b:b?{playerId:b}:null,round,indexInRound:j/2,seq:matches.length,bracket:'SE',station:j/2%6+1,isBye,completed:true,winnerId,loserId:isBye?null:b,scoreA:4,scoreB:1});next.push(winnerId);}slots=next;round++;}
 const state={id:'generated',cloudCode:code,meta:{eventAuthority:'official',ladderMode:'ranked',formatType:'single',stations:6,bronzeMatch:count>=4},players,matches};
 if(count>=4){const semi=matches.filter(m=>m.round===round-2);state.bronzeMatchId='bronze';matches.push({id:'bronze',a:{playerId:semi[0].loserId},b:{playerId:semi[1].loserId},winnerId:semi[0].loserId,loserId:semi[1].loserId,round:round-2,indexInRound:0,seq:matches.length,bracket:'BZ',station:5,isBye:false,completed:true,scoreA:4,scoreB:1});}
 return state;
}
function largeFixture(count=160){
 const f=fixture(),A=require(path.join(release,'bucket-settlement/input.cjs')),B=require(path.join(release,'bucket-settlement/state.cjs')),state=A.validateResults(bracket(count));state.startedAt=NOW-1000;
 for(const p of [...f.m.rows.keys()])if((p.startsWith('users/')&&p!=='users/admin')||p.startsWith('ladderPlayers/')||p.includes('/registrations/')||p.includes('/matchBuckets/'))f.m.remove(p);
 for(let i=0;i<count;i++){f.m.put('users/u'+i,{active:true,role:'player',realName:'P'+i});f.m.put('ladderPlayers/u'+i,{currentSeason:'S1',seasonPoints:0,careerPoints:0});f.m.put('tournaments/'+code+'/registrations/u'+i,{status:'confirmed'});}
 const manifest=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,manifest).map(b=>({...b,revision:7}));
 f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),scoreStorage:manifest,data:JSON.stringify(state)});
 f.m.put('publicTournaments/'+code,{bracketView:JSON.stringify({meta:{stations:6},players:state.players.map(p=>({id:p.id,name:p.name})),matches:[]}),scoreBucketProjection:{epoch:'epoch-1',versions:Object.fromEntries(buckets.map(b=>[b.bucketId,0]))}});
 for(const b of buckets)f.m.put('tournaments/'+code+'/matchBuckets/'+b.bucketId,b);
 return {...f,state,manifest,buckets};
}
module.exports={memory,load,fixture,specs,NOW,code,bracket,largeFixture};
if(require.main===module)(async()=>{let checks=0;
 {
  const f=fixture({courts:6}),spec=specs.find(x=>x.function==='settleLadderTournament');
  const name='PRIVATE_PROFILE_NAME';
  f.m.put('users/u1',{...f.m.rows.get('users/u1'),realName:'  '+name+'  '});
  const result=await load(spec,true,f.m).invoke();
  assert(result.ok,result.reason);
  assert.equal(f.m.rows.get('ladderPlayers/u1').playerName,name);
  assert.equal(result.results.find(x=>x.playerId==='u1').playerName,name);
  assert(!JSON.stringify(result.bucketSettlement).includes(name));
  assert(!JSON.stringify(f.m.rows.get('publicTournaments/'+code)).includes(name));
  checks++;
 }
 for(const spec of specs){
  for(const qr of [false,true]){
   const a=fixture({bucket:false,qr}),b=fixture({bucket:false,qr}),ra=await load(spec,false,a.m).invoke(),rb=await load(spec,true,b.m).invoke();assert(ra.ok,spec.function+': '+ra.reason);assert.deepEqual(normalized(b.m,rb),normalized(a.m,ra));checks++;
  }
  for(const qr of [false,true])for(const courts of [4,6,12]){
   const f=fixture({qr,courts}),h=load(spec,true,f.m),result=await h.invoke();assert(result.ok,spec.function+': '+result.reason);
   const t=f.m.rows.get('tournaments/'+code),p=f.m.rows.get('publicTournaments/'+code),state=JSON.parse(t.data),view=JSON.parse(p.bracketView);
   assert.equal(t.archiveStatus,'completed');assert.equal(state.championId,'p1');assert.equal(state.matches.find(x=>x.id==='final').scoreA,4);assert.equal(view.matches.find(x=>x.id==='final').scoreA,4);assert.equal(view.championId,'p1');assert(!JSON.stringify(p).includes('PRIVATE_UID'));
   assert.equal(t.bucketSettlement.versions['court-1'],7);assert.equal(f.m.rows.get('ladderPlayers/u1').seasonPoints,105);assert.equal(f.m.rows.get('ladderPlayers/u3').seasonPoints,75);assert.equal(f.m.rows.get('ladderPlayers/u2').seasonPoints,55);assert.equal(f.m.rows.get('ladderPlayers/u4').seasonPoints,15);
   const n=f.m.writes.length;const replay=await h.invoke();assert(replay.ok,spec.function+' replay '+replay.reason);assert(replay.alreadyAwarded);assert.equal(f.m.writes.length,n);if(qr)assert.equal(t.qrCheckinRevision,2);checks++;
  }
  for(const key of ['bucketMigration','deletionStatus'])for(const value of [null,false,{},'unknown'])for(const side of ['tournaments','publicTournaments']){
   const f=fixture(),p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[key]:value});const r=await load(spec,true,f.m).invoke();assert.equal(r.ok,false);assert.equal(f.m.writes.length,0);checks++;
  }
  const failures={
   missingBucket:f=>f.m.remove('tournaments/'+code+'/matchBuckets/court-2'),
   corruptBucket:f=>{const p='tournaments/'+code+'/matchBuckets/court-1';f.m.put(p,{...f.m.rows.get(p),matches:'{bad'});},
   wrongEpoch:f=>{const p='tournaments/'+code+'/matchBuckets/court-1';f.m.put(p,{...f.m.rows.get(p),epoch:'other'});},
   invalidRevision:f=>{const p='tournaments/'+code+'/matchBuckets/court-1';f.m.put(p,{...f.m.rows.get(p),revision:-1});},
   projectionAhead:f=>{const p='publicTournaments/'+code;f.m.put(p,{...f.m.rows.get(p),scoreBucketProjection:{epoch:'epoch-1',versions:{'court-1':99,'court-2':7}}});},
   runtimeDisabled:f=>f.m.put('systemConfig/fourCourtScoreBuckets',{enabled:true,settlementEnabled:false}),
   incomplete:f=>{const p='tournaments/'+code+'/matchBuckets/court-1',b=f.m.rows.get(p),rows=JSON.parse(b.matches);rows.find(x=>x.id==='final').completed=false;f.m.put(p,{...b,matches:JSON.stringify(rows)});},
   oldAwards:f=>{const p='tournaments/'+code;f.m.put(p,{...f.m.rows.get(p),ladderPointsAwarded:true});},
   oldLedger:f=>f.m.put('ladderTransactions/'+code+'_u1',{pointsEarned:999}),
   cancelled:f=>f.m.put('tournaments/'+code+'/registrations/u1',{status:'cancelled'}),
   qrMismatch:f=>{const p='tournaments/'+code;f.m.put(p,{...f.m.rows.get(p),qrCheckinManaged:true,qrCheckinRevision:1});},
  };
  for(const [name,mutate]of Object.entries(failures)){const f=fixture();mutate(f);const r=await load(spec,true,f.m).invoke();assert.equal(r.ok,false,spec.function+' '+name);assert.equal(f.m.writes.length,0,name);checks++;}
  // A bucket mutation conflicts with the read set; the retry must use current data.
  {const f=fixture();f.m.interfere=()=>{const p='tournaments/'+code+'/matchBuckets/court-1',b=f.m.rows.get(p);f.m.put(p,{...b,epoch:'changed'});};const r=await load(spec,true,f.m).invoke();assert.equal(r.ok,false);assert.equal(f.m.writes.length,0);checks++;}
 }
 // Manual and automatic paths may compete, but never award two event credits.
 for(const qr of [false,true]){const f=fixture({qr}),a=load(specs[0],true,f.m),b=load(specs[1],true,f.m);const out=await Promise.all([a.invoke(),b.invoke()]);assert(out.every(r=>r.ok));assert.equal(f.m.rows.get('ladderPlayers/u1').seasonPoints,105);assert.equal([...f.m.rows.keys()].filter(p=>p.startsWith('ladderTransactions/')).length,4);if(qr)assert.equal(f.m.rows.get('tournaments/'+code).qrCheckinRevision,2);checks++;}
 for(const spec of specs){
  for(const control of [{currentSeason:'S0',isTrialSeason:true,countsTowardCareer:false},{currentSeason:'S1',countsTowardCareer:false}]){
   const f=fixture();f.m.put('ladderSystem/current',{status:'active',...control});if(control.currentSeason==='S0')for(let i=1;i<=4;i++)f.m.put('ladderPlayers/u'+i,{...f.m.rows.get('ladderPlayers/u'+i),currentSeason:'S0'});
   const r=await load(spec,true,f.m).invoke();assert(r.ok,r.reason);assert.equal(f.m.rows.get('ladderPlayers/u1').careerPoints,10);checks++;
  }
  // An unauthenticated-name fallback never links an unbound bucket participant.
  {const f=fixture(),p='tournaments/'+code,t=f.m.rows.get(p),s=JSON.parse(t.data);delete s.players[3].registrationUid;s.players[3].source='onsite';f.m.put(p,{...t,data:JSON.stringify(s)});const r=await load(spec,true,f.m).invoke();assert(r.ok,r.reason);assert(!f.m.rows.has('ladderTransactions/'+code+'_u4'));checks++;}
  for(const mutate of [
   f=>{const p='tournaments/'+code;f.m.put(p,{...f.m.rows.get(p),scoreStorage:null});},
   f=>{const p='tournaments/'+code;f.m.put(p,{...f.m.rows.get(p),systemClosed:true});},
   f=>f.m.put('ladderSystem/current',{status:'active',currentSeason:'S1',rolloverInProgress:true}),
   f=>f.m.put('ladderSystem/current',{status:'active',currentSeason:'S1',endAt:NOW-1}),
  ]){const f=fixture();mutate(f);const r=await load(spec,true,f.m).invoke();assert.equal(r.ok,false);assert.equal(f.m.writes.length,0);checks++;}
  // A successful archive is sealed; tampering with a bucket invalidates replay.
  {const f=fixture(),h=load(spec,true,f.m);assert((await h.invoke()).ok);const n=f.m.writes.length,p='tournaments/'+code+'/matchBuckets/court-1';f.m.put(p,{...f.m.rows.get(p),revision:8});const r=await h.invoke();assert.equal(r.ok,false);assert.equal(f.m.writes.length,n);checks++;}
  // Completion states carry all current buckets, including retired historical courts.
  {const f=fixture(),B=require(path.join(release,'bucket-settlement/state.cjs')),state=clone(f.state);state.matches.filter(x=>['semi2','bronze'].includes(x.id)).forEach(x=>x.station=9);const p='tournaments/'+code;f.m.put(p,{...f.m.rows.get(p),data:JSON.stringify(state)});for(const b of B.encode(state,f.manifest))f.m.put(p+'/matchBuckets/'+b.bucketId,{...b,revision:7});const r=await load(spec,true,f.m).invoke();assert(r.ok,r.reason);assert.equal(JSON.parse(f.m.rows.get(p).data).matches.find(x=>x.id==='semi2').station,9);checks++;}
 }
 const A=require(path.join(release,'bucket-settlement/input.cjs')),core=require('./fixtures/10/ladder-settlement-core.js'),manual=require('./fixtures/21/ladder-settlement.js');
 for(const count of [2,3,4,5,8,12,16,32,64,96,128,160,192,240,256,320,512]){
  const state=A.validateResults(bracket(count)),a=core.analyze(state),b=manual.buildLadderSettlementPayload(state);
  assert.equal(a.count,count);assert.equal(b.effectiveCount,count);assert.equal(a.weight,b.multiplier);
  if(count===160){assert.equal(a.weight,2.625);assert.equal(a.players.find(x=>x.placement===1).pointsEarned,246);}
  assert.deepEqual(a.players.map(x=>[x.player.id,x.placement,x.pointsEarned,x.wins,x.losses,x.scoring]),b.participants.map(x=>[x.localPlayerId,x.placement,x.pointsEarned,x.wins,x.losses,x.scoring]));checks++;
 }
 for(const spec of specs)for(const key of ['testMode','systemClosed','eventCancelled','notStarted']){
  const f=fixture(),p='tournaments/'+code,t=f.m.rows.get(p),s=JSON.parse(t.data);if(key==='eventCancelled')s.meta.eventCancelled=true;else if(key==='notStarted')delete s.startedAt;else s[key]=true;f.m.put(p,{...t,data:JSON.stringify(s)});const r=await load(spec,true,f.m).invoke();assert.equal(r.ok,false);assert.equal(f.m.writes.length,0);checks++;
 }
 const boundManual=specs.find(s=>s.function==='settleLadderTournament');
 for(const expectedRoom of [null,{}, {roomId:'wrong',epoch:'epoch-1'}, {roomId:'room-1',epoch:'old'}, {roomId:'room-1',epoch:'epoch-1',extra:1}]){
  const f=fixture(),before=JSON.stringify([...f.m.rows]);const result=await load(boundManual,true,f.m).invoke({expectedRoom});assert.equal(result.ok,false);assert.equal(JSON.stringify([...f.m.rows]),before);checks++;
 }
 {const f=fixture();assert((await load(boundManual,true,f.m).invoke()).ok);f.m.put('users/admin',{active:false,role:'admin'});const before=JSON.stringify([...f.m.rows]);const result=await load(boundManual,true,f.m).invoke();assert.equal(result.ok,false);assert.equal(JSON.stringify([...f.m.rows]),before);checks++;}
 {const f=fixture({bucket:false}),before=JSON.stringify([...f.m.rows]);const result=await load(boundManual,true,f.m).invoke({expectedRoom:{roomId:'room-1',epoch:'epoch-1'}});assert.equal(result.ok,false);assert.equal(JSON.stringify([...f.m.rows]),before);checks++;}
 // Execute the real captured callable assignment; do not infer forwarding from factory tests.
 {const src=fs.readFileSync(path.join(release,'candidate/21/index.js'),'utf8'),a=src.indexOf('exports.settleLadderTournament = onCall('),b=src.indexOf('\n});',a)+4,ex={},binding={roomId:'browser-room',epoch:'browser-epoch'};let forwarded;
  vm.runInNewContext(src.slice(a,b),{exports:ex,REGION:'asia-east1',onCall:(_,fn)=>fn,requireAdminTier:async()=>({uid:'admin',data:{realName:'Admin'}}),settleOfficialLadder:async value=>{forwarded=value;return {ok:true};},HttpsError:Error});
  await ex.settleLadderTournament({data:{code,expectedRoom:binding}});assert.deepEqual(JSON.parse(JSON.stringify(forwarded.expectedRoom)),binding);checks++;
 }
 console.log(JSON.stringify({settlementChecks:checks,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../modules/main-app/active-events.js');
const {create}=require('../modules/cloud/active-events-reader.js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const participant=(id='p1',extra={})=>({kind:'self',registrationId:'u1',participantId:id,registrationStatus:'confirmed',...extra});
const room=(extra={})=>({visibility:'public',name:'Fixture',tournamentPhase:'live',parsedData:{startedAt:1,bracketSize:8,meta:{formatType:'single',bronzeMatch:false},players:[{id:'p1',name:'Tester'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}]},...extra});
const membership=(code='BXH-TEST',extra={})=>({schemaVersion:1,code,generation:'g1',sourceRevision:'r1',participants:[participant()],...extra});
const index=(memberships=[],extra={})=>({schemaVersion:1,status:'ready',generation:'g1',revision:1,memberships,...extra});
function controller(options={}){return api.createController({owner:()=>({uid:'u1',epoch:1}),readIndex:async()=>index([membership()]),readRoom:async()=>room(),...options});}
test('valid ready empty is distinct from pending/error/missing schema',async()=>{
 for(const [value,status] of [[index(),'ready'],[index([],{status:'pending'}),'syncing'],[index([],{status:'error'}),'error'],[{},'error']]){
  let reads=0;const c=controller({readIndex:async()=>value,readRoom:async()=>{reads++;return room()}});await c.load();assert.equal(c.snapshot().status,status);assert.equal(reads,0);assert.equal(c.snapshot().confirmedEmpty===true,status==='ready');
 }
});
test('UID candidate reads deduplicate rooms, remain bounded and never use a global discovery',async()=>{
 let active=0,max=0,reads=0;const members=Array.from({length:12},(_,i)=>membership('BXH-R'+i));
 const c=controller({readIndex:async()=>index(members),readRoom:async()=>{reads++;max=Math.max(max,++active);await pause(2);active--;return room()}});await c.load();assert.equal(reads,12);assert.equal(max,4);assert.equal(c.snapshot().rows.length,12);
});
test('same room family registrations require one room read and preserve all participants',async()=>{
 const ps=[participant(),participant('child1',{kind:'family',registrationId:'f1',familyPlayerId:'c1'}),participant('child2',{kind:'family',registrationId:'f2',familyPlayerId:'c2'})];let reads=0;
 const c=controller({readIndex:async()=>index([membership('BXH-TEST',{participants:ps})]),readRoom:async()=>{reads++;return room()}});await c.load();assert.equal(reads,1);assert.equal(c.snapshot().rows.length,3);assert.equal(c.snapshot().rows.filter(x=>x.group==='unknown').length,2);assert.equal(c.snapshot().confirmedEmpty,false);
});
test('mismatched generation, duplicate code and overflow fail closed before room reads',async()=>{
 for(const members of [[membership('BXH-TEST',{generation:'g0'})],[membership(),membership()],Array.from({length:65},(_,i)=>membership('BXH-R'+i))]){
  let reads=0;const c=controller({readIndex:async()=>index(members),readRoom:async()=>{reads++;return room()}});await c.load();assert.equal(c.snapshot().status,'error');assert.equal(reads,0);
 }
});
test('permission/network/missing/private room never becomes confirmed empty',async()=>{
 for(const fetch of [async()=>{throw Error('permission-denied')},async()=>null,async()=>room({visibility:'private'})]){
  const c=controller({readRoom:fetch});await c.load();assert.equal(c.snapshot().rows[0].group,'unknown');assert.equal(c.snapshot().confirmedEmpty,false);assert.equal(c.snapshot().rows[0].accessible,false);
 }
});
test('single-flight prevents repeated loads while a read is pending',async()=>{
 const d=defer();let reads=0;const c=controller({readIndex:()=>{reads++;return d.promise}});const first=c.load();assert.equal(c.load(true),first);d.resolve(index());await first;assert.equal(reads,1);
});
test('timeout stops UI waiting but retains pending underlying read without overlapping retries',async()=>{
 const d=defer();let reads=0;const c=controller({timeoutMs:5,readIndex:()=>{reads++;return d.promise}});const task=c.load();await pause(12);assert.equal(c.snapshot().reason,'read-timeout');c.load(true);assert.equal(reads,1);d.resolve(index());await task;assert.equal(c.snapshot().status,'error');
});
test('switching accounts and logout/relogin of same UID discard old responses',async()=>{
 for(const next of [{uid:'u2',epoch:2},{uid:'u1',epoch:3}]){
  let owner={uid:'u1',epoch:1};const d=defer();const c=controller({owner:()=>owner,readIndex:()=>d.promise});const task=c.load();owner=next;assert.equal(c.snapshot().status,'idle');d.resolve(index());await task;assert.equal(c.snapshot().status,'idle');
 }
});
test('auth changes during room reads never publish old personal data',async()=>{
 let owner={uid:'u1',epoch:1};const d=defer();const c=controller({owner:()=>owner,readRoom:()=>d.promise});const task=c.load();await pause(0);owner={uid:'u2',epoch:2};d.resolve(room());await task;assert.deepEqual(c.snapshot().rows,[]);
});
test('known successful mutation without a receipt remains unknown, not empty',async()=>{
 const c=controller({readIndex:async()=>index()});c.noteKnownEvent('BXH-NEW');await c.load();assert.equal(c.snapshot().confirmedEmpty,false);assert.equal(c.snapshot().rows[0].group,'unknown');
});
test('only matching opaque authoritative receipt clears known-code overlay',async()=>{
 let revision='other';const c=controller({readIndex:async()=>index([membership('BXH-TEST',{sourceRevision:revision})]),readRoom:async()=>room({tournamentPhase:'done'})});c.noteKnownEvent('BXH-TEST','receipt');await c.load();assert.equal(c.snapshot().confirmedEmpty,false);revision='receipt';await c.load(true);assert.equal(c.snapshot().confirmedEmpty,true);
});
test('name equality never binds a missing or different participant id',()=>{
 for(const id of [null,'wrong'])assert.equal(api.classify(participant(id,{displayName:'Tester'}),room()).group,'unknown');
});
test('cross-day event stays current until actual terminal lifecycle, reopening restores it',()=>{
 const r=room({eventDate:'2000-01-01'});assert.equal(api.classify(participant(),r).group,'current');r.systemClosed=true;assert.equal(api.classify(participant(),r).group,'finished');r.systemClosed=false;assert.equal(api.classify(participant(),r).group,'current');
});
test('waiting, waitlist, lottery and cancelled registrations remain distinct',()=>{
 assert.equal(api.classify(participant(),room({tournamentPhase:'waiting',parsedData:{}})).group,'waiting');
 for(const status of ['waitlist','pending_draw'])assert.equal(api.classify(participant('p1',{registrationStatus:status}),room()).group,'waiting');
 assert.equal(api.classify(participant('p1',{registrationStatus:'cancelled'}),room()).group,'finished');
});
test('single loss ends personal schedule except pending bronze match',()=>{
 const r=room();r.parsedData.matches=[{id:'sf',a:{playerId:'p1'},b:{playerId:'p2'},completed:true,loserId:'p1',round:1}];assert.equal(api.classify(participant(),r).group,'finished');r.parsedData.meta.bronzeMatch=true;assert.equal(api.classify(participant(),r).group,'current');
});
test('double-elimination, winner waiting next round and ambiguous identities never become empty',()=>{
 const r=room();r.parsedData.matches=[];assert.equal(api.classify(participant(),r).group,'unknown');r.parsedData.meta.formatType='double';r.parsedData.matches=[{a:{playerId:'p1'},completed:true,loserId:'p1'}];assert.equal(api.classify(participant(),r).group,'unknown');r.parsedData.players.push({id:'p1',name:'Other'});assert.equal(api.classify(participant(),r).group,'unknown');
});
test('team identities require an exact public team ID and uncertain progression stays unknown',()=>{
 const r=room({battleMode:'team'});r.parsedData.teams=[{id:'team1',name:'Team'}];r.parsedData.matches=[{teamIds:['team1','team2'],completed:false}];assert.equal(api.classify(participant('team1',{kind:'team-captain'}),r).group,'current');assert.equal(api.classify(participant(),r).group,'unknown');r.parsedData.matches=[];assert.equal(api.classify(participant('team1'),r).group,'unknown');
});
test('HTML escapes labels and never displays confirmed no-events for unknown',()=>{
 const text=api.html({status:'ready',confirmedEmpty:false,rows:[{group:'unknown',title:'<img>',reason:'<bad>',code:'BXH-X',accessible:false}]});assert.match(text,/&lt;img&gt;/);assert.doesNotMatch(text,/沒有進行中/);assert.doesNotMatch(text,/data-code/);
});
function readerFixture({second=index(),first=index(),members=[membership()],owner={uid:'u1',epoch:1},error=null,cache=false}={}){
 let stateReads=0;const paths=[];let current=owner;
 const snap=data=>({metadata:{fromCache:cache,hasPendingWrites:false},exists:()=>data!=null,data:()=>data});
 const sdk={doc:(_, ...parts)=>parts.join('/'),collection:(_, ...parts)=>parts.join('/'),limit:n=>n,query:(ref,limit)=>({ref,limit}),
  getDocFromServer:async path=>{paths.push(path);if(error)throw Error(error);return path.startsWith('users/')?snap(stateReads++?second:first):snap({...room(),bracketView:'{}'})},
  getDocsFromServer:async q=>{paths.push(q.ref);assert.equal(q.limit,65);return {metadata:{fromCache:cache,hasPendingWrites:false},forEach:fn=>members.forEach(row=>fn({id:row.code,data:()=>row}))}}};
 const reader=create({sdk,db:{},session:()=>current,reconstruct:()=>room().parsedData});return {reader,paths,setOwner:x=>current=x};
}
test('reader accesses only owner state/members and verifies revision before returning',async()=>{
 const f=readerFixture();const value=await f.reader.readIndex({uid:'u1',epoch:1});assert.equal(value.memberships.length,1);assert.deepEqual(f.paths,['users/u1/activeTournamentMembershipState/current','users/u1/activeTournamentMemberships','users/u1/activeTournamentMembershipState/current']);
});
test('same-generation revision changes are rejected',async()=>{
 const f=readerFixture({second:index([],{revision:2})});await assert.rejects(f.reader.readIndex({uid:'u1',epoch:1}),/index-changed/);
});
test('missing readiness never lists memberships or produces ready empty',async()=>{
 const f=readerFixture({first:null});const result=await f.reader.readIndex({uid:'u1',epoch:1});assert.equal(result.status,'pending');assert.equal(f.paths.length,1);
});
test('offline cache, denied reads and stale owner are errors',async()=>{
 for(const fixture of [{cache:true},{error:'permission-denied'},{owner:{uid:'u1',epoch:3}}]){
  const f=readerFixture(fixture);await assert.rejects(f.reader.readIndex({uid:'u1',epoch:1}));
 }
});
test('invalid room code cannot enter a Firestore path',async()=>{
 const f=readerFixture();await assert.rejects(f.reader.readRoom('../private',{uid:'u1',epoch:1}));assert.equal(f.paths.length,0);
});
test('invalidated pending read notifies after settling so visible UI can reload',async()=>{
 const d=defer();let changes=0;const c=controller({readIndex:()=>d.promise,onChange:()=>changes++});const task=c.load();c.invalidate();const before=changes;d.resolve(index());await task;assert.equal(c.snapshot().status,'idle');assert.equal(changes,before+1);
});
test('missing bracket size cannot prove no bronze path',()=>{
 const r=room();r.parsedData.meta.bronzeMatch=true;delete r.parsedData.bracketSize;r.parsedData.matches=[{a:{playerId:'p1'},completed:true,loserId:'p1',round:1}];assert.equal(api.classify(participant(),r).group,'unknown');
});
test('timeout provides an explicit reload recovery rather than silent retry no-op',()=>{
 const html=api.html({status:'error',retryBlocked:true,rows:[]});assert.match(html,/active-events-reload/);assert.match(html,/active-events-refresh" disabled/);
});

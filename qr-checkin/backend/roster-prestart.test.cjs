'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRosterService}=require('./overlays/roster-service.js');
const {guardFirestore}=require('./guard-firestore.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const code='BXH-DELETE01',root='tournaments/'+code;
 const matches=[{id:'m1',bracket:'SE',round:0,a:{playerId:'a'},b:{playerId:'b'},status:'ready',scoreA:0,scoreB:0,log:[]}];
 const state={id:'room',meta:{battleMode:'individual',checkinRequired:true,registrationAutoFillEnabled:true,registrationCapacity:3},players:[
  {id:'a',name:'A',source:'online',registrationId:'r1',registrationUid:'u1',checkedIn:true},
  {id:'b',name:'B',source:'online',registrationId:'r2',registrationUid:'u2',checkedIn:true},
  {id:'c',name:'C',source:'onsite',checkedIn:false}],waitlistPlayers:[],matches,bracketSize:2,drawnAt:123,bracketDraw:{id:'saved-draw'},registrationRosterRevision:3,qrCheckinManaged:true,qrCheckinRevision:7};
 const common={tournamentPhase:'waiting',registrationStatus:'closed',capacity:3,confirmedCount:2,waitlistCount:1,qrCheckinManaged:true,qrCheckinRevision:7,qrCheckin:{enabled:true,session:'existing-session'}};
 const docs=new Map([[root,{...clone(common),data:JSON.stringify(state)}],['publicTournaments/'+code,{...clone(common),bracketView:JSON.stringify(state)}],
  ['users/admin',{role:'admin',active:true}],['users/u1',{role:'player',active:true}],
  [root+'/registrations/r1',{uid:'u1',displayName:'A',status:'confirmed'}],
  [root+'/registrations/r2',{uid:'u2',displayName:'B',status:'confirmed'}],
  [root+'/registrations/w1',{uid:'u3',displayName:'Waiting',status:'waitlist',createdAt:1}]]);
 const ref=path=>({path,collection:name=>collection(path+'/'+name)});
 const collection=path=>({path,query:true,doc:id=>ref(path+'/'+id),limit(){return this;}});
 const snap=path=>({ref:ref(path),id:path.split('/').pop(),exists:docs.has(path),data:()=>docs.has(path)?clone(docs.get(path)):undefined});
 let writes=0;
 const db={doc:ref,async runTransaction(fn){const pending=[];const tx={async get(r){return r.query?{docs:[...docs.keys()].filter(p=>p.startsWith(r.path+'/')&&!p.slice(r.path.length+1).includes('/')).map(snap)}:snap(r.path);},update(r,p){pending.push({path:r.path,patch:clone(p)});},create(r,p){assert(!docs.has(r.path));pending.push({path:r.path,patch:clone(p)});}};
  const result=await fn(tx);for(const w of pending){docs.set(w.path,{...docs.get(w.path),...w.patch});writes++;}return result;}};
 const run=createRosterService(guardFirestore(db),{serverTimestamp:()=>5000},()=>5000);
 return {docs,state,root,code,get writes(){return writes;},cancel:(data={},uid='admin')=>run({auth:{uid},data:{action:'cancel',code,localId:'c',intent:'admin',operationId:'delete-operation-001',...data}}),runtime:()=>JSON.parse(docs.get(root).data),public:()=>JSON.parse(docs.get('publicTournaments/'+code).bracketView)};
}
test('manager can remove an unpaired onsite player after draw and preserve QR attendance',async()=>{
 const h=fixture(),r=await h.cancel();assert(r.ok);assert.deepEqual(h.runtime().players.map(p=>p.id),['a','b']);
 assert.deepEqual(h.public().players.map(p=>p.id),['a','b']);assert(h.runtime().players.every(p=>p.checkedIn));
 assert.equal(h.runtime().qrCheckinRevision,8);assert.equal(h.docs.get(h.root).qrCheckinRevision,8);
 assert.deepEqual(h.runtime().matches,h.state.matches);assert.equal(h.runtime().bracketDraw.id,'saved-draw');
 assert.equal(r.autoPromoted,false);assert.equal(h.docs.get(h.root).registrationStatus,'closed');
});
test('manager can cancel a paired online player without promoting a replacement or editing saved matches',async()=>{
 const h=fixture(),r=await h.cancel({localId:'',registrationId:'r1'});
 assert(r.ok);assert.equal(h.docs.get(h.root+'/registrations/r1').status,'cancelled');
 assert.equal(h.docs.get(h.root+'/registrations/w1').status,'waitlist');assert.equal(r.autoPromoted,false);
 assert.deepEqual(h.runtime().players.map(p=>p.id),['c','b']);assert.deepEqual(h.public().matches,h.state.matches);
 assert.deepEqual(h.runtime().matches,h.state.matches);assert.equal(h.runtime().registrationRosterRevision,4);
 assert.equal(h.docs.get(h.root).confirmedCount,1);assert.equal(h.docs.get('publicTournaments/'+h.code).confirmedCount,1);
 const writes=h.writes;assert.equal((await h.cancel({localId:'',registrationId:'r1'})).replayed,true);assert.equal(h.writes,writes);
});
test('ordinary player cancellation remains locked after draw',async()=>{
 const h=fixture(),before=JSON.stringify([...h.docs]);
 await assert.rejects(h.cancel({localId:'',registrationId:'r1',intent:'player'},'u1'),/bracket-locked/);
 assert.equal(JSON.stringify([...h.docs]),before);
});
for(const boundary of ['private-start','public-start','score','result','completed'])test(boundary+' blocks manager deletion atomically',async()=>{
 const h=fixture(),t=h.docs.get(h.root),p=h.docs.get('publicTournaments/'+h.code),s=h.runtime();
 if(boundary==='private-start')s.startedAt=10;
 if(boundary==='public-start')p.startedAt=10;
 if(boundary==='score')s.matches[0].scoreA=1;
 if(boundary==='result')s.matches[0].completed=true;
 if(boundary==='completed')s.archiveStatus='completed';
 t.data=JSON.stringify(s);const before=JSON.stringify([...h.docs]);
 await assert.rejects(h.cancel(),/bracket-locked|roster-locked/);assert.equal(JSON.stringify([...h.docs]),before);
});
test('another player cannot use the manager cancellation intent',async()=>{
 const h=fixture();await assert.rejects(h.cancel({},'u1'),/permission-denied/);assert.equal(h.writes,0);
});

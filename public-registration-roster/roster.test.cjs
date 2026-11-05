'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const {projection,createSync}=require('./functions/service.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(n=60,old=53){
  const rows=Array.from({length:n},(_,i)=>({registrationId:'r'+i,uid:'u'+i,status:'confirmed',displayName:'玩家'+i,phone:'private',email:'private'}));
  const players=rows.slice(0,old).map((r,i)=>({id:'online_'+r.registrationId,name:r.displayName,registrationId:r.registrationId,registrationUid:r.uid,source:'online',checkedIn:i===0}));
  const state={meta:{checkinRequired:true},players,matches:[]};
  const common={visibility:'public',registrationVisibility:'public',registrationEnabled:true,tournamentPhase:'waiting',confirmedCount:n,waitlistCount:0,updatedAt:123};
  return {t:{...common,data:JSON.stringify(state)},p:{...common,bracketView:JSON.stringify({players:players.map(({id,name,checkedIn})=>({id,name,checkedIn}))})},rows};
}
function ui(){
  const source=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
  const c={esc:s=>String(s)};vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function lobbyRosterView('),source.indexOf('\nfunction lobbyCard(')),c);
  return c;
}
const summary=x=>({raw:{...x.p,parsedData:JSON.parse(x.p.bracketView)},registrationEnabled:true,confirmedCount:x.p.confirmedCount,phase:'waiting',battleMode:'individual',code:'BXH-TEST'});
test('60 registrations / 53 old names: public projection catches up without private fields',()=>{
  const x=fixture(),before=clone(x),out=projection(x.t,x.p,x.rows);
  assert.equal(out.players.length,60);assert.equal(out.players[0].checkedIn,true);assert.equal(out.players[59].checkedIn,false);
  assert(out.players.every(p=>Object.keys(p).sort().join(',')==='checkedIn,id,name'));
  assert(!JSON.stringify(out).includes('private'));assert.deepEqual(x,before);
});
test('cancellation, promotion and same-count replacement use latest status, preserving attendance',()=>{
  const x=fixture(3,3);x.rows[0].status='cancelled';x.rows.push({registrationId:'r3',uid:'u3',status:'confirmed',displayName:'遞補者'});
  const out=projection(x.t,x.p,x.rows);
  assert.deepEqual(out.players.map(p=>p.id),['online_r1','online_r2','online_r3']);
  assert.equal(out.players.at(-1).checkedIn,false);
  x.rows[1].status='waitlist';x.t.confirmedCount=x.p.confirmedCount=2;x.t.waitlistCount=x.p.waitlistCount=1;
  assert.equal(projection(x.t,x.p,x.rows).players.length,2);
});
test('family siblings and onsite people retain distinct IDs and attendance',()=>{
  const x=fixture(0,0),state=JSON.parse(x.t.data);
  state.players=[{id:'local1',name:'現場選手',source:'local',checkedIn:true},
    {id:'family_c1',name:'孩子一',source:'online',familyPlayerId:'c1',registrationId:'old1',checkedIn:true}];
  x.t.data=JSON.stringify(state);x.t.confirmedCount=x.p.confirmedCount=2;
  x.rows=[{registrationId:'new1',uid:'guardian',familyPlayerId:'c1',status:'confirmed',displayName:'孩子一'},
    {registrationId:'new2',uid:'guardian',familyPlayerId:'c2',status:'confirmed',displayName:'孩子二'}];
  const out=projection(x.t,x.p,x.rows);
  assert.equal(out.players.length,3);assert.equal(out.players.find(p=>p.id==='family_c1').checkedIn,true);
  assert.equal(out.players.find(p=>p.id==='family_c2').checkedIn,false);
});
test('unsupported lifecycles and modes are left to their current authoritative services',()=>{
  for(const [field,value] of [['tournamentPhase','live'],['visibility','private'],['registrationVisibility','private'],['registrationSelection',{}],['onsiteWaitlistServerOwned',true],['scoreStorage',{}],['battleMode','team'],['systemClosed',true]]){
    const x=fixture();x.t[field]=value;assert.equal(projection(x.t,x.p,x.rows),null,field);
  }
  const x=fixture();const s=JSON.parse(x.t.data);s.matches=[{id:'m1'}];x.t.data=JSON.stringify(s);
  assert.equal(projection(x.t,x.p,x.rows),null);
});
test('incomplete or inconsistent reads never publish invented counts or partial names',()=>{
  const x=fixture();assert.throws(()=>projection(x.t,x.p,x.rows.slice(1)),/count-conflict/);
  x.p.confirmedCount--;assert.throws(()=>projection(x.t,x.p,x.rows),/count-conflict/);
});
function store(x,{stale=false,disabled=false}={}){
  const writes=[],locks=[];let version=1;
  const stamp=n=>({isEqual:other=>n===other.n,n});
  const snap=value=>({exists:true,data:()=>clone(value),updateTime:stamp(version)});
  const db={doc(path){return {path,get:async()=>snap(path.startsWith('tournaments/')?x.t:path.startsWith('publicTournaments/')?x.p:{enabled:!disabled}),collection(){return {get:async()=>({docs:x.rows.map(r=>({id:r.registrationId,data:()=>clone(r)}))})};}};},
    async runTransaction(fn){if(stale)version++;return fn({get:async ref=>{locks.push(ref.path);return snap(x.p);},update(ref,patch){writes.push({path:ref.path,patch});Object.assign(x.p,patch);version++;}});}};
  return {db,writes,locks};
}
test('sync writes only the public overlay; no private room lock, counter, runtime or registration mutation',async()=>{
  const x=fixture(),s=store(x),before=clone(x.t);await createSync(s.db)('BXH-TEST');
  assert.deepEqual(s.locks,['publicTournaments/BXH-TEST']);assert.equal(s.writes.length,1);
  assert.deepEqual(Object.keys(s.writes[0].patch),['publicRegistrationRoster']);assert.deepEqual(x.t,before);
  await createSync(s.db)('BXH-TEST');assert.equal(s.writes.length,1,'duplicate events must not rewrite the public doc');
});
test('source changes while reading / emergency disable produce no public writes',async()=>{
  const x=fixture(),s=store(x,{stale:true});await assert.rejects(createSync(s.db)('BXH-TEST'),/source-changed/);assert.equal(s.writes.length,0);
  const disabled=store(fixture(),{disabled:true});await createSync(disabled.db)('BXH-TEST');assert.equal(disabled.writes.length,0);
});
test('53-name UI shows authoritative 60 and synchronizing; fresh snapshot removes indicator',()=>{
  const x=fixture(),c=ui(),t=summary(x);
  assert.match(c.lobbyPlayerRosterHtml(t),/正取 60 人 · 名單更新中/);
  assert.match(c.lobbyPlayerRosterHtml(t),/已顯示 53 位/);
  t.raw.publicRegistrationRoster=projection(x.t,x.p,x.rows);
  assert.equal(c.lobbyPublicPlayers(t).length,60);assert.doesNotMatch(c.lobbyPlayerRosterHtml(t),/名單更新中/);
});
test('same-count replacement waits for a matching source; live/bracket views retain runtime IDs',()=>{
  const x=fixture(),c=ui(),t=summary(x);t.raw.publicRegistrationRoster=projection(x.t,x.p,x.rows);
  t.raw.updatedAt++;assert.equal(c.lobbyPublicPlayers(t).length,53);
  t.raw.updatedAt--;t.raw.parsedData.players[0].checkedIn=false;assert.equal(c.lobbyPublicPlayers(t).length,53);
  t.phase='live';assert.equal(c.lobbyPublicPlayers(t).length,53);assert.doesNotMatch(c.lobbyPlayerRosterHtml(t),/名單更新中/);
});
test('empty authoritative snapshot removes cancelled stale runtime names',()=>{
  const x=fixture(2,2),c=ui();x.rows.forEach(r=>r.status='cancelled');x.t.confirmedCount=x.p.confirmedCount=0;
  const t=summary(x);t.raw.publicRegistrationRoster=projection(x.t,x.p,x.rows);
  assert.equal(c.lobbyPublicPlayers(t).length,0);assert.match(c.lobbyPlayerRosterHtml(t),/>0 人</);
});
test('a private real name is never used as the public-name fallback',()=>{
  const x=fixture(1,0);delete x.rows[0].displayName;x.rows[0].realName='private legal name';
  assert.throws(()=>projection(x.t,x.p,x.rows),/public-name-missing/);
});
test('both entrypoints use retry, constrained concurrency and the intended document paths',()=>{
  const hooks=[],x=fixture(),s=store(x);
  const context={exports:{},require(name){
    if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(options,handler)=>{hooks.push({options,handler});return handler;}};
    if(name==='firebase-admin/firestore')return {getFirestore:()=>s.db};
    if(name==='./service.cjs')return {createSync};
    throw Error('unexpected module '+name);
  }};
  vm.runInNewContext(fs.readFileSync(__dirname+'/functions/index.js','utf8'),context);
  assert.deepEqual(hooks.map(h=>h.options.document),['tournaments/{code}/registrations/{registrationId}','tournaments/{code}']);
  for(const h of hooks){assert.equal(h.options.retry,true);assert.equal(h.options.maxInstances,1);assert.equal(h.options.concurrency,1);}
  assert.equal(Object.keys(context.exports).length,2);
});

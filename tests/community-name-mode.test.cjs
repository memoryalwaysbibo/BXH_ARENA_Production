'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const Names=require('../modules/main-app/participant-names.js');
const {prepareFamilySource}=require('../community-name-mode/prepare-family.cjs');
const capture=require('../registration-flow-v2/tests/captured-family-source.json');
const original=capture.blobs[capture.files['family-registration.js']];
const digest=createHash('sha256').update(original).digest('hex');
const patched=prepareFamilySource(original,digest);
const profile={active:true,realName:'本人本名',gameId:'本人ID',phone:'',profileCompleted:true,preferredNameMode:'gameId'};
const metadata=participantNameMode=>({eventAuthority:'community',ladderMode:'general',participantNameMode});
const clone=x=>JSON.parse(JSON.stringify(x));

test('same name policy executes in browser and backend',()=>{
  const ctx=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/main-app/participant-names.js'),'utf8'),ctx);
  for(const mode of ['realName','gameId','any'])assert.deepEqual(clone(ctx.window.BXHParticipantNames.participantIdentity(metadata(mode),profile)),Names.participantIdentity(metadata(mode),profile));
});
test('unrestricted naming respects personal preferences and trims empty IDs',()=>{
  assert.equal(Names.participantIdentity(metadata('any'),profile).displayName,'本人ID');
  assert.equal(Names.participantIdentity(metadata('any'),{...profile,preferredNameMode:'realName'}).displayName,'本人本名');
  assert.equal(Names.participantIdentity(metadata('gameId'),{...profile,gameId:'  '}).displayName,'本人本名');
  assert.equal(Names.participantIdentity(metadata('any'),{...profile,gameId:''}).displayName,'本人本名');
});
test('child names never fall through to guardian IDs',()=>{
  for(const mode of ['gameId','any']){
    assert.equal(Names.participantIdentity(metadata(mode),profile,{name:'孩子',nickname:'兒童ID'}).displayName,'兒童ID');
    assert.equal(Names.participantIdentity(metadata(mode),profile,{name:'孩子',nickname:' '}).displayName,'孩子');
  }
});
test('ranked and unknown policies fail closed to real names',()=>{
  for(const mode of ['gameId','any','invalid'])assert.equal(Names.participantIdentity({...metadata(mode),ladderMode:'ranked'},profile).displayName,'本人本名');
  assert.equal(Names.participantIdentity({...metadata('any'),eventAuthority:'official'},profile).displayName,'本人本名');
});
test('patch rejects an unverified source, duplicate anchor and already patched handler',()=>{
  assert.throws(()=>prepareFamilySource(original,'0'.repeat(64)),/baseline-mismatch/);
  for(const source of [patched,original+original])assert.throws(()=>prepareFamilySource(source,createHash('sha256').update(source).digest('hex')),/anchor-mismatch/);
  new vm.Script(patched);
});

function harness(mode,overrides={},authority='community'){
  const now=100000,uid='test-user',code='BXH-TEST01',docs=new Map();
  const runtime={id:'test-room',players:[],waitlistPlayers:[],matches:[],meta:{...metadata(mode),eventAuthority:authority},archiveStatus:'ongoing'};
  const common={...metadata(mode),eventAuthority:authority,communityQuickRegistration:authority==='community',visibility:'public',registrationVisibility:'public',registrationEnabled:true,publishedAt:1,tournamentPhase:'waiting',confirmedCount:0,waitlistCount:0,capacity:authority==='community'?null:32,registrationOpenAt:authority==='community'?null:1,registrationCloseAt:authority==='community'?null:200000,cancellationDeadline:authority==='community'?null:200000};
  docs.set('users/'+uid,{...profile,...overrides});
  docs.set('familyPlayers/'+uid,{profiles:[{id:'child',name:'孩子',nickname:'兒童ID',guardianUid:uid,playerId:'CHILD01'}]});
  docs.set('tournaments/'+code,{...common,data:JSON.stringify(runtime)});
  docs.set('publicTournaments/'+code,{...common,bracketView:JSON.stringify(runtime)});
  const snapshot=ref=>({id:ref.id,exists:docs.has(ref.path),data:()=>clone(docs.get(ref.path)||null)});
  const collection=p=>({path:p,collection:true,doc:id=>reference(p+'/'+id)});
  const reference=p=>({path:p,id:p.split('/').at(-1),get:async()=>snapshot(reference(p)),collection:name=>collection(p+'/'+name)});
  const db={doc:reference,runTransaction:async fn=>{
    const pending=[];
    const get=async ref=>ref.collection===true?{docs:[...docs.keys()].filter(k=>k.startsWith(ref.path+'/')&&k.split('/').length===ref.path.split('/').length+1).map(k=>snapshot(reference(k)))}:snapshot(ref);
    const result=await fn({get,getAll:async(...refs)=>Promise.all(refs.map(get)),set:(r,d)=>pending.push([r.path,d]),update:(r,d)=>pending.push([r.path,{...docs.get(r.path),...d}]),create:(r,d)=>{assert(!docs.has(r.path));pending.push([r.path,d]);}});
    for(const [key,value]of pending)docs.set(key,clone(value));
    return result;
  }};
  const cache=new Map();
  function load(file,source){
    if(cache.has(file))return cache.get(file);
    const module={exports:{}};
    const requireCaptured=name=>{
      if(name.startsWith('node:'))return require(name);
      if(name==='./participant-names.js')return Names;
      if(name==='./_qr_checkin/admin-firestore.cjs')return {FieldValue:{serverTimestamp:()=>now}};
      if(name==='./onsite-waitlist-writer-guards')return {onsiteWaitlistOwned:()=>false};
      if(name==='./registration-admission.cjs')return {createAdmission:()=>async(_code,fn)=>fn()};
      const key=name.replace(/^\.\//,'').replace(/\.js$|\.cjs$/,'');
      const candidate=[key+'.js',key+'.cjs'].find(x=>capture.files[x]);
      if(!candidate)throw Error('Unexpected dependency '+name);
      return load(candidate,capture.blobs[capture.files[candidate]]);
    };
    new Function('require','module','exports',source)(requireCaptured,module,module.exports);
    cache.set(file,module.exports);return module.exports;
  }
  const handler=load('family-registration.js',patched).createFamilyRegistration(db,()=>now);
  const request=(action='join',childIds=[null])=>({auth:{uid},data:{action,code,childIds,operationId:'operation_12345',childEligibilityConfirmed:true}});
  return {handler,request,docs,uid,code};
}
for(const [mode,name]of [['realName','本人本名'],['gameId','本人ID'],['any','本人ID']]){
  test(mode+' preview and join persist identical names into registration and both rosters',async()=>{
    const h=harness(mode);
    const preview=await h.handler(h.request('preview'));
    assert.equal(preview.rows[0].participantName,name);
    const joined=await h.handler(h.request());
    assert.equal(joined.rows[0].participantName,name);
    const reg=h.docs.get('tournaments/'+h.code+'/registrations/'+h.uid);
    assert.equal(reg.displayName,name);assert.equal(reg.realName,'本人本名');assert.equal(reg.gameId,'本人ID');
    assert.equal(JSON.parse(h.docs.get('tournaments/'+h.code).data).players[0].name,name);
    assert.equal(JSON.parse(h.docs.get('publicTournaments/'+h.code).bracketView).players[0].name,name);
    h.docs.set('users/'+h.uid,{...profile,gameId:'之後修改的ID'});
    const replay=await h.handler(h.request());assert.equal(replay.replayed,true);assert.equal(replay.rows[0].participantName,name);
    assert.equal(h.docs.get('tournaments/'+h.code).confirmedCount,1);
  });
}
test('family join preserves distinct child ID and account name under unrestricted policy',async()=>{
  const h=harness('any');await h.handler(h.request('join',[null,'child']));
  const players=JSON.parse(h.docs.get('tournaments/'+h.code).data).players;
  assert.equal(players.find(p=>p.familyPlayerId==='child').name,'兒童ID');
  assert.equal(players.find(p=>!p.familyPlayerId).name,'本人ID');
});
test('backend unrestricted fallback uses real name when account ID is absent',async()=>{
  const h=harness('any',{gameId:'  '});const r=await h.handler(h.request());assert.equal(r.rows[0].participantName,'本人本名');
});
test('official registration keeps existing name behavior',async()=>{
  const h=harness('realName',{},'official');const r=await h.handler(h.request());assert.equal(r.rows[0].participantName,'本人本名');
});

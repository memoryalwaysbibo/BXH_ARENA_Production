'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../modules/main-app/bracket-commit.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:x=>resolve(x)};};
function room(){return {id:'r',cloudCode:'ROOM',updatedAt:1,meta:{formatType:'single'},players:[{id:'a'},{id:'b'}],matches:[],archiveStatus:'ongoing'};}
function fixture(){
 let local=room(),remote=clone(local),pub=clone(local),count=0,success=0,applied=0,active=true,writes=[];
 const storage=new Map(),ctx={minimumFeedbackMs:0,key:'u:ROOM',actorUid:'u',storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},current:()=>active,state:()=>local,cloud:()=>true,operationId:()=> 'op'+count,
 generate:()=>({...clone(local),drawnAt:100+count++,bracketSize:2,matches:[{id:'m'+count,bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}]}),
 read:async()=>({ok:true,data:clone(remote),publicData:clone(pub)}),
 write:async(s,o)=>{writes.push(clone(s));api.assertWrite(remote,s,o);remote=clone(s);pub=clone(s);return true;},
 apply:s=>{local=clone(s);applied++;},local:async()=>true,changed(){},success:()=>success++};
 return {ctx,make:()=>api.create(ctx),get local(){return local;},get remote(){return remote;},set remote(v){remote=v;},set pub(v){pub=v;},get count(){return count;},get success(){return success;},get applied(){return applied;},writes,storage,leave:()=>active=false};
}
test('delayed write blocks start/re-draw and never reports success before readback',async()=>{
 const h=fixture(),wait=deferred(),write=h.ctx.write;h.ctx.write=async(...args)=>{await wait.promise;return write(...args);};
 const c=h.make(),promise=c.begin();await tick();assert(c.blocked());assert.equal(h.success,0);assert.equal(h.local.matches.length,0);assert.equal(await c.begin(),false);assert.equal(await c.verify(h.local),false);
 wait.resolve();assert.equal(await promise,true);assert.equal(h.success,1);assert.equal(h.local.matches.length,1);assert(!c.blocked());assert.equal(h.local.bracketDrawHistory.length,1);assert(h.local.updatedAt>1);
});
test('failed save survives controller recreation and retries identical draw exactly once',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async()=>false;
 const c=h.make();assert.equal(await c.begin(),false);assert(c.blocked());const saved=[...h.storage.values()][0];assert(saved);h.ctx.write=write;const recovered=h.make();assert(recovered.blocked());assert.equal(await recovered.retry(),true);assert.equal(h.count,1);assert.equal(h.writes.length,1);assert.equal(h.writes[0].bracketDraw.id,JSON.parse(saved).snapshot.bracketDraw.id);assert.equal(h.storage.size,0);
});
test('commit with lost acknowledgement is recovered by readback without re-draw/write',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async(...args)=>{await write(...args);return false;};const c=h.make();
 assert.equal(await c.begin(),false);assert.equal(await c.retry(),true);assert.equal(h.count,1);assert.equal(h.writes.length,1);assert.equal(h.success,1);
});
test('mismatching public projection keeps the draw unconfirmed',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async(...args)=>{const ok=await write(...args);h.pub=room();return ok;};const c=h.make();
 assert.equal(await c.begin(),false);assert.equal(h.success,0);assert(c.blocked());assert.equal(h.applied,0);
});
test('account/room switch discards late UI replies',async()=>{
 const h=fixture(),wait=deferred(),write=h.ctx.write;h.ctx.write=async(...args)=>{await wait.promise;return write(...args);};const c=h.make(),p=c.begin();await tick();h.leave();wait.resolve();await p;assert.equal(h.applied,0);assert.equal(h.success,0);assert.equal(h.storage.size,1);
});
test('timeout keeps the same recoverable candidate and no success',async()=>{
 const h=fixture();h.ctx.timeoutMs=5;h.ctx.write=()=>new Promise(()=>{});const c=h.make();assert.equal(await c.begin(),false);assert(c.blocked());assert.equal(h.success,0);assert.equal(h.count,1);
});
test('start verification rejects a cloud draw with identical roster but different pairing ID',async()=>{
 const h=fixture(),c=h.make();await c.begin();assert.equal(await c.verify(h.local),true);const changed=clone(h.remote);changed.matches[0].id='new-draw';h.remote=changed;h.pub=clone(changed);assert.equal(await c.verify(h.local),false);
});
test('cloud read/discard restores authoritative state only after successful server read',async()=>{
 const h=fixture();h.ctx.write=async()=>false;const c=h.make();await c.begin();h.ctx.read=async()=>({ok:false});await c.discard();assert(c.blocked());h.ctx.read=async()=>({ok:true,data:room(),publicData:room()});await c.discard();assert(!c.blocked());assert.equal(h.local.matches.length,0);assert.equal(h.writes.length,0);
});
test('transaction fence rejects competing draw, stale start, old client and start rollback',()=>{
 const base=room(),candidate={...clone(base),drawnAt:1,bracketSize:2,matches:[{id:'m'}],bracketDraw:{id:'one'}},options={bracketCommit:{baseSignature:api.signature(base)}};
 assert.equal(api.assertWrite(base,candidate,options),'write');assert.equal(api.assertWrite(candidate,candidate,options),'already-committed');
 const second={...clone(candidate),bracketDraw:{id:'two'}};assert.throws(()=>api.assertWrite(candidate,second,options),/version-conflict/);
 assert.throws(()=>api.assertWrite(candidate,base),/version-conflict/);
 assert.throws(()=>api.assertWrite(candidate,{...candidate,startedAt:2},{bracketStartSignature:api.signature(base)}),/version-conflict/);
 assert.equal(api.assertWrite(candidate,{...candidate,startedAt:2},{bracketStartSignature:api.signature(candidate)}),'write');
 assert.throws(()=>api.assertWrite({...candidate,startedAt:2},candidate),/bracket-started/);
});
test('BYE auto-completions do not block pre-start reshuffle',()=>{
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),a=core.indexOf('function canReshuffleBracket(){'),b=core.indexOf('\n}',a)+2;
 const ctx={window:{},state:{bracketSize:256,matches:[{isBye:true,completed:true,winnerId:'p'},{isBye:false,completed:false,log:[],scoreA:0,scoreB:0}]}};vm.createContext(ctx);vm.runInContext(core.slice(a,b),ctx);assert.equal(ctx.canReshuffleBracket(),true);ctx.state.startedAt=1;assert.equal(ctx.canReshuffleBracket(),false);
});
test('actual cloud transaction and server-only private/public readback enforce version',async()=>{
 // Reuse the existing cloud transaction fixture with the actual production methods.
 let fixtureSource=fs.readFileSync('tests/assignment-cloud-confirmation.test.cjs','utf8').split("\ntest('staff save")[0];
 fixtureSource=fixtureSource.replace('window:{},console:','window:{BXHBracketCommit:bracketApi},console:').replace("['pushUpdate','saveStaffAssignments','saveRefereeStationAssignments']","['pushUpdate','readBracketFromServer','saveStaffAssignments','saveRefereeStationAssignments']").replace("return {api:context.api,docs,reads,stale,logs,","return {context,api:context.api,docs,reads,stale,logs,");
 const outer={require,bracketApi:api};vm.createContext(outer);vm.runInContext(fixtureSource+'\nglobalThis.h=harness();globalThis.initial=room();',outer);
 const h=outer.h;h.context.buildPublicMirrorFields=s=>clone(s);
 const old=clone(outer.initial),future=Date.now()+60000;h.docs.get('tournaments/ROOM').data=JSON.stringify({...old,updatedAt:future});
 const candidate={...clone(old),drawnAt:1,bracketSize:2,matches:[{id:'new',bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}],bracketDraw:{id:'draw-one'}};
 assert.equal(await h.api.pushUpdate('ROOM',candidate,{bracketCommit:{baseSignature:api.signature(old)}}),true);
 const read=await h.api.readBracketFromServer('ROOM');assert.equal(read.ok,true);assert(read.data.updatedAt>future);assert.equal(api.signature(read.data),api.signature(read.publicData));assert.deepEqual(Array.from(h.reads).slice(-2),['tournaments/ROOM','publicTournaments/ROOM']);
 assert.equal(await h.api.pushUpdate('ROOM',old),false);assert.equal(JSON.parse(h.docs.get('tournaments/ROOM').data).bracketDraw.id,'draw-one');
 assert.equal(await h.api.pushUpdate('ROOM',{...clone(candidate),startedAt:2},{bracketStartSignature:api.signature(old)}),false);
 assert.equal(await h.api.pushUpdate('ROOM',{...clone(candidate),startedAt:2},{bracketStartSignature:api.signature(candidate)}),true);
});

test('failed transaction cannot mutate the saved candidate fences before retry',async()=>{
 const h=fixture(),write=h.ctx.write;let first=true;h.ctx.write=async(s,o)=>{if(first){first=false;s.qrCheckinRevision=999;s.matches[0].id='mutated';return false;}return write(s,o);};
 const c=h.make();assert.equal(await c.begin(),false);assert.equal(await c.retry(),true);assert.equal(h.local.matches[0].id,'m1');assert.equal(h.local.qrCheckinRevision,undefined);assert.equal(h.count,1);
});
test('storage failure prevents the candidate from being sent',async()=>{
 const h=fixture();h.ctx.storage.setItem=()=>{throw Error('quota');};const c=h.make();assert.equal(await c.begin(),false);assert.equal(await c.retry(),false);assert.equal(h.writes.length,0);assert.equal(h.success,0);
});

test('account switch during server preflight never sends a write',async()=>{
 const h=fixture(),read=h.ctx.read,wait=deferred();h.ctx.read=async()=>{await wait.promise;return read();};const c=h.make(),p=c.begin();await tick();h.leave();wait.resolve();await p;assert.equal(h.writes.length,0);assert.equal(h.applied,0);
});

test('a redraw started during start verification keeps start blocked',async()=>{
 const h=fixture(),c=h.make();await c.begin();const read=h.ctx.read,wait=deferred();h.ctx.read=async()=>{await wait.promise;return read();};
 const verify=c.verify(h.local),draw=c.begin();wait.resolve();assert.equal(await verify,false);await draw;
});

test('single submit action retries the same persisted pairing after upload failure',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async()=>false;const c=h.make();
 assert.equal(await c.submit(),false);assert.equal(c.status().result,'failed');
 const saved=[...h.storage.values()][0];h.ctx.write=write;
 assert.equal(await c.submit(),true);assert.equal(h.count,1);assert.equal(h.writes.length,1);
 assert.equal(h.local.bracketDraw.id,JSON.parse(saved).snapshot.bracketDraw.id);assert.equal(c.status().result,'success');
});
test('single submit automatically adopts a competing cloud version without overwriting it',async()=>{
 const h=fixture();h.ctx.write=async()=>false;const c=h.make();await c.submit();
 const latest={...room(),drawnAt:200,bracketSize:2,matches:[{id:'other-draw'}],bracketDraw:{id:'other'}};h.remote=clone(latest);h.pub=clone(latest);
 assert.equal(await c.submit(),false);assert.equal(c.status().result,'failed');assert.equal(c.status().error,'bracket-version-conflict');
 assert(!c.blocked());assert.equal(h.local.bracketDraw.id,'other');assert.equal(h.count,1);assert.equal(h.writes.length,0);assert.equal(h.success,0);assert.equal(h.storage.size,0);
});
test('unreadable cloud state keeps pending pairing instead of treating a read error as a competing edit',async()=>{
 const h=fixture();h.ctx.write=async()=>false;const c=h.make();await c.submit();h.ctx.read=async()=>({ok:false});
 assert.equal(await c.submit(),false);assert(c.blocked());assert.equal(c.status().error,'cloud-readback-unconfirmed');assert.equal(h.count,1);assert.equal(h.applied,0);assert.equal(h.storage.size,1);
});

test('cloud draw visibly waits at least two seconds and completes without confirmation click',async()=>{
 const h=fixture();delete h.ctx.minimumFeedbackMs;const c=h.make(),at=Date.now(),p=c.submit();
 await tick();assert(c.busy());assert(c.blocked());assert.equal(h.success,0);
 await new Promise(r=>setTimeout(r,100));assert(c.busy());assert.equal(h.success,0);
 assert.equal(await p,true);assert(Date.now()-at>=1950);assert.equal(h.success,1);assert.equal(c.status().result,'success');assert(!c.busy());
});

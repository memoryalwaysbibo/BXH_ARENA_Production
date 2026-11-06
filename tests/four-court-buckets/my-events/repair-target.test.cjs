'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const B=require('../../../release/buckets/completion/protocol/state.cjs');
const {readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const {normalizeLifecycle}=require('./deployed-lifecycle.cjs');
const file=path.join(__dirname,'deployed-engine.cjs');
function engine(){
 const source=fs.readFileSync(file,'utf8');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'3b5f36dc1e0419284c9301a50f3f0eedba67c5f9d5b31921b473e306557afe86');
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 m.require=id=>id==='./lifecycle'?{normalizeLifecycle}:id==='./owners'?{collectOwners:()=>{throw Error('not used');}}:module.require(id);
 m._compile(source,file);return m.exports;
}
const code='BXH-TEST01',p='tournaments/'+code,pp='publicTournaments/'+code;
function caseOf(){
 const state={id:'room-1',cloudCode:code,meta:{stations:6},players:[],
  matches:[{id:'m1',station:1,completed:true,isBye:false,a:{playerId:'a'},b:{playerId:'b'},dispatchRevision:0,refereeSeatScoreRevision:0}],
  startedAt:1,archiveStatus:'completed'};
 const manifest=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,manifest);
 const top={data:JSON.stringify(state),scoreStorage:manifest,archiveStatus:'completed',tournamentPhase:'done'};
 const pub={scoreBucketProjection:{epoch:manifest.epoch,versions:Object.fromEntries(buckets.map(x=>[x.bucketId,x.revision]))},archiveStatus:'completed'};
 const rows=new Map([[p,top],[pp,pub],...buckets.map(b=>[p+'/matchBuckets/'+b.bucketId,b])]);
 const ref=x=>({path:x,id:x.split('/').at(-1),collection:y=>({doc:z=>ref(x+'/'+y+'/'+z)})});
 const snap=x=>({exists:rows.has(x),id:x.split('/').at(-1),ref:ref(x),data:()=>rows.get(x),createTime:{seconds:x===p?1:2,nanoseconds:0}});
 const db={doc:ref},tx={get:async x=>snap(x.path)};
 return {room:snap(p),db,tx};
}
test('deployed repair target trusts unsealed root done while split verifier refuses',async()=>{
 const f=caseOf();
 assert.equal(engine().target(f.room),'inactive');
 const lifecycle=await readRoomLifecycle({db:f.db,tx:f.tx,room:f.room,code,normalizeRoom:normalizeLifecycle});
 assert.deepEqual(lifecycle,{status:'invalid',reason:'bucket-lifecycle-unverified'});
});

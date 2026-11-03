'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),B=require(path.join(root,'referee-seats/functions/bucket-state.cjs'));
const service=require(path.join(root,'modules/scoring/four-court-settlement.js'));
const clone=x=>JSON.parse(JSON.stringify(x)),hash=async text=>createHash('sha256').update(text).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
function fixture(done=true,kind='ranked'){
 const state={id:'room-1',cloudCode:'BXH-TST1',meta:{stations:6,ladderMode:kind},matches:[],players:[],archiveStatus:'completed',settlementPhase:'completed',settlementCompletedAt:100,ladderPointsAwarded:true,ladderSeasonId:'S1',ladderResults:[{uid:'a'},{uid:'b'}],ladderSkippedPlayers:[]};
 const m=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,m),versions=Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]));
 const c={version:1,status:'completed',epoch:m.epoch,versions,completedAt:100};
 const top={ladderMode:kind,scoreStorage:m,data:JSON.stringify(state),archiveStatus:'completed',ladderPointsAwarded:true,ladderSeasonId:'S1',ladderResults:state.ladderResults,ladderSkippedPlayers:[],bucketSettlement:{...c,sourceCreatedAt:'5:0',stateDigest:createHash('sha256').update(JSON.stringify(stable(state))).digest('hex')}};
 const pub={archiveStatus:'completed',scoreBucketProjection:{epoch:m.epoch,versions},bucketSettlement:c};
 if(kind==='general'){
  state.settlementRoute='no-ladder';delete state.ladderPointsAwarded;delete state.ladderSeasonId;delete state.ladderResults;delete state.ladderSkippedPlayers;
  delete top.ladderPointsAwarded;delete top.ladderSeasonId;delete top.ladderResults;delete top.ladderSkippedPlayers;
  top.bucketCompletion=top.bucketSettlement;delete top.bucketSettlement;pub.bucketCompletion=pub.bucketSettlement;delete pub.bucketSettlement;
 }
 if(!done){delete top.bucketSettlement;delete pub.bucketSettlement;delete top.bucketCompletion;delete pub.bucketCompletion;top.archiveStatus='ongoing';pub.archiveStatus='ongoing';state.archiveStatus='ongoing';state.settlementPhase='idle';delete top.ladderPointsAwarded;delete state.ladderPointsAwarded;}
 top.data=JSON.stringify(state);const cert=top.bucketSettlement||top.bucketCompletion;if(cert)cert.stateDigest=createHash('sha256').update(JSON.stringify(stable(state))).digest('hex');
 return {top,pub,buckets,expected:{id:state.id,code:state.cloudCode,epoch:m.epoch,mode:kind}};
}
function functionSource(source,name){const i=source.indexOf('async function '+name+'(');assert(i>=0);return source.slice(i,source.indexOf('\n}',i)+2);}
function sources(){const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8'),cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');return {core:functionSource(core,'performBucketArchive')+'\n'+functionSource(core,'performAutoArchiveState'),cloud:cloud.slice(cloud.indexOf('    async settleBucketTournament('),cloud.indexOf('    async settleLadderTournament(')).trim().replace(/,$/,'')};}
// Run the actual core functions and cloud adapter with an instrumented SDK boundary.
async function hostScenario({mode='done',switchRoom=false,switchUser=false,storageFail=false,kind='ranked',role='admin'}={},browser=false){
 const src=sources();return {src,fixture:fixture(mode==='done'&&!switchRoom&&!switchUser,kind),options:{mode,switchRoom,switchUser,storageFail,kind,role}};
}
async function runHost(payload,env){
 const {src,fixture:f,options:o}=payload;
 return env(src,f,o);
}
async function main(){let checks=0;
 const run=async(f,options={})=>{let calls=0,reads=0,uid='admin';const result=await service.settle({expected:f.expected,getUid:()=>uid,read:async()=>{reads++;if(options.readError)throw Error('offline');return clone(f);},hash:async text=>{if(options.switchHash)uid='other';return hash(text);},call:async payload=>{assert.deepEqual(payload,{code:f.expected.code,roomId:f.expected.id,epoch:f.expected.epoch,mode:f.expected.mode});calls++;if(options.switchUser)uid='other';if(options.commit)Object.assign(f,fixture(true,f.expected.mode));if(options.lost)throw Error('lost');return {ok:!!options.commit};}});return {result,calls,reads};};
 let r=await run(fixture());assert(r.result.ok);assert.equal(r.calls,0);checks++;
 r=await run(fixture(false),{commit:true});assert(r.result.ok);assert.equal(r.calls,1);checks++;
 r=await run(fixture(false),{commit:true,lost:true});assert(r.result.ok);checks++;
 r=await run(fixture(false),{lost:true});assert(!r.result.ok&&r.result.pending);checks++;
 r=await run(fixture(false),{switchUser:true,commit:true});assert.equal(r.result.reason,'auth-changed');checks++;
 r=await run(fixture(),{switchHash:true});assert.equal(r.result.reason,'auth-changed');checks++;
 r=await run(fixture(),{readError:true});assert(!r.result.ok);assert.equal(r.calls,0);checks++;
 const invalid=[
 f=>f.expected.epoch='new',f=>f.expected.id='other',f=>f.expected.code='BXH-OTHER',
 f=>f.top.bucketMigration=null,f=>f.pub.deletionStatus=false,f=>f.pub.bucketMigration=false,f=>f.top.deletionStatus=null,
 f=>f.buckets.pop(),f=>f.buckets[0].revision++,f=>f.buckets[0].epoch='new',f=>f.buckets[0].matches='bad',
 f=>f.top.bucketSettlement.stateDigest='bad',f=>f.top.bucketSettlement.sourceCreatedAt='',f=>f.top.bucketSettlement.completedAt=0,
 f=>f.pub.bucketSettlement.completedAt++,f=>f.pub.scoreBucketProjection.versions['court-1']++,
 f=>f.top.archiveStatus='ongoing',f=>f.pub.archiveStatus='ongoing',f=>f.top.ladderPointsAwarded=false,
 f=>f.top.ladderResults=[],f=>f.top.ladderSeasonId='old',f=>f.top.systemClosed=true
 ];for(const change of invalid){const f=fixture();change(f);r=await run(f);assert(!r.result.ok);assert.equal(r.calls,0);checks++;}
 for(const opts of [{},{commit:true},{commit:true,lost:true},{lost:true},{switchUser:true,commit:true},{switchHash:true},{readError:true}]){const v=await run(fixture(!opts.commit&&!opts.lost&&!opts.switchUser,'general'),opts);assert.equal(v.result.ok,!opts.switchUser&&!opts.switchHash&&!opts.readError&&(!opts.lost||!!opts.commit));checks++;}
 for(const change of [f=>f.top.ladderPointsAwarded=true,f=>f.top.bucketSettlement={},f=>f.pub.bucketSettlement=null,f=>f.expected.mode='ranked',f=>f.top.ladderMode='ranked',f=>f.top.bucketCompletion.stateDigest='bad']){const f=fixture(true,'general');change(f);const r=await run(f);assert.equal(r.result.ok,false);assert.equal(r.calls,0);checks++;}
 const env=require('./host-harness.cjs');for(const kind of ['ranked','general'])for(const opts of [{},{mode:'lost'},{mode:'pending'},{mode:'error'},{switchRoom:true},{switchUser:true},{storageFail:true}]){const result=await runHost(await hostScenario({...opts,kind}),env);assert.equal(result.cloudWrites,0);assert.equal(result.legacy,0);if(opts.mode==='pending'||opts.mode==='error'||opts.switchRoom||opts.switchUser)assert.equal(result.ok,false);else {assert.equal(result.ok,true);if(kind==='general'){assert.notEqual(result.awarded,true);assert.equal(result.staleCertificate,false);}}checks++;}
 for(const kind of ['ranked','general']){const r=await runHost(await hostScenario({kind,role:'staff'}),env);assert.equal(r.ok,kind==='general');assert.equal(r.cloudWrites,0);checks++;}
 console.log(JSON.stringify({settlementUiChecks:checks,productionWrites:0,browser:false}));
}
module.exports={fixture,sources,hostScenario};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {verify}=require('../../modules/scoring/four-court-archive.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs');
function fixture(){
 const state={id:'archive-room',cloudCode:'BXH-ARCH01',meta:{stations:1,ladderMode:'general'},archiveStatus:'completed',settlementPhase:'completed',archivedAt:1000,championId:'a',runnerUpId:'b',ladderPointsAwarded:false,matches:[{id:'final',completed:true,winnerId:'a',loserId:'b',scoreA:4,scoreB:2}]};
 const m=B.makeManifest(state,'archive-epoch'),room={scoreStorage:m,ladderMode:'general',data:JSON.stringify(state),archiveStatus:'completed',tournamentPhase:'done'},publicDocument={archiveStatus:'completed',tournamentPhase:'done',bracketView:JSON.stringify(state),scoreBucketProjection:{epoch:m.epoch,versions:{'court-1':3}}};
 return {state,room,publicDocument,code:state.cloudCode,expected:{roomId:state.id,epoch:m.epoch}};
}
test('general archive acknowledgement uses server root and public results',()=>{const f=fixture(),state=verify(f);assert.equal(state.archivedAt,1000);assert.equal(state.matches[0].scoreA,4);assert.equal(state.scoreStorage.epoch,f.expected.epoch);});
test('stale epoch, pending archive, public divergence and incomplete bucket vector cannot acknowledge archive',()=>{
 for(const mutate of [f=>f.expected.epoch='old',f=>f.room.archiveStatus='ongoing',f=>f.publicDocument.tournamentPhase='live',f=>f.publicDocument.scoreBucketProjection.versions={},f=>{const s=JSON.parse(f.publicDocument.bracketView);s.matches[0].scoreA=3;f.publicDocument.bracketView=JSON.stringify(s);}]){const f=fixture();mutate(f);assert.throws(()=>verify(f));}
});
test('ranked archives require matching authoritative settlement certificates',()=>{
 const f=fixture();f.room.ladderMode='ranked';f.state.meta.ladderMode='ranked';f.state.ladderPointsAwarded=true;f.room.ladderPointsAwarded=true;f.room.data=JSON.stringify(f.state);f.publicDocument.bracketView=JSON.stringify(f.state);assert.throws(()=>verify(f));
 const receipt={version:1,status:'completed',epoch:f.expected.epoch,versions:{'court-1':3},completedAt:1000};f.room.bucketSettlement={...receipt};f.publicDocument.bucketSettlement={...receipt};assert.equal(verify(f).ladderPointsAwarded,true);f.publicDocument.bucketSettlement={...receipt,completedAt:999};assert.throws(()=>verify(f));
});
test('actual archive entry reads bucket acknowledgement and never falls back to a legacy writer',async()=>{
 const source=fs.readFileSync(require.resolve('../../modules/main-app/core.js'),'utf8'),begin=source.indexOf('async function writeArchiveStateToCloud(snapshot){'),end=source.indexOf('// Idempotent:',begin);assert(begin>=0&&end>begin);
 let pushes=0,ensures=0,flushes=0,reply={ok:false};const f=fixture();
 const context={Object,console,window:{cloudSync:{bucketView:()=>({status:'ready'}),confirmBucketArchive:async()=>reply,pushUpdate:async()=>{pushes++;return true;}}},ensureCloudAvailableForArchive:async()=>{ensures++;return true;},flushCloudStateWrites:async()=>{flushes++;}};vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
 const snapshot={...f.state,archiveStatus:'ongoing',scoreStorage:f.room.scoreStorage};assert.equal(await context.writeArchiveStateToCloud(snapshot),false);assert.equal(snapshot.archiveStatus,'ongoing');reply={ok:true,state:verify(f)};assert.equal(await context.writeArchiveStateToCloud(snapshot),true);assert.equal(snapshot.archiveStatus,'completed');assert.equal(pushes+ensures+flushes,0);
});
test('actual settlement gateway binds only bucket requests to the current server room and epoch',async()=>{
 const source=fs.readFileSync(require.resolve('../../modules/cloud/cloud-runtime.js'),'utf8'),begin=source.indexOf('async settleLadderTournament(code,payload){'),end=source.indexOf('async adjustLadderPoints(',begin);assert(begin>=0&&end>begin);const method=source.slice(begin,end).trim().replace(/,$/,'');let marked=false,binding={roomId:'room',epoch:'epoch'},sent=[];
 const context={cloudEnabled:true,authHandle:{currentUser:{uid:'admin'}},fourCourtLifecycle:{isBucket:()=>marked,binding:()=>binding},window:{engagementService:{settleLadder:async data=>{sent.push(JSON.parse(JSON.stringify(data)));return {ok:true};}}}};vm.createContext(context);const gateway=vm.runInContext('({'+method+'})',context);
 await gateway.settleLadderTournament('bxh-arch01',{expectedRoom:{roomId:'forged',epoch:'forged'}});assert.deepEqual(sent.pop(),{code:'BXH-ARCH01'});marked=true;await gateway.settleLadderTournament('BXH-ARCH01',{});assert.deepEqual(sent.pop(),{code:'BXH-ARCH01',expectedRoom:binding});binding=null;assert.equal((await gateway.settleLadderTournament('BXH-ARCH01',{})).ok,false);assert.equal(sent.length,0);
});

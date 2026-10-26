'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createVerifiedHunterDiagnostic}=require('../scripts/lib/rdw-verified-hunter-diagnostic.cjs');
const {EXPECTED_FILES}=require('../scripts/lib/rdw-hunter-bundle-loader.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture({incomplete=false}={}){
 const bundleRoot=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-private-hunter-'));fs.mkdirSync(path.join(bundleRoot,'vendor'));
 const files={
  'reader.cjs':"module.exports={createReader:()=>async({uid})=>({uid,version:'hunter-license-v2.1',complete:"+(!incomplete)+",unresolvedIdentities:0,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1',overview:{grade:{tier:uid==='realA'?'ungraded':'d'}}})};",
  'evaluator.cjs':'module.exports={};',
  'vendor/provenance.json':'{}'
 };
 for(const name of EXPECTED_FILES)if(!Object.hasOwn(files,name))files[name]='{}';
 const manifest={};for(const [name,data] of Object.entries(files)){fs.writeFileSync(path.join(bundleRoot,name),data);manifest[name]=hash(data);}
 fs.writeFileSync(path.join(bundleRoot,'bundle-manifest.json'),JSON.stringify(manifest));
 const code='BXH-ABC123',room={code,data:JSON.stringify({cloudCode:code,registrationRosterRevision:4,startedAt:null,rosterLocked:false,players:[{uid:'realA'},{uid:'realB'},...Array.from({length:6},(_,i)=>({id:'virtual'+i}))]})};
 const writes=[],reads=[];
 const db={doc:key=>({key,get:async()=>{reads.push(key);return key==='tournaments/'+code?{exists:true,data:()=>room}:{exists:true,data:()=>({active:true,role:key==='users/admin'?'admin':'player'})};}}),runTransaction:async callback=>callback({get:async ref=>{reads.push(ref.key);return {exists:true,data:()=>({active:true,role:'player'})};},set:()=>writes.push('set'),update:()=>writes.push('update'),create:()=>writes.push('create')})};
 return {bundleRoot,db,reads,writes,code};
}
test('real Reader result preserves provenance into diagnostic and counts two real accounts',async()=>{
 const f=fixture(),diagnose=createVerifiedHunterDiagnostic({...f,clock:()=>2000,enabled:true});
 const result=await diagnose({actorUid:'admin',eventCode:f.code});
 assert.equal(result.ok,true);assert.equal(result.verifiedAccounts,2);assert.equal(result.unverifiedAccounts,0);assert.equal(result.virtualPlayers,6);assert.equal(result.fullSnapshotEligible,false);
 assert.deepEqual(result.formulaBands,[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}]);
 assert.equal(f.writes.length,0);
});
test('incomplete Hunter history fails closed without making whole diagnostic fail',async()=>{
 const f=fixture({incomplete:true}),diagnose=createVerifiedHunterDiagnostic({...f,clock:()=>2000,enabled:true});
 const result=await diagnose({actorUid:'admin',eventCode:f.code});
 assert.equal(result.ok,true);assert.equal(result.verifiedAccounts,0);assert.equal(result.unverifiedAccounts,2);assert.equal(result.fullSnapshotEligible,false);assert.equal(f.writes.length,0);
});
test('disabled mode does not require or load private bundle',async()=>{
 const diagnose=createVerifiedHunterDiagnostic();
 assert.equal((await diagnose({actorUid:'admin',eventCode:'BXH-ABC123'})).reason,'diagnostic-disabled');
});

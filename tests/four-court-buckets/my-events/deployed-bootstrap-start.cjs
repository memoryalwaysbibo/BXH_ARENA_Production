'use strict';
const fs=require('node:fs');
const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
const runId=get('--run-id');
if(!runId||!/^my-events-[A-Za-z0-9_-]{1,80}$/.test(runId))throw Error('explicit-named-run-required');
async function main(){
 if(!args.includes('--execute'))return {status:'DRY_RUN',runId,crossPlayerWrites:true,bootstrapAttempted:false};
 if(get('--approve-cross-player-run')!==runId)throw Error('explicit-cross-player-approval-required');
 // Candidate sources must be integrated and reviewed before this file is executable.
 const seal=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'source-seal.json'),'utf8'));
 require('./source-seal.cjs').verify(seal);
 const journal=get('--journal');if(!journal)throw Error('journal-required');
 const fd=fs.openSync(journal,'wx',0o600);
 const record=x=>{fs.writeSync(fd,JSON.stringify(x)+'\n');fs.fsyncSync(fd);};
 record({runId,bootstrapAttempted:false});
 let attempted=false;
 try{
  const {initializeApp}=require('firebase-admin/app');const {getFirestore,FieldPath}=require('firebase-admin/firestore');
  initializeApp({projectId:'bxh-arena'});const db=getFirestore();
  const {createAdminBridge}=require('./vendor/backend/service.cjs');
  const bridge=createAdminBridge(db),documentId=FieldPath.documentId();
  const engine=require('./vendor/backend/engine.cjs').createEngine({bridge,documentId,enabled:true});
  const rebuilder=require('./vendor/backend/rebuild.cjs').createRebuilder({bridge,engine,documentId,enabled:true});
  const bootstrap=require('./vendor/backend/bootstrap.cjs').createBootstrap({bridge,rebuilder,documentId,enabled:true});
  record({runId,bootstrapAttempted:true,status:'INTENT'});attempted=true;
  const result=await bootstrap.beginRun({runId});
  const status=['started','running','complete','needs-repair','busy'].includes(result.status)?result.status:'UNKNOWN';
  record({runId,bootstrapAttempted:true,status});return {runId,status,bootstrapAttempted:true};
 }catch(e){record({runId,status:attempted?'UNKNOWN_OUTCOME_NO_RETRY':'STOPPED_BEFORE_BEGIN',bootstrapAttempted:attempted});return {status:attempted?'UNKNOWN_OUTCOME_NO_RETRY':'STOPPED_BEFORE_BEGIN',bootstrapAttempted:attempted};}
 finally{fs.closeSync(fd);}
}
main().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.log('{"status":"REFUSED","bootstrapAttempted":null}');process.exitCode=1;});

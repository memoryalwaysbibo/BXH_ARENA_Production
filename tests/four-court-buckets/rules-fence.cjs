'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,updateDoc,setDoc}=require('firebase/firestore');

async function main(){
  assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
  const rules=fs.readFileSync(path.join(__dirname,'../../referee-seats/firestore.candidate.rules'),'utf8');
  const env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host:'127.0.0.1',port:8188,rules}});
  try {
    const code='BXH-FENCE1';
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await setDoc(doc(db,'users','admin'),{active:true,role:'super_admin'});
      await setDoc(doc(db,'tournaments',code),{data:'{}',scoreStorage:{schema:'bxh-match-buckets-v1',status:'active',epoch:1},createdBy:'admin',eventAuthority:'official'});
      await setDoc(doc(db,'publicTournaments',code),{bracketView:'{}',visibility:'public'});
    });
    const db=env.authenticatedContext('admin').firestore();
    await assertFails(updateDoc(doc(db,'tournaments',code),{data:'{"forged":true}'}));
    await assertFails(updateDoc(doc(db,'tournaments',code),{scoreStorage:null}));
    await assertFails(updateDoc(doc(db,'publicTournaments',code),{bracketView:'{"forged":true}'}));
    await assertFails(setDoc(doc(db,'tournaments','BXH-FENCE2'),{scoreStorage:{status:'active'}}));
    await assertFails(setDoc(doc(db,'tournaments',code,'matchBuckets','court-1'),{matches:'[]'}));
    console.log(JSON.stringify({kind:'bucket-legacy-rules-fence',activePrivateDenied:true,manifestTamperDenied:true,activePublicDenied:true,clientCreateDenied:true,clientBucketDenied:true}));
  } finally {await env.cleanup();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc}=require('firebase/firestore');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('demo-emulator-required');
(async()=>{
  const env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{rules:fs.readFileSync('production-online-time-audit/firestore.rules','utf8')}});
  try{
    for(const uid of ['player','superadmin']){
      await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'users/'+uid),{active:true,role:uid==='superadmin'?'super_admin':'player'}));
      const client=env.authenticatedContext(uid).firestore();
      for(const path of ['onlinePresence/'+uid,'playerStats/'+uid,'titleDefinitions/online_time_1h','publicTitleCatalog/online_time_1h','users/'+uid+'/titleProgress/online_time_1h','users/'+uid+'/earnedTitles/online_time_1h','onlineTimeTitleReceipts/forged','systemSettings/onlineTimeTitles']){
        await assertFails(setDoc(doc(client,path),{officialOnlineTimeMs:360000000,active:true,lastSeenAt:Date.now()}));
      }
    }
    console.log('PASS deployed Firestore rules deny time/title/receipt/config forgery for player and super-admin browsers');
  }finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});

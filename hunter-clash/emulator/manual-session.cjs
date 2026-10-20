'use strict';
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('emulators-required');
process.env.METADATA_SERVER_DETECTION='none';
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {seedSession}=require('./seed-session.cjs');
const {createServer}=require('../frontend/serve.cjs');
async function main(){
  const app=initializeApp({projectId:PROJECT}),db=getFirestore(app),server=createServer();
  let closing=false;
  async function close(){if(closing)return;closing=true;await new Promise(r=>server.close(r));await db.terminate();await deleteApp(app);}
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5199,'127.0.0.1',resolve);});
    const session=await seedSession({db,auth:getAuth(app),serverTimestamp:()=>FieldValue.serverTimestamp()});
    process.stdout.write('HC disposable local lab: http://127.0.0.1:5199\nChallenge: '+session.challengeId+'\n');
    for(const a of session.accounts)process.stdout.write(a.purpose+' | '+a.email+' | '+a.password+'\n');
    process.stdout.write('These are disposable demo accounts. No production data is imported. Ctrl+C closes the lab.\n');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)).catch(()=>process.exit(1)));
  }catch(error){await close();throw error;}
}
if(require.main===module)main().catch(()=>{process.stderr.write('Local lab setup failed; inspect emulator setup and isolation settings.\n');process.exitCode=1;});

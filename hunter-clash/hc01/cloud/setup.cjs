'use strict';
// Owner-operated CLI. No account creation, password handling or deployment occurs here.
const fs=require('node:fs');
const {assertDeployment}=require('./deploy-preflight.cjs');
async function main(args){
  assertDeployment(process.env);
  const[mode,inputFile,planHash]=args;
  if(!['inspect','apply-closed'].includes(mode)||!inputFile||(mode==='inspect'&&args.length!==2)||(mode==='apply-closed'&&(args.length!==3||!/^[a-f0-9]{64}$/.test(planHash))))throw Error('usage: inspect INPUT.json | apply-closed INPUT.json PLAN_HASH');
  const{initializeApp,deleteApp}=require('firebase-admin/app');const{getAuth}=require('firebase-admin/auth');const{getFirestore}=require('firebase-admin/firestore');
  const{createSetupService}=require('./setup-service.cjs');const app=initializeApp({projectId:'bxh-hc-test'});const db=getFirestore(app);
  try{const service=createSetupService({db,auth:getAuth(app)},{...process.env,HC_RUNTIME_MODE:'isolated-cloud-test'});const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));
    const report=mode==='inspect'?await service.inspect(input):await service.provisionClosed(input,planHash);process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }finally{await db.terminate();await deleteApp(app);}
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{process.stderr.write('HC01 setup failed. Check project, input, account status and plan; no credentials are printed.\n');process.exitCode=1;});
module.exports={main};

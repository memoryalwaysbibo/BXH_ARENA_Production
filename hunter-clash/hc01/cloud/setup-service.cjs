'use strict';
const {createHash}=require('node:crypto');
const {assertSandboxRuntime}=require('../../server/runtime-boundary.cjs');
const {identifier,policy}=require('../domain.cjs');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(sorted(JSON.parse(JSON.stringify(value))))).digest('hex');
const validRole=actor=>['player','staff','admin','super_admin'].includes(actor.role);
function setupInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['uids','rules','pairingTtlMs'].includes(k)))throw Error('invalid-setup-input');
  if(!Array.isArray(input.uids)||input.uids.length<2||input.uids.length>8||new Set(input.uids).size!==input.uids.length)throw Error('invalid-test-accounts');
  input.uids.forEach(identifier);const rules=policy(input.rules);
  if(!Number.isSafeInteger(input.pairingTtlMs)||input.pairingTtlMs<1000||input.pairingTtlMs>300000)throw Error('invalid-pairing-policy');
  return{uids:[...input.uids].sort(),rules,pairingTtlMs:input.pairingTtlMs};
}
function createSetupService({db,auth},env=process.env){
  assertSandboxRuntime(db,auth,env,'bxh-hc-test');
  const ref=(collection,id)=>db.collection(collection).doc(id);
  async function users(input){
    for(const uid of input.uids){const user=await auth.getUser(uid);if(user.uid!==uid||user.disabled===true)throw Error('test-auth-account-unavailable');}
  }
  function plan(input,config,actors){
    if(config&&config.environment!=='sandbox')throw Error('unsafe-runtime-config');
    for(const actor of actors)if(actor&&(actor.active!==true||actor.deleted===true||['frozen','disabled','deleted'].includes(actor.accountStatus)||!validRole(actor)))throw Error('existing-actor-unavailable');
    const nextConfig={...(config||{environment:'sandbox',enabled:false}),hc01Enabled:false,hc01Rules:input.rules,hc01PairingTtlMs:input.pairingTtlMs};
    const nextActors=actors.map(actor=>actor?{...actor,hc01Allowed:true}:{active:true,role:'player',hc01Allowed:true});
    const planHash=hash({input,config:config||null,actors:actors.map(a=>a||null)});
    return{planHash,projectId:db.projectId,action:'PROVISION_HC01_CLOSED',uids:input.uids,
      globalEnabled:nextConfig.enabled===true,hc01Enabled:false,
      changes:{runtime:['hc01Enabled','hc01Rules','hc01PairingTtlMs'],actors:input.uids.map((uid,i)=>({uid,create:!actors[i],role:nextActors[i].role}))},
      nextConfig,nextActors};
  }
  async function execute(raw,expectedPlanHash){
    const input=setupInput(raw);await users(input);
    return db.runTransaction(async tx=>{
      const refs=[ref('hcConfig','runtime'),...input.uids.map(uid=>ref('hcActors',uid))];
      const [config,...actors]=(await tx.getAll(...refs)).map(s=>s.data());const result=plan(input,config,actors);
      if(expectedPlanHash!==undefined){
        if(typeof expectedPlanHash!=='string'||expectedPlanHash!==result.planHash)throw Error('setup-plan-changed');
        tx.set(refs[0],result.nextConfig);result.nextActors.forEach((actor,i)=>tx.set(refs[i+1],actor));
      }
      const{nextConfig,nextActors,...report}=result;return{...report,applied:expectedPlanHash!==undefined};
    });
  }
  return{inspect:input=>execute(input),provisionClosed:(input,planHash)=>execute(input,planHash)};
}
module.exports={createSetupService,setupInput};

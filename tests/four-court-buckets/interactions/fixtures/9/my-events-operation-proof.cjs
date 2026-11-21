'use strict';
const {createHash}=require('node:crypto');
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const uidOK=x=>typeof x==='string'&&/^[^\s/]{1,128}$/.test(x);
const codeOK=x=>typeof x==='string'&&/^BXH-[A-Z0-9]{4,16}$/.test(x);
const idOK=x=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=1500&&!x.includes('/')&&x!=='.'&&x!=='..';
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>own(x,k));
const bad=()=>{throw Error('invalid-operation-proof');};
function stamp(value){if(!value||!Number.isSafeInteger(value.seconds)||!Number.isInteger(value.nanoseconds)||value.nanoseconds<0||value.nanoseconds>=1e9)bad();return {seconds:value.seconds,nanoseconds:value.nanoseconds};}
function canonicalProof({actorUid,code,action,roomIncarnation,targets}){
 if(!uidOK(actorUid)||!codeOK(code)||!['join','cancel'].includes(action)||!Array.isArray(targets)||!targets.length||targets.length>23)bad();
 const result=[];let previous=null;
 for(const target of targets){
  if(!record(target)||!idOK(target.id)||!['write','delete','observed'].includes(target.mode)||previous!==null&&target.id<=previous)bad();
  if(!exact(target,target.mode==='observed'?['id','mode','observedUpdateTime']:['id','mode']))bad();
  if(action==='join'&&target.mode==='observed'||action==='cancel'&&target.mode==='delete')bad();
  result.push({id:target.id,mode:target.mode,...(target.mode==='observed'?{observedUpdateTime:stamp(target.observedUpdateTime)}:{})});previous=target.id;
 }
 return {schemaVersion:25,scope:'individual-family',actorUid,code,action,roomIncarnation:stamp(roomIncarnation),targets:result};
}
const fingerprint=proof=>createHash('sha256').update(JSON.stringify(proof)).digest('hex');
function createProof(actorUid,code,action,roomIncarnation,targets){
 const unique=new Map();for(const target of targets||[])unique.set(target.id,target);
 const proof=canonicalProof({actorUid,code,action,roomIncarnation,targets:[...unique.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});
 return {...proof,fingerprint:fingerprint(proof)};
}
function validateProof(input,{actorUid,code,route}={}){
 if(!['family','roster'].includes(route)||!exact(input,['schemaVersion','scope','actorUid','code','action','roomIncarnation','targets','fingerprint'])||input.schemaVersion!==25||input.scope!=='individual-family'||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint))bad();
 if(actorUid!==undefined&&input.actorUid!==actorUid||code!==undefined&&input.code!==code)bad();
 if(!exact(input.roomIncarnation,['seconds','nanoseconds']))bad();
 if(!Array.isArray(input.targets))bad();
 for(const t of input.targets)if(!record(t)||t.mode==='observed'&&!exact(t.observedUpdateTime,['seconds','nanoseconds']))bad();
 const proof=canonicalProof(input);
 if(route==='roster'&&(proof.action!=='cancel'||proof.targets.length>2)||route==='family'&&proof.action==='cancel'&&proof.targets.length!==1)bad();
 if(fingerprint(proof)!==input.fingerprint)bad();
 return {...proof,fingerprint:input.fingerprint};
}
function operationFields(actorUid,code,action,roomIncarnation,targets,now){
 if(!Number.isSafeInteger(now)||now<0)bad();const myEventsProof=createProof(actorUid,code,action,roomIncarnation,targets);
 return {myEventsProof,membershipSync:{schemaVersion:25,state:'pending',pending:true,dueAt:now,leaseToken:null,leaseUntil:0,attempts:0,proofFingerprint:myEventsProof.fingerprint,updatedAt:now}};
}
module.exports={validateProof,createProof,operationFields,stamp};

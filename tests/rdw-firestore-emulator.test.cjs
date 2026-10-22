'use strict';
// Firestore Emulator REST integration: real server-side atomic commits, never production.
const test=require('node:test'),assert=require('node:assert/strict');
const host=process.env.FIRESTORE_EMULATOR_HOST;
const project=process.env.GCLOUD_PROJECT||'demo-bxh-arena-e2e';
if(!host)throw Error('FIRESTORE_EMULATOR_HOST required: never run against production');
const root='http://'+host+'/v1/projects/'+project+'/databases/(default)/documents';
const doc=(path)=>'projects/'+project+'/databases/(default)/documents/'+path;
const encode=(obj)=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,{[typeof v==='boolean'?'booleanValue':typeof v==='number'?'integerValue':'stringValue']:typeof v==='number'?String(v):v}]));
async function api(path,method='GET',body){const r=await fetch(root+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,data};}
async function create(path,fields){const i=path.lastIndexOf('/');const r=await api('/'+path.slice(0,i)+'?documentId='+path.slice(i+1),'POST',{fields:encode(fields)});assert.equal(r.ok,true,JSON.stringify(r.data));}
async function get(path){return api('/'+path);}
async function commit(writes){return api(':commit','POST',{writes});}
const event='rdwEmulatorTests/event-'+Date.now();const audit='rdwEmulatorTests/audit-'+Date.now();
test('Firestore Emulator: PASS audit and event start commit atomically',async()=>{
 await create(event,{code:'BXH-TEST',started:false,drawRevision:1});
 const writes=[
  {update:{name:doc(audit),fields:encode({actorUid:'test-host',reason:'rdw-timeout',rdwEligible:false})},currentDocument:{exists:false}},
  {update:{name:doc(event),fields:encode({started:true,rdwStartMode:'rdw-pass'})},updateMask:{fieldPaths:['started','rdwStartMode']},currentDocument:{exists:true}}
 ];
 const ok=await commit(writes);assert.equal(ok.ok,true,JSON.stringify(ok.data));
 assert.equal((await get(event)).data.fields.started.booleanValue,true);
 assert.equal((await get(audit)).data.fields.actorUid.stringValue,'test-host');
 const retry=await commit(writes);assert.equal(retry.ok,false,'duplicate audit must not overwrite');
});
test('Firestore Emulator: failed audit precondition rolls back start update',async()=>{
 const e=event+'-rollback',a=audit+'-rollback';await create(e,{code:'BXH-TEST',started:false});await create(a,{actorUid:'prior'});
 const result=await commit([
  {update:{name:doc(e),fields:encode({started:true})},updateMask:{fieldPaths:['started']},currentDocument:{exists:true}},
  {update:{name:doc(a),fields:encode({actorUid:'new'})},currentDocument:{exists:false}}
 ]);
 assert.equal(result.ok,false);
 assert.equal((await get(e)).data.fields.started.booleanValue,false,'no partial start');
 assert.equal((await get(a)).data.fields.actorUid.stringValue,'prior','audit remains immutable');
});

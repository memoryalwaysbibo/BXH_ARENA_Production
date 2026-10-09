'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCallableHandler}=require('../hunter-clash/hc01/callable.cjs');
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
const request=(patch={})=>({auth:{uid:'A'},rawRequest:{headers:{authorization:'Bearer real-token'}},data:{operation:'createChallenge',input:{requestId:'one'}},...patch});
test('callable rejects missing auth and malformed envelopes before service access',async()=>{
  let calls=0;const handler=createCallableHandler({run(){calls++;}},HttpsError);
  for(const bad of [request({auth:null}),request({rawRequest:{headers:{authorization:'Bearer token extra'}}})])await assert.rejects(handler(bad),e=>e.code==='unauthenticated');
  for(const data of [{operation:'settle',input:{}},{operation:'createChallenge',input:{},uid:'admin'},null,[]])await assert.rejects(handler(request({data})),e=>e.code==='invalid-argument');
  assert.equal(calls,0);
});
test('callable forwards only bearer, operation and input to trusted service',async()=>{
  const handler=createCallableHandler({async run(...args){assert.deepEqual(args,['real-token','createChallenge',{requestId:'one'}]);return {ok:true};}},HttpsError);
  assert.deepEqual(await handler(request()),{ok:true});
});
test('callable maps known rejection and masks unknown SDK failures',async()=>{
  for(const [error,code,reason]of [[Error('revision-conflict'),'aborted','revision-conflict'],[Object.assign(Error('private user data'),{code:'auth/id-token-revoked'}),'unauthenticated',undefined],[Error('private credentials and database path'),'internal',undefined]]){
    const handler=createCallableHandler({async run(){throw error;}},HttpsError);
    await assert.rejects(handler(request()),e=>e.code===code&&e.details?.reason===reason&&!e.message.includes('private'));
  }
});

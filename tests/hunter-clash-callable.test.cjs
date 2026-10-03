'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCallableHandler}=require('../hunter-clash/server/callable-handler.cjs');
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
const request={auth:{uid:'trusted-sdk-context'},rawRequest:{headers:{authorization:'Bearer test-token'}},
  data:{operation:'submit',input:{challengeId:'c1'}}};
test('callable uses bearer token, never context or client UID as service identity',async()=>{
  const handler=createCallableHandler({submit:async(token,input)=>{assert.equal(token,'test-token');return input;}},HttpsError);
  assert.deepEqual(await handler(request),request.data.input);
  await assert.rejects(handler({...request,auth:null}),{code:'unauthenticated'});
  await assert.rejects(handler({...request,rawRequest:{headers:{authorization:'Bearer a b'}}}),{code:'unauthenticated'});
  for(const data of [{operation:'toString'}, {operation:'submit',uid:'admin'},null,[]])
    await assert.rejects(handler({...request,data}),{code:'invalid-argument'});
});
test('callable maps known conflicts and auth errors without leaking unknown errors',async()=>{
  for(const [error,code] of [[Error('revision-conflict'),'aborted'],
      [Object.assign(Error('private token'),{code:'auth/id-token-revoked'}),'unauthenticated'],
      [Error('secret database credential path'),'internal']]){
    const handler=createCallableHandler({submit:async()=>{throw error;}},HttpsError);
    await assert.rejects(handler(request),e=>{
      assert.equal(e.code,code);
      assert.equal(e.message.includes('secret'),false);
      assert.equal(e.message.includes('private'),false);
      if(code==='internal')assert.equal(e.details,undefined);
      return true;
    });
  }
});

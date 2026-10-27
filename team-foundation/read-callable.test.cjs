'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createReadHandler}=require('./read-callable.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture(){let transactions=0;const db={doc:p=>p,runTransaction:async fn=>{transactions++;return fn({get:async path=>({exists:path==='teamsPublicV1/a',data:()=>({name:'Alpha',members:[{uid:'c',name:'C',role:'captain',secret:'private'}]})})});}};return {handler:createReadHandler({db,auth:{getUser:async()=>({})},HttpsError,enabled:true}),get transactions(){return transactions;}};}
const req=()=>({app:{appId:'verified'},auth:{uid:'real',token:{}},data:{action:'members',teamId:'a'}});
test('read boundary authorizes signed-in public member lookup and preserves allowlist',async()=>{const f=fixture();const r=await f.handler(req());assert.equal(r.name,'Alpha');assert.ok(!JSON.stringify(r).includes('private'));assert.equal(f.transactions,1);});
test('forged viewer identity and missing Auth/AppCheck cannot read',async()=>{
 for(const key of ['actorUid','viewerUid','authorized']){const f=fixture(),r=req();r.data[key]='forged';await assert.rejects(f.handler(r));assert.equal(f.transactions,0);}
 for(const key of ['auth','app']){const f=fixture(),r=req();delete r[key];await assert.rejects(f.handler(r));assert.equal(f.transactions,0);}
});
test('history member permission checked in service; internal error data is hidden',async()=>{
 const f=fixture(),r=req();r.data.action='history';await assert.rejects(f.handler(r),e=>e.code==='permission-denied');
});

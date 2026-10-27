'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createCommandHandler}=require('./callable.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const request=()=>({app:{appId:'verified-app'},auth:{uid:'real',token:{auth_time:200}},data:{action:'apply',teamId:'alpha'}});
function fixture(options={}){let reads=0,transactions=0;const handler=createCommandHandler({db:{runTransaction:async()=>{transactions++;throw Error('private database detail');}},auth:{getUser:async()=>{reads++;return options.user||{};}},HttpsError,enabled:options.enabled??true});return {handler,get reads(){return reads;},get transactions(){return transactions;}};}
test('disabled, missing Auth/App Check fail before account and database operations',async()=>{
 const disabled=fixture({enabled:false});await assert.rejects(disabled.handler(request()),/teams-unavailable/);assert.equal(disabled.reads,0);
 for(const field of ['app','auth']){const f=fixture(),r=request();delete r[field];await assert.rejects(f.handler(r));assert.equal(f.reads,0);assert.equal(f.transactions,0);}
});
test('identity, role, points or experience spoof payloads rejected',async()=>{
 for(const key of ['actorUid','role','points','totalXp','authorized']){const f=fixture(),r=request();r.data[key]='forged';await assert.rejects(f.handler(r),/unexpected-command-field/);assert.equal(f.reads,0);}
});
test('disabled accounts and old sessions cannot reach membership transactions',async()=>{
 for(const user of [{disabled:true},{tokensValidAfterTime:new Date(201000).toISOString()}]){const f=fixture({user});await assert.rejects(f.handler(request()));assert.equal(f.transactions,0);}
});
test('unknown database errors do not expose private details',async()=>{
 const f=fixture();await assert.rejects(f.handler(request()),error=>error.code==='internal'&&error.message==='team-command-unavailable');assert.equal(f.transactions,1);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createTeamApi,createTeamApiFromEngagement}=require('./team-api.js');
test('adapter uses declared callable operations without inventing account data',async()=>{
 const calls=[],api=createTeamApi({functions:{},httpsCallable:(_,name)=>async payload=>{calls.push({name,payload});return {data:{ok:true}};}});
 await api.list({query:'隊'});await api.members({teamId:'t'});await api.command({action:'apply',teamId:'t'});
 assert.deepEqual(calls,[{name:'teamRead',payload:{action:'list',query:{query:'隊'}}},{name:'teamRead',payload:{action:'members',teamId:'t'}},{name:'teamCommand',payload:{action:'apply',teamId:'t'}}]);
});
test('bad responses fail closed',async()=>{const api=createTeamApi({functions:{},httpsCallable:()=>async()=>({})});await assert.rejects(api.list({}),/invalid-callable-response/);});
test('mine API uses authenticated context without a client-selected UID',async()=>{
 let payload;const api=createTeamApi({functions:{},httpsCallable:()=>async p=>(payload=p,{data:{team:null}})});await api.mine();assert.deepEqual(payload,{action:'mine'});
});

test('applications read sends only team ID to the callable',async()=>{let payload;const api=createTeamApi({functions:{},httpsCallable:()=>async p=>(payload=p,{data:{items:[]}})});await api.applications({teamId:'t'});assert.deepEqual(payload,{action:'applications',teamId:'t'});});

test('ARENA adapter reuses its callable bridge and preserves request IDs',async()=>{
 const calls=[];const api=createTeamApiFromEngagement({engagementService:{tournamentOperation:async(name,payload)=>(calls.push({name,payload}),{ok:true})}});
 await api.mine();await api.history({teamId:'t',cursor:'last'});await api.command({action:'apply',teamId:'t',requestId:'operation-1234567890'});
 assert.deepEqual(calls,[{name:'teamRead',payload:{action:'mine'}},{name:'teamRead',payload:{action:'history',teamId:'t',cursor:'last'}},{name:'teamCommand',payload:{action:'apply',teamId:'t',requestId:'operation-1234567890'}}]);
});
test('ARENA adapter fails closed if callable bridge is absent',()=>{assert.throws(()=>createTeamApiFromEngagement({}),/engagement-service-required/);});
test('emblem upload uses the dedicated authenticated callable',async()=>{
 const calls=[],api=createTeamApiFromEngagement({engagementService:{tournamentOperation:async(name,payload)=>(calls.push({name,payload}),{ok:true})}});
 const payload={teamId:'t',requestId:'request-1234567890',contentType:'image/webp',base64:'YWJj'};await api.uploadEmblem(payload);assert.deepEqual(calls,[{name:'teamEmblemUpload',payload}]);
});

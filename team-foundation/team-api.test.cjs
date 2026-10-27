'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createTeamApi}=require('./team-api.js');
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

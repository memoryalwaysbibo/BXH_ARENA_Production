const test=require('node:test'),assert=require('node:assert/strict');
const {createDiagnosticAdminAuthorizer}=require('../scripts/lib/rdw-diagnostic-admin-authorizer.cjs');
function fixture(profile){
 const paths=[];
 const db={doc:path=>{paths.push(path);return {get:async()=>({exists:profile!==null,data:()=>profile})};}};
 return {authorize:createDiagnosticAdminAuthorizer({db}),paths};
}
const request={actorUid:'uid-admin',eventCode:'BXH-ABC123'};
test('active admin and super_admin are accepted',async()=>{
 for(const role of ['admin','super_admin']){const f=fixture({role,active:true});assert.equal(await f.authorize(request),true);assert.deepEqual(f.paths,['users/uid-admin']);}
});
test('inactive, missing, tester and staff accounts are rejected',async()=>{
 for(const profile of [null,{role:'admin',active:false},{role:'admin'},{role:'admin',active:true,isTestAccount:true},{role:'staff',active:true},{role:'event_staff',active:true},{role:'tester',active:true}]){
  const f=fixture(profile);assert.equal(await f.authorize(request),false);
 }
});
test('bad caller identity never reads a profile',async()=>{
 const f=fixture({role:'admin',active:true});assert.equal(await f.authorize({...request,actorUid:'../wrong'}),false);assert.equal(await f.authorize({...request,eventCode:'fake'}),false);assert.deepEqual(f.paths,[]);
});

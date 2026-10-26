'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
function slice(start,end){const a=core.indexOf(start),b=core.indexOf(end,a);assert.ok(a>=0&&b>a);return core.slice(a,b);}
const fixture=()=>({uid:'buyer',role:'player',active:true,partnerOrganizer:{status:'active',scope:'manual',organizationId:'legacy-org',organizationName:'甲店',plan:'A1',expiresAt:2000000000000,issuedAt:123}});
function harness(profile=fixture()){
 const calls=[],messages=[],pending=new Map();
 const c={accountMgmtUsers:[profile],actor:'operator',allowed:true,modal:null,
  isSuperAdmin:()=>c.allowed,currentAuthUid:()=>c.actor,accountPrimaryName:()=> '玩家',managedAccountControl:()=>({value:'revoked'}),
  openModal:m=>c.modal=m,showToast:(...args)=>messages.push(args),changeSingleManagedAccount:async(...args)=>calls.push(args),
  sessionStorage:{getItem:key=>pending.get(key)||null}};
 vm.createContext(c);vm.runInContext(slice('function legacyPartnerRevocationPatch(user){','function renderPartnerContractCard(user){'),c);
 vm.runInContext('function handle(action,target){'+slice('  if(action==="save-partner-grant"||action==="partner-revoke-legacy"){',"  if(action==='partner-create-contract'){")+'}',c);
 return {c,calls,messages,pending,click:(action='partner-revoke-legacy')=>c.handle(action,{getAttribute:()=> 'buyer'})};
}
test('legacy button reviews first, then sends only the supported revoke-only payload',async()=>{
 const t=harness();t.click();assert.ok(t.c.modal);assert.equal(t.calls.length,0);
 await t.c.modal.onConfirm();assert.equal(t.calls.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(t.calls[0][1])),{partnerOrganizer:{status:'revoked',organizationId:'legacy-org',organizationName:'甲店',plan:'A1',expiresAt:2000000000000}});
 assert.equal(t.c.accountMgmtUsers[0].partnerOrganizer.status,'active','no optimistic access mutation');
});
test('a contract grant never reaches the manual revocation service',()=>{
 for(const change of [{scope:'contract'},{scope:'unknown'},{orderCode:'new-order'},{contractOrderCode:'new-order'}]){
  const u=fixture();Object.assign(u.partnerOrganizer,change);const t=harness(u);t.click();assert.equal(t.c.modal,null);assert.equal(t.calls.length,0);
 }
 const u=fixture();u.partnerContractOrderCode='new-order';const t=harness(u);t.click();assert.equal(t.c.modal,null);
});
test('account switch, privilege loss and renewed authorization invalidate an open confirmation',async()=>{
 for(const change of [t=>t.c.actor='another',t=>t.c.allowed=false,t=>t.c.accountMgmtUsers[0].partnerOrganizer.plan='B1',t=>t.c.accountMgmtUsers[0].partnerOrganizer.scope='contract']){
  const t=harness();t.click();change(t);await t.c.modal.onConfirm();assert.equal(t.calls.length,0);
 }
});
test('an unrelated or corrupt pending account operation cannot be replayed as revocation',async()=>{
 for(const value of ['invalid json',JSON.stringify({uids:['buyer'],patch:{role:'admin'},operationId:'old'}),JSON.stringify({uids:['different'],patch:{},operationId:'old'})]){
  const t=harness();t.pending.set('bxh-account-single:operator:buyer',value);t.click();await t.c.modal.onConfirm();assert.equal(t.calls.length,0);
 }
});
test('legacy selector cannot activate a grant and only a super administrator may review',()=>{
 const t=harness();t.c.managedAccountControl=()=>({value:'active'});t.click('save-partner-grant');assert.equal(t.c.modal,null);assert.match(t.messages[0][0],/簽署|合約/);
 const denied=harness();denied.c.allowed=false;denied.click();assert.equal(denied.c.modal,null);
});

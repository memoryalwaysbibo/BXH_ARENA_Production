'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8'),a=core.indexOf('  if(action==="delete-player"){'),b=core.indexOf('  if(action==="correct-previous-score"){',a);
assert(a>=0&&b>a);
function fixture(online=false){
 const calls=[];let modal;
 const ctx=vm.createContext({state:{id:'room',cloudCode:'BXH-TEST',meta:{battleMode:'individual'},players:[{id:'p',name:'Player',source:online?'online':'onsite',registrationId:online?'r':undefined}]},
  isPlayerInBracket:()=>true,openModal:m=>{modal=m;},showToast:m=>calls.push(['toast',m]),bracketCommitBlocked:()=>false,
  peopleCancelOnline:(...args)=>calls.push(['online',...args]),peopleCancelLocal:(...args)=>calls.push(['local',...args]),saveState:()=>calls.push(['save']),render(){}});
 vm.runInContext('function act(){const action="delete-player",target={getAttribute:()=>"p"};'+core.slice(a,b)+'}',ctx);
 return {ctx,calls,get modal(){return modal;}};
}
for(const online of [false,true])test('prestart paired '+(online?'online':'onsite')+' player reaches canonical cancellation',()=>{
 const h=fixture(online);h.ctx.act();assert(h.modal.message.includes('重新抽籤'));h.modal.onConfirm();
 assert.equal(h.calls[0][0],online?'online':'local');assert.equal(h.calls.filter(x=>x[0]==='save').length,0);
});
for(const change of ['started','room','pending'])test('confirmation rechecks '+change+' before deleting',()=>{
 const h=fixture();h.ctx.act();if(change==='started')h.ctx.state.startedAt=1;if(change==='room')h.ctx.state.id='other';if(change==='pending')h.ctx.bracketCommitBlocked=()=>true;
 h.modal.onConfirm();assert.equal(h.calls.filter(x=>['local','online','save'].includes(x[0])).length,0);
});
test('cancellation lock errors describe deletion rather than waitlist promotion',()=>{
 const start=core.indexOf('function peopleMutationErrorMessage('),end=core.indexOf('\nasync function peopleReportRosterPermission',start);
 const ctx=vm.createContext({mapRegistrationError:()=> 'fallback'});vm.runInContext(core.slice(start,end),ctx);
 assert(ctx.peopleMutationErrorMessage({code:'functions/failed-precondition',message:'bracket-locked'},'cancel').includes('無法刪除選手'));
 assert(ctx.peopleMutationErrorMessage({code:'functions/failed-precondition',details:{reason:'roster-locked'}},'cancel').includes('無法刪除選手'));
});

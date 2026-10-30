'use strict';
// Real mailbox + title client, deferred mock services. No Firebase or player writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(){
 const pending=deferred(),calls=[],effects=[];
 const s={firebaseUser:{uid:'a'},engagementSessionEpoch:1,currentAuthUid:()=>s.firebaseUser?.uid||'',
  render:()=>effects.push('render'),showToast:()=>effects.push('toast'),esc:String,location:{href:'unchanged'},
  window:{open:()=>{effects.push('open');return {};},engagementService:{
   claimTitleReward:p=>{calls.push(p);return pending.promise;},
   mailbox:async p=>{calls.push(p);return {ok:true,messages:[],unreadCount:0};}
  }}};
 vm.createContext(s);
 for(const name of ['modules/main-app/mailbox.js','title-reward-mail.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),s,{filename:name});
 const mail=()=>s.window.BXHMailbox.mailboxContext();
 mail().messages=[{id:'title-a',type:'title_reward'}];
 const claim=(replay=false)=>s.window.BXHMailbox.handleMailbox('mailbox-title-reward',{getAttribute:n=>n==='data-message-id'?'title-a':n==='data-replay'&&replay?'1':'0'});
 const switchSession=mode=>{if(mode==='account')s.firebaseUser={uid:'b'};else if(mode==='logout')s.firebaseUser=null;else s.engagementSessionEpoch++;mail().messages=[{id:'new-session-sentinel'}];effects.length=0;};
 return {s,pending,calls,effects,mail,claim,switchSession};
}
for(const mode of ['account','logout','same-account-relogin'])for(const outcome of ['success','failure']){
 test(`late title ${outcome} after ${mode} cannot open ceremony, refresh new mail, or render`,async()=>{
  const f=setup(),job=f.claim();f.switchSession(mode);
  if(outcome==='success')f.pending.resolve({ok:true,title:{id:'s3_champion'}});else f.pending.reject(Error('offline'));
  await job;
  assert.deepEqual(f.effects,[]);
  assert.equal(f.calls.length,1);
  assert.equal(f.mail().messages[0].id,'new-session-sentinel');
  assert.equal(f.mail().error,'');assert.equal(f.mail().busy,false);
  assert.equal(f.s.location.href,'unchanged');
 });
}
for(const replay of [false,true])test(`current session ${replay?'replay':'claim'} opens ceremony and refreshes once; double click is blocked`,async()=>{
 const f=setup(),job=f.claim(replay);await f.claim(replay);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,replay?'replay':'open');
 f.pending.resolve({ok:true,title:{id:'s2_champion'}});await job;
 assert.equal(f.effects.filter(x=>x==='open').length,1);
 assert.equal(f.calls.filter(x=>x.action==='list').length,1);assert.equal(f.mail().busy,false);
});
test('current session service failure is retryable and cannot show success ceremony',async()=>{
 const f=setup(),job=f.claim();f.pending.reject(Error('offline'));await job;
 assert.equal(f.mail().busy,false);assert.ok(f.mail().error);assert.equal(f.effects.includes('open'),false);
 assert.equal(f.calls.length,1);
});
test('blocked popup falls back only for the current session',async()=>{
 const f=setup();f.s.window.open=()=>null;const job=f.claim();f.pending.resolve({ok:true,title:{id:'s3_champion'}});await job;
 assert.equal(f.s.location.href,'title-ceremony-s3-demo.html?ceremony=1');
});

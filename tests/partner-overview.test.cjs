const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const ui=require('../partner-organizer-ui.js');
const profile=()=>({active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'org',organizationName:'<主辦>',plan:'A1',expiresAtMs:Date.now()+86400000}});

test('manual authorization stays explicit without inventing a quota or contract',()=>{
  const html=ui.renderOverview(profile());
  assert.match(html,/手動授權/);assert.match(html,/場次額度未設定/);assert.match(html,/&lt;主辦&gt;/);
  assert.doesNotMatch(html,/data-partner-own-contract|data-partner-quota-refresh/);
  assert.equal(ui.renderOverview({...profile(),active:false}),'');
});
test('server quota must belong to the same account and order and contain valid counts',()=>{
  const c={orderCode:'order',targetUid:'host',status:'active',includedEvents:10,usedEvents:2};
  assert.deepEqual(ui.validQuota(c,'order','host'),{total:10,used:2});
  for(const change of [{orderCode:'other'},{targetUid:'other'},{status:'signed'},{includedEvents:-1},{usedEvents:-1},{usedEvents:11},{usedEvents:1.5},{includedEvents:'10'}])assert.throws(()=>ui.validQuota({...c,...change},'order','host'));
});

function harness(){
  const listeners={},events={},state={actor:'host',value:{...profile().partnerOrganizer,scope:'contract',orderCode:'order',startsAtMs:Date.now()-1000},calls:0,used:2,fail:false,panel:null,dialog:null};
  const button={focus(){},isConnected:true};
  const document={body:{appendChild:e=>{state.dialog=e;}},activeElement:button,
    addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:(name,fn)=>{if(listeners[name]===fn)delete listeners[name];},
    querySelector:s=>s==='[data-partner-overview]'?state.panel:s==='[data-partner-own-contract-dialog]'?state.dialog:null,querySelectorAll:()=>[],
    createElement:()=>({style:{},setAttribute(){},addEventListener(){},querySelector:()=>button,remove(){state.dialog=null;},innerHTML:''})};
  const c={console,Date,Intl,Promise,document,queueMicrotask,setTimeout,clearTimeout,MutationObserver:class{constructor(fn){state.observe=fn;}observe(){}},
    currentAuthUid:()=>state.actor,partnerOrganizerGrant:()=>state.value,addEventListener:(name,fn)=>events[name]=fn,
    engagementService:{getPartnerContract:async()=>{state.calls++;if(state.pending)return new Promise(resolve=>state.resolveOld=resolve);if(state.fail)throw Error('permission-denied');return {orderCode:'order',targetUid:'host',status:'active',includedEvents:10,usedEvents:state.used,terms:'<script>unsafe</script>'};}}};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../partner-organizer-ui.js'),'utf8'),c);
  const mount=()=>{const html=c.BXHPartnerOrganizer.renderOverview({active:true,role:'player',partnerOrganizer:state.value});state.panel={innerHTML:html,getAttribute:()=>state.value.orderCode||''};state.observe();};
  const click=selector=>listeners.click({target:{closest:s=>s===selector?{}:null}});
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  return {c,state,events,listeners,mount,click,settle};
}
test('overview loads once, retries errors and refreshes after successful room creation',async()=>{
  const h=harness();h.mount();await h.settle();assert.equal(h.state.calls,1);assert.equal(h.c.BXHPartnerOrganizer.remainingRooms('order'),8);
  h.mount();await h.settle();assert.equal(h.state.calls,1);
  h.state.used=3;h.events['bxh-partner-room-created']();await h.settle();assert.equal(h.c.BXHPartnerOrganizer.remainingRooms('order'),7);
  h.state.fail=true;h.click('[data-partner-quota-refresh]');await h.settle();assert.equal(h.c.BXHPartnerOrganizer.remainingRooms('order'),null);assert.match(h.state.panel.innerHTML,/目前無法讀取合作合約/);
  h.state.fail=false;h.click('[data-partner-quota-refresh]');await h.settle();assert.equal(h.c.BXHPartnerOrganizer.remainingRooms('order'),7);
});
test('account or authorization changes discard delayed quota replies',async()=>{
  for(const change of [h=>h.state.actor='another',h=>h.state.value={...h.state.value,expiresAtMs:Date.now()+200000}]){
    const h=harness();h.state.pending=true;h.mount();await h.settle();change(h);h.mount();
    h.state.resolveOld({orderCode:'order',targetUid:'host',status:'active',includedEvents:999,usedEvents:0});await h.settle();
    assert.equal(h.c.BXHPartnerOrganizer.remainingRooms('order'),null);assert.doesNotMatch(h.state.panel.innerHTML,/999 場/);
  }
});
test('own contract is read-only, escapes terms, closes on Escape and on identity loss',async()=>{
  const h=harness();h.mount();await h.settle();h.click('[data-partner-own-contract]');assert.match(h.state.dialog.innerHTML,/&lt;script&gt;unsafe/);assert.doesNotMatch(h.state.dialog.innerHTML,/data-partner-review-activate|<input|<script>/);
  h.listeners.keydown({key:'Escape'});assert.equal(h.state.dialog,null);
  h.click('[data-partner-own-contract]');h.state.value=null;h.state.observe();await h.settle();assert.equal(h.state.dialog,null);assert.equal(h.c.BXHPartnerOrganizer.remainingRooms('order'),null);
});

test('overview is wired into management and permission errors do not claim exhausted quota',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
  const management=app.slice(app.indexOf('function renderTournamentManagementTab(){'),app.indexOf('function renderAdminTournamentListModal(){'));
  assert.match(management,/isPartnerOrganizerMode\(\)\?window\.BXHPartnerOrganizer\?\.renderOverview/);
  assert.match(app,/此訊息不代表場次已用完/);
});

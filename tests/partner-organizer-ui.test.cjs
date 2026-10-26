const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../partner-organizer-ui.js');
test('only active account with an active scoped grant sees organizer shell',()=>{
  const profile={active:true,role:'player',partnerOrganizer:{status:'active',organizationId:'org-1',organizationName:'甲店',expiresAtMs:Date.now()+86400000}};
  assert.equal(ui.hasGrant(profile),true);
  assert.match(ui.render(profile),/合作主辦工作台/);
  assert.equal(ui.hasGrant({...profile,active:false}),false);
  assert.equal(ui.hasGrant({...profile,partnerOrganizer:{status:'active'}}),false);
  assert.equal(ui.hasGrant({...profile,partnerOrganizer:{status:'revoked',organizationId:'org-1'}}),false);
});
test('organizer name is escaped and shell has no room mutation',()=>{
  const html=ui.render({active:true,role:'player',partnerOrganizer:{status:'active',organizationId:'a',organizationName:'<img src=x>',expiresAtMs:Date.now()+86400000}});
  assert.doesNotMatch(html,/<img/);
  assert.doesNotMatch(html,/data-action="(create|start|publish)-/);
});

test('future, missing, malformed and expired authorization never opens the workspace',()=>{
  const now=Date.now(),profile={active:true,role:'player',partnerOrganizer:{status:'active',organizationId:'org',startsAtMs:now-1000,expiresAtMs:now+60000}};
  assert.equal(ui.grant(profile),profile.partnerOrganizer);
  for(const patch of [
    {startsAtMs:now+30000}, {startsAtMs:'invalid'}, {startsAtMs:-1},
    {expiresAtMs:undefined}, {expiresAtMs:'invalid'}, {expiresAtMs:''},
    {expiresAtMs:Infinity}, {expiresAtMs:true}, {expiresAtMs:now-1},
    {organizationId:' '}
  ]){
    const candidate={...profile,partnerOrganizer:{...profile.partnerOrganizer,...patch}};
    assert.equal(ui.hasGrant(candidate),false,JSON.stringify(patch));
    assert.equal(ui.render(candidate),'');
  }
  for(const patch of [{active:false},{role:'admin'},{role:'tester'},{isTestAccount:true},{deleted:true},{accountStatus:'frozen'},{accountStatus:'disabled'},{accountStatus:'deleted'}]){
    assert.equal(ui.hasGrant({...profile,...patch}),false,JSON.stringify(patch));
  }
  assert.equal(ui.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,scope:'contract',startsAtMs:undefined}}),false);
});

test('Taiwan ISO dates and epoch times share the same inclusive start and exclusive expiry boundary',()=>{
  const original=Date.now,now=Date.parse('2026-10-27T00:00:00+08:00');
  Date.now=()=>now;
  try{
    const profile={active:true,role:'player',partnerOrganizer:{status:'active',organizationId:'org',startsAt:'2026-10-27T00:00:00+08:00',expiresAt:'2026-10-28T00:00:00+08:00'}};
    assert.equal(ui.hasGrant(profile),true);
    assert.equal(ui.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,startsAtMs:now+1}}),false);
    assert.equal(ui.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,expiresAtMs:now}}),false);
    assert.equal(ui.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,expiresAtMs:0}}),false);
    assert.equal(ui.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,startsAtMs:0,expiresAtMs:String(now+1000)}}),true);
  }finally{Date.now=original;}
});

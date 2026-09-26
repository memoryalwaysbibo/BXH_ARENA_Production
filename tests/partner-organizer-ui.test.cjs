const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../partner-organizer-ui.js');
test('only active account with an active scoped grant sees organizer shell',()=>{
  const profile={active:true,role:'player',partnerOrganizer:{status:'active',organizationId:'org-1',organizationName:'甲店'}};
  assert.equal(ui.hasGrant(profile),true);
  assert.match(ui.render(profile),/合作主辦工作台/);
  assert.equal(ui.hasGrant({...profile,active:false}),false);
  assert.equal(ui.hasGrant({...profile,partnerOrganizer:{status:'active'}}),false);
  assert.equal(ui.hasGrant({...profile,partnerOrganizer:{status:'revoked',organizationId:'org-1'}}),false);
});
test('organizer name is escaped and shell has no room mutation',()=>{
  const html=ui.render({active:true,partnerOrganizer:{status:'active',organizationId:'a',organizationName:'<img src=x>'}});
  assert.doesNotMatch(html,/<img/);
  assert.doesNotMatch(html,/data-action="(create|start|publish)-/);
});

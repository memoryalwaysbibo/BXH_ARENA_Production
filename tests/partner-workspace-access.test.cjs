const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','modules/main-app/core.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'..','modules/cloud/cloud-runtime.js'),'utf8');
const policy=require('../partner-organizer-ui.js');

test('active partner organizer enters the operational tournament workspace',()=>{
  assert.match(app,/await saveActiveMode\("partner_organizer"\);currentRole="admin";appPhase="app";activeTab="management"/);
  assert.match(app,/intent==="partner_organizer"\s*\?\s*"admin"/);
  assert.match(app,/if\(intent==="partner_organizer"\)\{appPhase="app";activeTab="management"/);
});

test('partner organizer room-list query proves every Firestore read-rule field',()=>{
  const query=cloud.slice(cloud.indexOf('async queryAdminTournaments(){'),cloud.indexOf('async queryAdminTournaments(){')+3000);
  assert.match(query,/fx\.where\("createdBy","==",actorUid\)/);
  assert.match(query,/fx\.where\("createdByRole","==","partner_organizer"\)/);
  assert.match(query,/fx\.where\("eventAuthority","==","official"\)/);
  assert.match(query,/fx\.where\("partnerOrganizationCode","==",partnerGrant\.organizationId\)/);
  assert.match(query,/fx\.where\("partnerContractOrderCode","==",partnerOrderCode\)/);
  assert.match(query,/partnerGrant\?\.scope==="contract"&&!partnerOrderCode/);
  assert.match(query,/d\.partnerOrganizationCode!==partnerGrant\.organizationId/);
  assert.match(cloud,/partnerOrganizationCode:partnerGrant\.organizationId/);
  assert.match(cloud,/createdByRole:"partner_organizer"/);
});

test('grant expiry accepts both epoch and contract ISO values',()=>{
  const now=Date.now(),profile={active:true,role:'player',partnerOrganizer:{status:'active',scope:'contract',organizationId:'org',startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()}};
  assert.equal(policy.hasGrant(profile),true);
  assert.equal(policy.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,startsAtMs:now-1000,expiresAtMs:now+60000}}),true);
  assert.equal(policy.hasGrant({...profile,partnerOrganizer:{...profile.partnerOrganizer,expiresAt:'invalid'}}),false);
});

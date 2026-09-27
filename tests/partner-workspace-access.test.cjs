const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'..','partner-organizer-ui.js'),'utf8');

test('active partner organizer enters the operational tournament workspace',()=>{
  assert.match(html,/saveActiveMode\("partner_organizer"\);currentRole="admin";appPhase="app";activeTab="management"/);
  assert.match(html,/intent==="partner_organizer"\s*\?\s*"admin"/);
  assert.match(html,/if\(intent==="partner_organizer"\)\{appPhase="app";activeTab="management"/);
});

test('partner organizer sees only tournaments created for the active organization',()=>{
  assert.match(html,/fx\.where\("createdBy","==",actorUid\)/);
  assert.match(html,/d\.partnerOrganizationCode!==partnerOrganizerGrant\(\)\.organizationId/);
  assert.match(html,/partnerOrganizationCode:partnerGrant\.organizationId/);
  assert.match(html,/createdByRole:"partner_organizer"/);
});

test('grant expiry accepts both epoch and contract ISO values',()=>{
  assert.match(ui,/value\.expiresAtMs\?\?value\.expiresAt/);
  assert.match(ui,/Date\.parse\(rawExpiry\)/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=fs.readFileSync(path.join(__dirname,'..','modules','main-app','core.js'),'utf8');
const mailbox=fs.readFileSync(path.join(__dirname,'..','modules','main-app','mailbox.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'..','modules','cloud','cloud-runtime.js'),'utf8');
const html=core+'\n'+mailbox+'\n'+cloud;

test('event staff is a separate activity-scoped mode',()=>{
  assert.match(html,/mode==="event_staff"/);
  assert.match(html,/切換至工作人員（活動）/);
  assert.match(html,/eventStaffMemberships/);
  assert.match(html,/action:"listMine"/);
});
test('activity organizer can invite and revoke without deleting records',()=>{
  assert.match(html,/工作人員（活動）邀請已寄到對方站內信/);
  assert.match(html,/action:"invite"/);
  assert.match(html,/action:"revoke"/);
  assert.match(html,/活動、房間與歷史資料全部保留/);
});
test('saved tournament deletion is hidden and blocked outside BXH administrators',()=>{
  assert.match(html,/isAdminTierOrAbove\(\)\?`<button class="btn btn-danger btn-sm" data-action="cloud-admin-delete-tournament"/);
  assert.match(html,/活動主辦及工作人員（活動）不可刪除已保存的活動與房間/);
});
test('mailbox invitation requires explicit acceptance',()=>{
  assert.match(html,/mailbox-event-staff-respond/);
  assert.match(html,/接受工作人員（活動）邀請/);
  assert.match(html,/data-response="accept"/);
});
test('event referee duty is enforced from the tournament assignment map',()=>{
  assert.match(html,/const eventStaffAssignment=\(docData\.eventStaffAssignments&&docData\.eventStaffAssignments\[actorUid\]\)\|\|null/);
  assert.match(html,/eventStaffAssignment\.status==="accepted"/);
  assert.match(html,/duty==="referee"\|\|duty==="head_referee"/);
  assert.match(html,/actor\.role==="staff"\|\|actorIsEventReferee/);
});

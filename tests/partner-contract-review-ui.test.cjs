const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ui=fs.readFileSync(require('node:path').join(__dirname,'..','partner-organizer-ui.js'),'utf8');

test('super admin can recover and locate pending partner contracts',()=>{
  assert.match(ui,/async function loadPendingContracts\\(force=false\\)/);
  assert.match(ui,/tournamentOperation\\('listPartnerContracts'/);
  assert.match(ui,/待審合作合約/);
  assert.match(ui,/data-partner-review-open/);
  assert.match(ui,/待最高管理員確認付款/);
});

test('pending contracts reveal the account contract controls without legacy grant',()=>{
  assert.match(ui,/sessionStorage\\.setItem\\('bxh-partner-order:/);
  assert.match(ui,/if\\(form\\)form\\.hidden=false/);
  assert.match(ui,/data-action="partner-refresh-contract"/);
});

test('signed mailbox contracts are disabled after checking backend state',()=>{
  assert.match(ui,/decorateMailboxContractButtons/);
  assert.match(ui,/getPartnerContract\\?\\.\\(\\{orderCode:code\\}\\)/);
  assert.match(ui,/button\\.disabled=true/);
  assert.match(ui,/已完成簽署/);
});

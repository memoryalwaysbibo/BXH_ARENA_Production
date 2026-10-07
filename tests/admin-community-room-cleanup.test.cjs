const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
const host=fs.readFileSync(path.join(root,'modules/main-app/community-host.js'),'utf8');

test('super admin and admin get a dedicated community room cleanup list',()=>{
  assert.match(core,/data-filter="community">一般房間/);
  assert.match(core,/if\(t\.eventAuthority==="community"\) return isAdminTierOrAbove\(\)/);
  assert.match(core,/data-community="\$\{isCommunity\?'true':'false'\}"/);
  assert.match(core,/工作人員無法查看或刪除一般房間/);
});

test('community admin deletion uses the existing trusted safe-delete path',()=>{
  assert.match(core,/if\(!isAdminTierOrAbove\(\)\)\{ showToast\("活動主辦及工作人員（活動）不可刪除已保存的活動與房間/);
  assert.match(core,/await window\.cloudSync\.deleteTournament\(code\)/);
  assert.match(cloud,/deleteTournamentSafely\(\{code:normalized,operationId:crypto\.randomUUID\(\)\}\)/);
  assert.match(core,/已完成的主辦摘要仍保留/);
});

test('an empty host-only community room expires after six hours',()=>{
  assert.match(core,/const COMMUNITY_DRAFT_IDLE_MS = 6\*60\*60\*1000/);
  assert.match(core,/some\(p=>p&&p\.isRoomOwner!==true\)/);
  assert.match(cloud,/hasStructure\?24\*60\*60\*1000:6\*60\*60\*1000/);
  assert.match(host,/空白房，連續 6 小時無操作後清理/);
});

const vm=require('node:vm');
function expiryContext(){
  const constants=core.match(/const COMMUNITY_DRAFT_IDLE_MS = [^;]+;[\s\S]*?const COMMUNITY_COMPLETED_FULL_MS = [^;]+;/)[0];
  const functions=core.slice(core.indexOf('function communityRoomExpiryMs('),core.indexOf('function blockIfNotAdmin('));
  const ctx=vm.createContext({Date});
  vm.runInContext(constants+'\n'+functions,ctx);
  return ctx;
}
test('structured and running community rooms expire 24 hours after their last activity',()=>{
  const ctx=expiryContext(),base=Date.parse('2026-10-07T03:00:00Z');
  for(const structure of [{players:[{isRoomOwner:true},{id:'guest'}]},{matches:[{id:'match'}]},{bracketSize:2},{startedAt:base-1000}]){
    const room={meta:{eventAuthority:'community'},lastActivityAt:base,...structure};
    assert.equal(ctx.communityRoomExpiryMs(room),base+24*60*60*1000);
  }
  assert.match(cloud,/result\.state\.expiresAtMs=communityRoomExpiryMs\(result\.state\)/);
  assert.match(host,/連續 24 小時無操作後清理/);
});
test('empty, completed, official and scheduled room exemptions are preserved',()=>{
  const ctx=expiryContext(),base=Date.parse('2026-10-07T03:00:00Z');
  assert.equal(ctx.communityRoomExpiryMs({meta:{eventAuthority:'community'},lastActivityAt:base,players:[{isRoomOwner:true}]}),base+6*60*60*1000);
  assert.equal(ctx.communityRoomExpiryMs({meta:{eventAuthority:'community'},archiveStatus:'completed'}),null);
  assert.equal(ctx.communityRoomExpiryMs({meta:{eventAuthority:'official'}}),null);
  assert.equal(ctx.communityRoomExpiryMs({meta:{eventAuthority:'community',date:'2026-11-14'},lastActivityAt:base,players:[{id:'guest'}]}),Date.parse('2026-11-14T23:59:59+08:00')+14*24*60*60*1000);
});

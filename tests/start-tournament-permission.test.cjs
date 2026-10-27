'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const start=source.indexOf('function canStartCurrentTournament(){');
const end=source.indexOf('\n}',start)+2;
assert(start>=0&&end>start,'missing start permission helper');
const fn=source.slice(start,end);
function allowed({admin=false,staff=false,creator=false,communityOwner=false,testOwner=false}={}){
 return vm.runInNewContext(fn+';canStartCurrentTournament()',{
   isAdminTierOrAbove:()=>admin,isOwnTestTournament:()=>testOwner,
   isCommunityRoomOwner:()=>communityOwner,isStaffTier:()=>staff,
   isCurrentOfficialTournamentCreator:()=>creator
 });
}
test('start event is limited to managers and room owners, not unrelated Staff',()=>{
 assert.equal(allowed({admin:true}),true);
 assert.equal(allowed({staff:true,creator:true}),true);
 assert.equal(allowed({communityOwner:true}),true);
 assert.equal(allowed({testOwner:true}),true);
 assert.equal(allowed({staff:true}),false);
 assert.equal(allowed(),false);
});
test('start control is disabled and labeled for unauthorized actors',()=>{
 assert.match(source,/data-action="start-tournament"[^\n]*!canStartCurrentTournament\(\)\?'disabled title=/);
 assert.match(source,/僅限房主或管理員開始賽事/);
});
test('direct action and both delayed confirmation routes recheck permissions',()=>{
 assert.match(source,/if\(action==="start-tournament"\)\{\s*if\(!canStartCurrentTournament\(\)\)/);
 assert.match(source,/confirmLabel:"正式開始",onConfirm:async\(\)=>\{\s*if\(!canStartCurrentTournament\(\)\)/);
 assert.match(source,/const actuallyStart=\(\)=>\{\s*if\(!canStartCurrentTournament\(\)\)/);
});

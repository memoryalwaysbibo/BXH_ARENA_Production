'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=process.argv[2]||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert(start>=0,`Missing function ${name}`);
  let depth=0,opened=false;
  for(let i=start;i<html.length;i++){
    if(html[i]==='{'){ depth++; opened=true; }
    if(html[i]==='}'&&opened&&--depth===0) return html.slice(start,i+1);
  }
  throw new Error(`Unterminated function ${name}`);
}

const context=vm.createContext({
  isCommunityRoomOwner:()=>false,
  isOwnTestTournament:()=>false,
  isTester:()=>false,
  isAdminTierOrAbove:()=>false,
  isStaffTier:()=>true,
  hasAdminAccess:()=>false
});
vm.runInContext(functionSource('refereeStationRestrictionEnabled'),context);
vm.runInContext(functionSource('canOperateStation'),context);

assert.equal(vm.runInContext('refereeStationRestrictionEnabled({meta:{refereeStationRestrictionEnabled:true}})',context),false,
  'Legacy restriction flag must be ignored');
assert.equal(vm.runInContext('canOperateStation(2,{meta:{refereeStationRestrictionEnabled:true}})',context),true,
  'Authorized staff must be able to operate an unassigned Court');

const panel=functionSource('renderRefereeStationAssignmentPanel');
assert(panel.includes('全桌可操作｜責任分配僅供顯示與稽核'),'Assignment panel must explain all-Court operation');
assert(!panel.includes('data-action="toggle-referee-station-restriction"'),'Restriction toggle must not remain interactive');

const mutationStart=html.indexOf('async mutateMatchTransaction(');
const confirmationStart=html.indexOf('async confirmMatchTransaction(',mutationStart);
const confirmationEnd=html.indexOf('\n    async ',confirmationStart+10);
const transactionSource=html.slice(mutationStart,confirmationEnd>0?confirmationEnd:html.length);
assert(!/actor\.role==="staff"\s*&&\s*docData\.refereeStationRestrictionEnabled/.test(transactionSource),
  'Cloud transactions must not reject staff by Court assignment');
assert(html.includes('state.meta.refereeStationRestrictionEnabled=false;'),
  'Saving responsibility assignments must migrate the legacy flag to false');
assert(!html.includes('${refereeStationRestrictionEnabled()?"｜桌次限制":""}'),
  'Workstation header must not show an inactive restriction');

console.log('PASS referee responsibility display retained with all-Court staff operation');

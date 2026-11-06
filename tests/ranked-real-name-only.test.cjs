'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=fs.readFileSync(require('node:path').join(__dirname,'../modules/main-app/core.js'),'utf8');
function fn(name){
 const a=core.indexOf('function '+name+'(');
 assert(a>=0,name);
 return core.slice(a,core.indexOf('\n}',a)+2);
}
function context(mode,draft=null){
 const ctx=vm.createContext({state:{meta:{ladderMode:mode},testLadderEnabled:false},settingsFormDraft:draft,registrationFormDraft:{participantNameMode:'realName'},registrationFormDraftDirty:false,
 syncSettingsDraftFromDom(){},ensureRegistrationFormDraft(){},render(){},aiCreateLastApplied:null});
 vm.runInContext(fn('registrationGameIdDisabled')+'\n'+fn('registrationParticipantNameMode'),ctx);
 return ctx;
}
test('ranked mode and retained game-ID drafts resolve to real names',()=>{
 const ctx=context('ranked');
 assert.equal(ctx.registrationGameIdDisabled(),true);
 assert.equal(ctx.registrationParticipantNameMode('gameId'),'realName');
});
test('draft mode governs switches before saving; general mode keeps game-ID support',()=>{
 const ctx=context('general',{ladderMode:'ranked'});
 assert.equal(ctx.registrationParticipantNameMode('gameId'),'realName');
 ctx.settingsFormDraft.ladderMode='general';
 assert.equal(ctx.registrationParticipantNameMode('gameId'),'gameId');
 ctx.state.meta.ladderMode='ranked';
 assert.equal(ctx.registrationGameIdDisabled(),false);
 ctx.settingsFormDraft=null;
 assert.equal(ctx.registrationGameIdDisabled(),true);
});
test('test ranked rooms also disable game-ID names',()=>{
 const ctx=context('general');ctx.state.testLadderEnabled=true;
 assert.equal(ctx.registrationParticipantNameMode('gameId'),'realName');
});
test('game-ID action cannot change a ranked draft, including synthetic invocation',()=>{
 const a=core.indexOf('  if(action==="set-registration-draft-name-mode"){');
 const b=core.indexOf('  if(action==="set-registration-draft-target-group"){',a);
 for(const mode of ['ranked','general']){
  const ctx=context(mode);
  vm.runInContext('function click(action,target){'+core.slice(a,b)+'}',ctx);
  ctx.click('set-registration-draft-name-mode',{getAttribute:()=> 'gameId'});
  assert.equal(ctx.registrationFormDraft.participantNameMode,mode==='ranked'?'realName':'gameId');
  assert.equal(ctx.registrationFormDraftDirty,mode==='general');
 }
});
test('every registration save and publish assignment applies the ranked name policy',()=>{
 const assignments=core.match(/state\.meta\.participantNameMode\s*=.*;/g);
 assert.equal(assignments.length,3);
 for(const assignment of assignments){
  const ctx=context('ranked');ctx.d=ctx.rd={participantNameMode:'gameId'};
  vm.runInContext(assignment,ctx);
  assert.equal(ctx.state.meta.participantNameMode,'realName');
 }
});
test('ranked game-ID button has native disabled semantics, grey styling and explanation',()=>{
 assert.match(core,/data-value="gameId" \$\{gameIdDisabled\?'disabled aria-disabled="true" style="opacity:\.45;filter:grayscale\(1\);cursor:not-allowed"/);
 assert.match(core,/participantNameMode=registrationParticipantNameMode\(d.participantNameMode\)/);
 assert.match(core,/積分模式固定使用本名，遊戲 ID 功能暫不開放/);
});

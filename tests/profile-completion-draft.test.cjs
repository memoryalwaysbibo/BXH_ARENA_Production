'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('modules/main-app/core.js','utf8');
function cut(name){const a=source.indexOf('function '+name+'('),b=source.indexOf('\nfunction ',a+9);assert(a>=0&&b>a);return source.slice(a,b);}
function fixture(owner='a',pending='a',existing=false){
 const values={'complete-realname':'甲"<','complete-nickname':'角色','complete-phone':'0912345678'};
 let focused=0,selected=0;
 const field={id:'complete-realname',value:values['complete-realname'],selectionStart:1,selectionEnd:2,focus:()=>focused++,setSelectionRange:(a,b)=>{assert.equal(a,1);assert.equal(b,2);selected++;},closest:s=>s==='#complete-profile-form'?card:null};
 const card={getAttribute:()=>owner,querySelector:s=>({value:values[s.slice(1)]}),contains:x=>x===field};
 const ctx=vm.createContext({document:{activeElement:field,getElementById:id=>id==='complete-profile-form'?card:field},window:{scrollX:0,scrollY:0},
  pendingNewPlayerProfile:existing?null:{uid:pending,email:'synthetic@example.invalid'},pendingExistingAccountProfile:existing?{uid:pending}:null,
  appPhase:'player-complete-profile',playerApplyError:'',playerApplyBusy:false,playerProfileEditOpen:false,
  currentAuthUid:()=>pending,currentRenderViewportKey:()=> 'complete',captureHorizontalNavPositions:()=>[],restoreHorizontalNavPositions:()=>{},
  __lastRenderedViewportKey:null,__viewportRestoreToken:0,requestAnimationFrame:fn=>fn(),setTimeout:fn=>fn(),
  authShellOpen:()=>'',authShellClose:()=>'',authBrandHeader:()=>'',esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))});
 for(const name of ['renderPlayerCompleteProfileScreen','captureRenderViewport','finishRenderViewport'])vm.runInContext(cut(name),ctx);
 return {ctx,render:()=>ctx.renderPlayerCompleteProfileScreen(),stats:()=>({focused,selected})};
}
test('completion rerender retains all fields for the same pending UID and escapes HTML',()=>{
 const f=fixture(),html=f.render();assert(html.includes('value="甲&quot;&lt;"'));assert(html.includes('value="角色"'));assert(html.includes('value="0912345678"'));assert(html.includes('required'));
});
test('changing pending UID cannot inherit another account completion draft',()=>{
 const f=fixture('old','new'),html=f.render();assert(!html.includes('0912345678'));assert(!html.includes('value="角色"'));
});
test('existing-account completion keeps draft without imposing new-account required fields',()=>{
 const f=fixture('a','a',true),html=f.render();assert(html.includes('value="0912345678"'));assert(!html.includes(' required'));
});
test('completion render restores focus and cursor only to its own pending account',()=>{
 const f=fixture(),snapshot=f.ctx.captureRenderViewport();f.ctx.finishRenderViewport(snapshot);assert.deepEqual(f.stats(),{focused:1,selected:1});
});
test('a late focus restore cannot target a different pending account',()=>{
 const f=fixture(),snapshot=f.ctx.captureRenderViewport();f.ctx.pendingNewPlayerProfile={uid:'other'};f.ctx.finishRenderViewport(snapshot);assert.deepEqual(f.stats(),{focused:0,selected:0});
});

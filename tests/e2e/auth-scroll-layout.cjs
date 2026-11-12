'use strict';
// Real registration renderer + shipped CSS in an isolated browser. No Firebase calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('modules/main-app/core.js');
function fn(name){
 const match=new RegExp('^function '+name+'\\(','m').exec(core);assert(match,name);
 const start=match.index,line=core.slice(start,core.indexOf('\n',start));
 return /\}\s*$/.test(line)?line:core.slice(start,core.indexOf('\n}',start)+2);
}
const css=[...read('index.html').matchAll(/<link\b[^>]*>/g)].filter(m=>/rel="stylesheet"/.test(m[0])).map(m=>m[0].match(/href="([^"?]+)/)?.[1]).filter(p=>p&&!/^https?:/.test(p)).map(read).join('\n');
function render(count,loading=false){
 const t={code:'TEST-LOCAL',name:'BXH V2 報名並發驗收（內部測試）',capacity:16,confirmedCount:12,waitlistEnabled:true,waitlistCapacity:8,targetGroup:'open',formatType:'single',eventDate:'2026-11-12',startAt:'21:00',checkInAt:'20:00',fee:0,location:'BXH 內部測試｜非實體活動'};
 const ctx=vm.createContext({
  window:{},LOGO_SRC:'',esc:s=>String(s??''),tournamentDetailCode:t.code,tournamentDetailData:t,
  tournamentDetailLoading:loading,tournamentDetailError:null,tournamentDetailBusy:false,tournamentDetailChildConfirmed:false,
  tournamentDetailMyRegs:Array.from({length:count},(_,i)=>({status:'confirmed',participantName:'測試選手 '+(i+1),familyPlayerId:i?'child'+i:null})),tournamentDetailMyReg:null,
  userProfile:{realName:'測試選手',displayName:'測試選手'},firebaseUser:{uid:'local',email:'test@example.invalid'},
  publicVenueFromTournament:()=>({}),tournamentBattleMode:()=> 'single',tournamentTeamSize:()=>1,
  getEffectiveRegistrationStatus:()=> 'open',isUnlimitedCommunityRegistration:()=>false,communityRegistrationParticipantCount:()=>12,
  isGuestReadOnlyContext:()=>false,publicTournamentRegistrationLocked:()=>false,isCommunityQuickRegistration:()=>true,
  communityRegistrationLocked:()=>false,canCancelCommunityRegistration:()=>true,publicEventLifecycleStatus:()=>({label:'尚未開始'}),
  renderVenueNavigationMenu:()=>'',formatTournamentDetailDateTime:()=> '11/12 20:00',renderTournamentStandardTemplate:()=>'',renderModal:()=>'',
  TARGET_GROUP_LABELS:{open:'公開組'},TARGET_GROUP_DESCRIPTIONS:{open:'不限年齡，符合活動規則者皆可參加。'},FORMAT_LABELS:{single:'單淘汰賽'},REGISTRATION_STATUS_LABELS:{open:'開放報名'}
 });
 for(const name of ['authShellOpen','authBrandHeader','renderTournamentDetailScreen'])vm.runInContext(fn(name),ctx);
 return ctx.renderTournamentDetailScreen();
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{
  for(const theme of ['three-gods','gold'])for(const [width,height] of [[934,900],[1440,900],[1280,600],[768,600],[390,844],[305,811]])for(const count of [0,1,5]){
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
   await page.route('**/*',r=>r.abort());
   await page.setContent('<!doctype html><html data-bxh-theme="'+theme+'"><head><meta charset="utf-8"><style>'+css+'</style></head><body>'+render(count)+'</body></html>');
   await page.evaluate(()=>document.getAnimations().forEach(a=>Number.isFinite(a.effect.getComputedTiming().endTime)?a.finish():a.cancel()));
   // Demonstrate the original failure using the old flex-shrink value.
   if(theme==='three-gods'&&width===934&&count===1){
    const legacy=await page.addStyleTag({content:'.auth-content{flex-shrink:1!important}'});
    const oldTop=await page.locator('.tournament-detail-brand').evaluate(el=>el.getBoundingClientRect().top);
    const scrollTop=await page.locator('.auth-scroll').evaluate(el=>el.getBoundingClientRect().top);
    assert(oldTop<scrollTop,'fixture must reproduce original clipped header');
    console.log('REPRODUCED original clipped header: '+Math.round(oldTop-scrollTop)+'px above scroll viewport');
    await legacy.evaluate(el=>el.remove());
   }
   const bounds=await page.evaluate(()=>{
    const scroll=document.querySelector('.auth-scroll'),brand=document.querySelector('.tournament-detail-brand'),title=document.querySelector('.tournament-action-panel .panel-title');
    return {scrollTop:scroll.scrollTop,viewportTop:scroll.getBoundingClientRect().top,brandTop:brand.getBoundingClientRect().top,titleTop:title.getBoundingClientRect().top};
   });
   assert.equal(bounds.scrollTop,0);assert(bounds.brandTop>=bounds.viewportTop,JSON.stringify({theme,width,height,count,...bounds}));
   assert(bounds.titleTop>=bounds.viewportTop,'registration title clipped');
   await page.locator('.auth-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight});
   const bottom=await page.evaluate(()=>{const s=document.querySelector('.auth-scroll'),last=document.querySelector('.auth-content').lastElementChild;return {bottom:last.getBoundingClientRect().bottom,viewport:s.getBoundingClientRect().bottom,overflow:s.scrollWidth-s.clientWidth}});
   assert(bottom.bottom<=bottom.viewport+1,'last panel unreachable');assert(bottom.overflow<=1,'horizontal overflow');
   if(theme==='three-gods'&&count===1&&[934,305].includes(width)&&process.env.BXH_LAYOUT_SCREENSHOTS){
    await page.locator('.auth-scroll').evaluate(el=>{el.scrollTop=0});
    await page.screenshot({path:path.join(process.env.BXH_LAYOUT_SCREENSHOTS,'registration-'+width+'.png')});
   }
   await page.close();
  }
  console.log('PASS 36 layouts: full header at scroll top, last panel reachable, no horizontal overflow (2 themes × 6 viewports × 3 registration states).');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

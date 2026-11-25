'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const extract=(start,end)=>core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));
const script=extract('const MATCH_STATUS_LABELS =','function matchBoxHtml(')+extract('function seMatchBoxHtml(','const BOARD_MEDAL_SVG')+extract('function renderSingleElimBracket(','let __seRelayoutQueued');
function fixture(size,byes){
 const matches=[];let seq=0;
 const player=i=>({id:'p'+i,name:'選手 '+i});
 for(let round=0;round<Math.log2(size);round++){
  for(let i=0;i<size/2**(round+1);i++){
   const isBye=round===0&&i<byes;
   matches.push({id:'m'+seq,seq:seq++,round,bracket:'SE',station:1,isBye,completed:isBye,status:isBye?'completed':'pending',
     a:round===0?player(i*2):null,b:round===0&&!isBye?player(i*2+1):null,winnerId:isBye?'p'+(i*2):null,scoreA:0,scoreB:0});
  }
 }
 return {ok:true,code:'PTN-TEST01',name:'測試賽',phase:'waiting',bracket:matches};
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('bracket layout'))errors.push(m.text());});
  await page.setContent('<main class="commerce-ptn-management" id="app"></main>');
  await page.addStyleTag({content:'body{margin:0;padding:8px;box-sizing:border-box}main,.panel,.bracket-wm-wrap{min-width:0;max-width:100%;box-sizing:border-box}.panel{padding:8px}'+fs.readFileSync(path.join(root,'modules/main-css/core-competition.css'),'utf8')});
  await page.evaluate(()=>{
   window.esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
   window.matchStatusClass=m=>'ms-card-'+m.status;window.wrapBracketWatermark=s=>'<div class="bracket-wm-wrap"><div class="bracket-wm-content">'+s+'</div></div>';
   window.trophySvg=()=>'';window.courtAtmosphereStyle=()=>'';window.BXHFormatUtils={matchSequenceLabel:n=>String(n)};
   window.state=new Proxy({},{get(){throw Error('official state must not be read by PTN');}});
   window.getMatch=window.matchesInRound=()=>{throw Error('official match state must not be read');};
   window.BXHCommerce={verifiedBracketRoom:()=>window.fixture};
  });
  await page.addScriptTag({content:script});
  for(const [size,byes] of [[2,0],[4,0],[32,3],[64,11],[128,2],[256,15]]){
   const result=await page.evaluate(room=>{
    window.fixture=room;document.querySelector('#app').innerHTML=BXHSharedTicketBracket.render(room);layoutSingleElimBracket('');
    const outer=document.querySelector('#se-bracket-outer');
    return {paths:outer.querySelectorAll('path[data-source-match]').length,visible:outer.querySelectorAll('.se-col .match-box:not(.bye-placeholder)').length,
     overflow:document.documentElement.scrollWidth>innerWidth,scrollable:document.querySelector('.bracket-wrap').scrollWidth>=document.querySelector('.bracket-wrap').clientWidth,
     edges:[...outer.querySelectorAll('path[data-source-match]')].map(p=>[p.dataset.sourceMatch,p.dataset.targetMatch])};
   },fixture(size,byes));
   assert.equal(result.paths,Math.max(0,size-2-byes),width+' '+size+' edges');
   assert.equal(result.visible,size-1-byes);
   assert.equal(result.overflow,false,width+' '+size+' page width');
   assert.ok(result.scrollable);
   assert.ok(result.edges.every(([a,b])=>a!==b));
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS PTN shared bracket 2–256 slots on mobile and desktop; actual SVG connectors and scroll bounds');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

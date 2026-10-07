const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const css=fs.readFileSync('modules/main-css/core-competition.css','utf8');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
const layout=core.slice(core.indexOf('function layoutSingleElimBracket(suffix)'),core.indexOf('function drawSingleElimConnectors(',core.indexOf('function layoutSingleElimBracket(suffix)')));
(async()=>{
 const browser=await chromium.launch({headless:true});
 for(const width of [390,709,1440])for(const count of [2,3,4,8])for(const expanded of [false,true]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const rounds=Math.ceil(Math.log2(count)),matches=[];let cols='';
  for(let r=0;r<rounds;r++){
   let boxes='';for(let i=0;i<2**(rounds-r-1);i++){
    const bye=count===3&&r===0&&i===1;
    const m={id:'m'+r+'_'+i,indexInRound:i,round:r,isBye:bye};matches.push(m);
    boxes+=`<div class="match-box ${bye?'bye-placeholder':''}" data-id="${m.id}" data-index="${i}"><div class="mb-row"><div class="player-line"><span class="seed-num">1</span><span>吳宸緯</span></div><span>0</span></div><div class="mb-row"><div class="player-line"><span class="seed-num">2</span><span>吳健凱</span></div><span>0</span></div></div>`;
   }
   cols+=`<div class="se-col ${r===rounds-1?'se-final-stage-col':''}" data-round="${r}"><div class="se-col-title">${r===rounds-1?'冠亞':'準決賽'}</div>${r===rounds-1?'<div class="se-stage-tag se-stage-tag-final">冠亞</div>':''}${boxes}</div>`;
  }
  await page.setContent(`<style>:root{--font-d:Arial;--metal:#ccc;--panel-2:#111;--border:#555;}body{background:#111;color:white;margin:10px}${css}</style><div class="board-shell ${expanded?'board-expanded':''}"><div class="board-viewport"><div id="board-canvas" class="board-canvas"><div id="se-bracket-outer" class="se-bracket-outer"><div id="se-bracket-cols" class="se-bracket-cols">${cols}</div></div></div></div></div><script>const state={matches:${JSON.stringify(matches)}};function matchesInRound(r){return state.matches.filter(m=>m.round===r)}function getMatch(id){return state.matches.find(m=>m.id===id)}function drawSingleElimConnectors(){}${layout};layoutSingleElimBracket();</script>`);
  const result=await page.evaluate(()=>{const col=document.querySelector('.se-final-stage-col'),title=col.querySelector('.se-col-title'),box=col.querySelector('.match-box:not(.bye-placeholder)'),tag=col.querySelector('.se-stage-tag');return {titleVisible:getComputedStyle(title).visibility,titleBottom:title.getBoundingClientRect().bottom,matchTop:box.getBoundingClientRect().top,tagDisplay:getComputedStyle(tag).display}});
  assert.equal(result.titleVisible,'visible');assert.equal(result.tagDisplay,'none');assert.ok(result.titleBottom<=result.matchTop,JSON.stringify({width,count,expanded,result}));
  console.log(`PASS ${width}px ${count} players ${expanded?'expanded':'normal'}: title above match`);await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});

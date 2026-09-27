'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const score=require('../enchantment-score-core.js');

test('player phone receives only its card and sends draw for its own assigned round',async()=>{
 const calls=[],sent=[],listeners={};
 const frame={dataset:{code:'BXH-ABCD',matchId:'match1',side:'A'},contentWindow:{postMessage:x=>sent.push(x)}};
 const state={round:1,phase:'drawing',scores:{A:0,B:0},faults:{A:0,B:0},drawn:{A:false,B:true},
  cards:{A:null,B:'double_burst'}};
 const root={BXHEnchantmentScore:score,engagementService:{enchantment:async payload=>{
  calls.push(payload);
  if(payload.action==='draw')return {version:3,state:{...state,drawn:{A:true,B:true},cards:{A:'double_spin',B:'double_burst'}}};
  return {version:2,state};
 }},addEventListener:(event,fn)=>listeners[event]=fn};
 const document={querySelectorAll:selector=>selector==='iframe[data-enchantment-player]'?[frame]:[],
  addEventListener:(event,fn)=>listeners[event]=fn};
 const context={window:root,document,location:{origin:'https://arena.example'},setTimeout:()=>{},setInterval:()=>{},console};
 vm.runInNewContext(fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8'),context);
 await root.BXHEnchantmentUI.refresh('BXH-ABCD','match1');
 assert.equal(sent[0].kind,'bxh-enchantment-init');
 assert.equal(sent[0].state.cards.B,null);
 await listeners.message({origin:'https://arena.example',source:frame.contentWindow,
  data:{kind:'bxh-enchantment-draw',code:'BXH-ABCD',matchId:'match1',round:1}});
 assert.equal(calls.at(-1).action,'draw');
 assert.equal(calls.at(-1).version,2);
 assert.equal(calls.at(-1).round,1);
 assert.equal(sent.at(-1).state.cards.A,'double_spin');
 assert.equal(sent.at(-1).state.cards.B,null);
});

test('referee action submits the raw outcome; server remains the scoring authority',async()=>{
 const calls=[],listeners={};
 const state={round:2,phase:'ready-to-score',scores:{A:2,B:0},faults:{A:0,B:0},
  drawn:{A:true,B:true},cards:{A:'double_burst',B:'weaken_spin'}};
 const slot={innerHTML:''},panel={dataset:{code:'BXH-ABCD',matchId:'match1'},querySelector:()=>slot};
 const root={BXHEnchantmentScore:score,engagementService:{enchantment:async payload=>{
  calls.push(payload);return {version:payload.action==='score'?8:7,state};
 }},addEventListener:(event,fn)=>listeners[event]=fn};
 const document={querySelectorAll:selector=>selector==='[data-enchantment-referee]'?[panel]:[],
  addEventListener:(event,fn)=>listeners[event]=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8'),
  {window:root,document,location:{origin:'https://arena.example'},setTimeout:()=>{},setInterval:()=>{},console});
 await root.BXHEnchantmentUI.refresh('BXH-ABCD','match1');
 assert.match(slot.innerHTML,/爆裂 2 → 4/);
 const button={dataset:{enchantmentAction:'score',code:'BXH-ABCD',matchId:'match1',side:'A',type:'burst'}};
 listeners.click({target:{closest:()=>button},preventDefault(){},stopPropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.find(x=>x.action==='score').winner,'A');
 assert.equal(calls.find(x=>x.action==='score').type,'burst');
 assert.equal('points' in calls.find(x=>x.action==='score'),false);
});

test('first fault warning exposes undo before a point is awarded',async()=>{
 const listeners={},slot={innerHTML:''};
 const panel={dataset:{code:'BXH-ABCD',matchId:'match1'},querySelector:()=>slot};
 const root={BXHEnchantmentScore:score,engagementService:{enchantment:async()=>({version:5,state:{
  round:1,phase:'ready-to-score',scores:{A:0,B:0},faults:{A:1,B:0},drawn:{A:true,B:true},
  cards:{A:'seal',B:'double_burst'}}})},addEventListener:(event,fn)=>listeners[event]=fn};
 const document={querySelectorAll:selector=>selector==='[data-enchantment-referee]'?[panel]:[],
  addEventListener:(event,fn)=>listeners[event]=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8'),
  {window:root,document,location:{origin:'https://arena.example'},setTimeout:()=>{},setInterval:()=>{},console});
 await root.BXHEnchantmentUI.refresh('BXH-ABCD','match1');
 assert.match(slot.innerHTML,/class="ref-vs-arena standard"/);
 assert.match(slot.innerHTML,/data-side="A"[^>]*>失誤 1\/2/);
 assert.match(slot.innerHTML,/撤回上一筆失誤/);
});

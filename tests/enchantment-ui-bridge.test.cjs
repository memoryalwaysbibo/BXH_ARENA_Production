'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const score=require('../enchantment-score-core.js');

test('player phone hides the opponent card until both players draw',async()=>{
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
 assert.equal(sent.at(-1).state.cards.B,'double_burst');
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

test('a referee restart after takeover carries the current dispatch revision',async()=>{
 const calls=[],listeners={},slot={innerHTML:''};
 const panel={dataset:{code:'BXH-ABCD',matchId:'match1',dispatchRevision:'2'},querySelector:()=>slot};
 const root={BXHEnchantmentScore:score,engagementService:{enchantment:async payload=>{
  calls.push(payload);return {version:8,state:{round:1,phase:'drawing',scores:{A:2,B:0},drawn:{A:false,B:false},cards:{A:null,B:null}}};
 }},addEventListener:(event,fn)=>listeners[event]=fn};
 const document={querySelectorAll:selector=>selector==='[data-enchantment-referee]'?[panel]:[],
  addEventListener:(event,fn)=>listeners[event]=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8'),
  {window:root,document,location:{origin:'https://arena.example'},setTimeout:()=>{},setInterval:()=>{},console});
 const button={dataset:{enchantmentAction:'start',code:'BXH-ABCD',matchId:'match1'}};
 listeners.click({target:{closest:()=>button},preventDefault(){},stopPropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.find(x=>x.action==='start').dispatchRevision,2);
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


test('winner confirmation opens only as a local modal and submits its bound match version',async()=>{
 const calls=[],listeners={};let modal=null;
 const state={round:3,phase:'awaiting-result',scores:{A:5,B:3},faults:{A:0,B:0},drawn:{A:true,B:true},cards:{A:'seal',B:'seal'}};
 const slot={innerHTML:''},title={textContent:''};
 const panel={dataset:{code:'BXH-ABCD',matchId:'match1'},querySelector:sel=>sel==='[data-enchantment-status]'?slot:title};
 const makeOverlay=()=>({dataset:{},style:{},innerHTML:'',isConnected:true,setAttribute(){},remove(){if(modal===this)modal=null;}});
 const document={
  body:{append(el){modal=el;}},
  createElement:tag=>makeOverlay(),
  querySelector:sel=>sel==='[data-enchantment-confirm-modal]'?modal:null,
  querySelectorAll:selector=>selector==='[data-enchantment-referee]'?[panel]:selector==='[data-enchantment-confirm-modal]'&&modal?[modal]:[],
  addEventListener:(event,fn)=>listeners[event]=fn
 };
 const root={BXHEnchantmentScore:score,engagementService:{enchantment:async payload=>{
  calls.push(payload);
  if(payload.action==='confirm')return {version:10,state:{...state,phase:'completed'},completion:{winnerId:'a'}};
  return {version:9,state};
 }},addEventListener:(event,fn)=>listeners[event]=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8'),
  {window:root,document,location:{origin:'https://arena.example'},playerName:id=>id==='a'?'黑爸':'小宇',setTimeout:()=>{},setInterval:()=>{},console});
 root.BXHEnchantmentUI.referee({id:'match1',a:{playerId:'a'},b:{playerId:'b'}},'BXH-ABCD',false);
 await root.BXHEnchantmentUI.refresh('BXH-ABCD','match1');
 const confirmButton={dataset:{enchantmentAction:'confirm',code:'BXH-ABCD',matchId:'match1'}};
 listeners.click({target:{closest:sel=>sel==='[data-enchantment-action]'?confirmButton:null},preventDefault(){},stopPropagation(){}});
 assert.ok(modal,'local modal should be created only after this device clicks confirm');
 assert.match(modal.innerHTML,/黑爸/);assert.match(modal.innerHTML,/5/);assert.match(modal.innerHTML,/3/);
 assert.equal(calls.filter(x=>x.action==='confirm').length,0,'opening modal must not confirm on the server');
 const submit={closest:sel=>sel==='[data-enchantment-confirm-modal]'?modal:null};
 listeners.click({target:{closest:sel=>sel==='[data-enchantment-confirm-submit]'?submit:null},preventDefault(){},stopPropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));
 const confirmCall=calls.find(x=>x.action==='confirm');
 assert.equal(confirmCall.version,9);
 assert.equal(confirmCall.code,'BXH-ABCD');assert.equal(confirmCall.matchId,'match1');
 assert.equal(modal,null,'successful confirmation closes the local modal');
});

test('enchantment result confirmation no longer uses browser-global confirm',()=>{
 const source=fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8');
 assert.equal(source.includes('window.confirm('),false);
 assert.match(source,/data-enchantment-confirm-modal/);
 assert.match(source,/data-enchantment-confirm-winner/);
 assert.match(source,/確認勝負/);
});


test('player AUTO draw preference is local, off by default, and automatically draws only own side',async()=>{
 const calls=[],sent=[],listeners={};let stored='1';
 const state={round:4,phase:'drawing',scores:{A:2,B:1},faults:{A:0,B:0},drawn:{A:false,B:false},cards:{A:null,B:null}};
 const frame={dataset:{code:'BXH-ABCD',matchId:'match1',side:'A'},contentWindow:{postMessage:x=>sent.push(x)},closest:()=>null};
 const root={BXHEnchantmentScore:score,engagementService:{enchantment:async payload=>{
  calls.push(payload);
  if(payload.action==='draw')return {version:8,state:{...state,phase:'drawing',drawn:{A:true,B:false},cards:{A:'double_spin',B:null}}};
  return {version:7,state};
 }},addEventListener:(event,fn)=>listeners[event]=fn};
 const document={querySelectorAll:selector=>selector==='iframe[data-enchantment-player]'?[frame]:[],
  addEventListener:(event,fn)=>listeners[event]=fn};
 const localStorage={getItem:key=>key==='bxh-enchantment-player-auto-draw'?stored:null,setItem:(key,value)=>{if(key==='bxh-enchantment-player-auto-draw')stored=value;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8'),
  {window:root,document,localStorage,location:{origin:'https://arena.example'},setTimeout:(fn)=>fn(),setInterval:()=>{},console});
 await root.BXHEnchantmentUI.refresh('BXH-ABCD','match1');
 await new Promise(resolve=>setImmediate(resolve));
 const draw=calls.find(x=>x.action==='draw');
 assert.ok(draw,'AUTO ON should submit a draw when the own side is eligible');
 assert.equal(draw.round,4);assert.equal(draw.version,7);
 assert.equal('target' in draw,false);assert.equal('side' in draw,false);
 assert.equal(sent.at(-1).state.drawn.A,true);assert.equal(sent.at(-1).state.drawn.B,false);
});

test('player AUTO draw toggle is present and persisted independently from referee auto reveal',()=>{
 const source=fs.readFileSync(require.resolve('../enchantment-ui.js'),'utf8');
 assert.match(source,/AUTO_DRAW_KEY='bxh-enchantment-player-auto-draw'/);
 assert.match(source,/data-enchantment-auto-draw/);
 assert.match(source,/AUTO 抽卡/);
 assert.match(source,/saveAutoDraw\(enabled\)/);
 assert.match(source,/action:'draw',code,matchId:id,version:item\.version,round:state\.round/);
 assert.match(source,/setAutoReveal/);
});

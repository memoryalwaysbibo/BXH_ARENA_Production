'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'referee-score-v2.css'),'utf8');

assert(html.includes('fault:1'),'fault scoring type must be worth exactly 1 point');
assert(html.includes('fault:"失誤判分＋1分"'),'fault score label missing');
assert(html.includes('data-action="fault"'),'referee fault button missing');
assert(html.includes('失誤</span><b>${count}/2</b>'),'fault counter must display 0/2 or 1/2');
assert((html.match(/"score","fault","undo-score"/g)||[]).length>=5,'fault action must share score permissions and live-operator routing');
assert(html.includes('const faultsBefore=roundFaultState(m);'),'normal round result must snapshot faults before scoring');
assert(html.includes('clearRoundFaultState(m);'),'normal round result must reset current-round faults');
assert(html.includes('setRoundFaultState(m,last.faultsBefore||{A:0,B:0,order:[]});'),'undo score must restore pre-result faults');
assert(html.includes('if(faults.order.length){'),'undo must handle unresolved first faults before score history');
assert(html.includes('clearRoundFaultState(remoteMatch); remoteMatch.hunterData=null'),'rematch must clear remote fault state');
assert(html.includes('clearRoundFaultState(m);\n  const hunterLedger=validateHunterRoundLedger(m);'),'completion must clear current-round faults');
assert(html.includes('if(m.scoreA>=4 && m.scoreA>m.scoreB) return "A";'),'first-to-4 win condition changed unexpectedly');
assert(html.includes('if(m.scoreB>=4 && m.scoreB>m.scoreA) return "B";'),'first-to-4 win condition changed unexpectedly');
assert(css.includes('.referee-workstation .fault-btn'),'fault button styling missing');
assert(css.includes('.fault-btn.is-active'),'first-fault active state styling missing');
assert(html.includes('referee-score-v2.css?v=14.2.38-round-faults'),'fault-control stylesheet must be cache-busted');

const start=html.indexOf('function normalizeRoundFaultState');
const end=html.indexOf('function addScore',start);
assert(start>=0&&end>start,'fault core helper block missing');
const helperSource=html.slice(start,end);
const context={
  console,
  checkWinnerSide:()=>null,
  createHunterRoundEvent(match,side,type,points,at,meta){
    return Object.assign({eventId:'e'+((match.log||[]).length+1),seq:(match.log||[]).length+1,side,type,points,t:at},meta||{});
  },
  POINT_LABELS:{spin:'旋轉勝利＋1分',knockout:'擊飛勝利＋2分',burst:'爆裂勝利＋2分',extreme:'極限勝利＋3分',fault:'失誤判分＋1分'}
};
vm.createContext(context);
vm.runInContext(helperSource,context);

const m={scoreA:0,scoreB:0,log:[]};
let r=context.applyFaultMutation(m,'A',1);
assert.equal(r.ok,true);
assert.equal(r.kind,'warning');
assert.equal(m.scoreA,0);assert.equal(m.scoreB,0);
assert.equal(m.roundFaults.A,1);assert.equal(m.roundFaults.B,0);
assert.equal(m.log.length,0,'first fault must not resolve a round');

r=context.applyFaultMutation(m,'B',2);
assert.equal(r.kind,'warning');
assert.deepEqual(Array.from(m.roundFaults.order),['A','B']);

r=context.applyFaultMutation(m,'A',3);
assert.equal(r.kind,'point');
assert.equal(r.recipient,'B');
assert.equal(m.scoreB,1,'second fault must give opponent exactly one point');
assert.equal(m.log.length,1);
assert.equal(m.log[0].type,'fault');
assert.equal(m.log[0].faultSide,'A');
assert.equal(m.log[0].points,1);
assert.equal(m.log[0].faultsBefore.A,1);
assert.equal(m.log[0].faultsBefore.B,1);
assert.equal(m.roundFaults.A,0);assert.equal(m.roundFaults.B,0);
assert.equal(m.roundFaults.order.length,0,'faults must reset when the round resolves');

console.log('PASS referee per-round two-fault scoring');

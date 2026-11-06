'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('modules/main-app/core.js','utf8');

function extractFunction(name){
  const start = html.indexOf('function '+name+'(');
  if(start<0) throw new Error('Missing function '+name);
  const brace = html.indexOf('{',start);
  let depth=0, quote=null, escape=false;
  for(let i=brace;i<html.length;i++){
    const ch=html[i];
    if(quote){
      if(escape){escape=false;continue;}
      if(ch==='\\'){escape=true;continue;}
      if(ch===quote)quote=null;
      continue;
    }
    if(ch==='"'||ch==="'"||ch.charCodeAt(0)===96){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'){
      depth--;
      if(depth===0)return html.slice(start,i+1);
    }
  }
  throw new Error('Unclosed function '+name);
}

const source=[
  extractFunction('singleElimBronzeGatePhase'),
  extractFunction('singleElimBronzeBeforeFinalBlocked')
].join('\n');

const ctx={};
vm.createContext(ctx);
vm.runInContext(source,ctx);

function scenario(opts={}){
  const bronzeCompleted=opts.bronzeCompleted===true;
  const bronzePresent=opts.bronzePresent!==false;
  const bronzeEnabled=opts.bronzeEnabled!==false;
  const matches=[
    {id:'SF1',bracket:'SE',round:0,isBye:false,completed:true,winnerId:'A',loserId:'C'},
    {id:'SF2',bracket:'SE',round:0,isBye:false,completed:true,winnerId:'B',loserId:'D'},
    {id:'F',bracket:'SE',round:1,isBye:false,completed:false,a:{playerId:'A'},b:{playerId:'B'}}
  ];
  if(bronzePresent)matches.push({
    id:'BZ',bracket:'BZ',round:0,isBye:false,completed:bronzeCompleted,
    a:{playerId:'C'},b:{playerId:'D'},
    winnerId:bronzeCompleted?'C':null,loserId:bronzeCompleted?'D':null
  });
  return {matches,meta:{formatType:'single',bronzeMatch:bronzeEnabled}};
}

{
  const {matches,meta}=scenario();
  const gate=ctx.singleElimBronzeGatePhase(matches,meta);
  assert.equal(gate.kind,'bronze');
  assert.equal(gate.matchId,'BZ');
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='F'),matches,meta),false);
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='BZ'),matches,meta),false);
}

{
  const {matches,meta}=scenario({bronzePresent:false});
  const gate=ctx.singleElimBronzeGatePhase(matches,meta);
  assert.equal(gate.kind,'bronze-pending');
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='F'),matches,meta),false);
}

{
  const {matches,meta}=scenario({bronzeCompleted:true});
  assert.equal(ctx.singleElimBronzeGatePhase(matches,meta),null);
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='F'),matches,meta),false);
}

{
  const {matches,meta}=scenario({bronzeEnabled:false});
  assert.equal(ctx.singleElimBronzeGatePhase(matches,meta),null);
}

// Exercise real automatic queues and both dispatch implementations before bronze finishes.
for(const name of ['getMatch','orderedMatches','refereeMatches','stationExecutionQueue',
  'activeSingleElimSchedulePhase','isInActiveSingleElimPhase','singleElimScheduleTier',
  'canManualAssignMatch','canCourtSwapSource','canCourtSwapTarget','clearCourtAssignmentRefs',
  'applyManualCourtAssign','applyCourtSwapMutation']){
  vm.runInContext(extractFunction(name),ctx);
}
const utils=require('../referee-seats/functions/engine/match-utils.cjs');
Object.assign(ctx,{window:{},matchHasDecisionData:utils.matchHasDecisionData,courtKey:utils.courtKey});
function dispatchScenario(){
  const st=scenario();st.meta.stations=1;
  st.bronzeMatchId='BZ';
  st.matches.find(m=>m.id==='F').indexInRound=0;
  for(const m of st.matches){m.station=1;m.seq=m.id==='BZ'?2.5:m.id==='F'?3:0;m.status=m.completed?'completed':'pending';}
  st.courtAssignments={court1:{currentMatchId:'BZ',nextMatchId:'F'}};
  return st;
}
{
  const st=dispatchScenario();ctx.state=st;
  assert.deepEqual(Array.from(ctx.stationExecutionQueue(1),m=>m.id),['BZ','F']);
  assert.equal(ctx.canManualAssignMatch(st.matches.find(m=>m.id==='F'),st),true);
  assert.equal(ctx.applyCourtSwapMutation(st,'BZ','F').ok,true);
  assert.equal(ctx.stationExecutionQueue(1)[0].id,'F');
}
const {createEngine}=require('../referee-seats/functions/engine/index.cjs');
for(const server of [false,true]){
  const st=dispatchScenario();ctx.state=st;
  const api=server?createEngine(st,{name:'test'},1000,'finals-order'):ctx;
  assert.equal(api.singleElimBronzeBeforeFinalBlocked(st.matches.find(m=>m.id==='F'),st.matches,st.meta),false);
  assert.equal(api.applyManualCourtAssign(st,'F',1).ok,true);
  assert.equal(st.courtAssignments.court1.currentMatchId,'F');
  if(server){
    // Rebuilds must preserve manual priority across subsequent score/dispatch commands.
    st.players=['A','B','C','D'].map(id=>({id}));st.bracketSize=4;st.startedAt=1;
    api.rebuildPropagationForState(st);
    assert.equal(st.courtAssignments.court1.currentMatchId,'F');
    assert.equal(st.matches.find(m=>m.id==='BZ').completed,false);
    const final=st.matches.find(m=>m.id==='F');
    Object.assign(final,{completed:true,winnerId:'A',loserId:'B',status:'completed'});
    api.rebuildPropagationForState(st);
    assert.equal(st.championId,'A');assert.equal(st.runnerUpId,'B');
    assert.equal(st.thirdId,null);assert.equal(st.fourthId,null);
    assert.equal(st.courtAssignments.court1.currentMatchId,'BZ');
    Object.assign(st.matches.find(m=>m.id==='BZ'),{completed:true,winnerId:'C',loserId:'D',status:'completed'});
    api.rebuildPropagationForState(st);
    assert.equal(st.thirdId,'C');assert.equal(st.fourthId,'D');
  }
  const final=st.matches.find(m=>m.id==='F');final.scoreA=1;
  assert.equal(api.applyManualCourtAssign(st,'F',1).ok,false,'scored match remains protected');
}
console.log('PASS bronze queue preference, manual override and trusted engine parity');

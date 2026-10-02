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
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='F'),matches,meta),true);
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='BZ'),matches,meta),false);
}

{
  const {matches,meta}=scenario({bronzePresent:false});
  const gate=ctx.singleElimBronzeGatePhase(matches,meta);
  assert.equal(gate.kind,'bronze-pending');
  assert.equal(ctx.singleElimBronzeBeforeFinalBlocked(matches.find(m=>m.id==='F'),matches,meta),true);
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

for(const required of [
  '季殿尚未完成，冠亞必須等待季殿結束後才能開始。',
  '季殿尚未完成，冠亞不能進入預備或開賽狀態。',
  'function canManualAssignMatch(m,st=state)',
  'function canCourtSwapTarget(m,sourceMatch,st=state)',
  'bronze.seq=bronzeSeq;'
]){
  assert.ok(html.includes(required),'Missing finals hard-gate invariant: '+required);
}

console.log('PASS bronze-before-final hard gate and release semantics');

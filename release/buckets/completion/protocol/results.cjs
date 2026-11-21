'use strict';
const {createHash}=require('node:crypto');
function fail(reason){throw Error(reason);}
function stable(x){if(Array.isArray(x))return x.map(stable);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])]));return x;}
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const playerUid=()=>''; // General completion never credits or resolves player accounts.
function validateResults(state){
 if(!Array.isArray(state.players)||!Array.isArray(state.matches)||!state.matches.length)fail('bucket-invalid-results');
 if(state.players.some(p=>!p||typeof p!=='object'||Array.isArray(p)))fail('bucket-invalid-results');
 const reserved=['__proto__','constructor','prototype'];
 const players=new Set(state.players.map(p=>p.id));if(state.players.some(p=>typeof p.id!=='string'||!p.id||reserved.includes(p.id))||players.size!==state.players.length||players.size<2)fail('bucket-invalid-results');
 const linked=state.players.map(playerUid).filter(Boolean);if(new Set(linked).size!==linked.length)fail('bucket-duplicate-account');
 if(linked.some(id=>!/^[-A-Za-z0-9_]{1,128}$/.test(id)||reserved.includes(id)))fail('bucket-player-identity');
 const matches=new Set();
 for(const m of state.matches){
  if(!m||typeof m.id!=='string'||!m.id||matches.has(m.id))fail('bucket-invalid-results');matches.add(m.id);
  if(!['SE','BZ'].includes(m.bracket)||!Number.isSafeInteger(m.round)||m.round<0)fail('bucket-invalid-results');
  if(m.isBye){const sides=[m.a?.playerId,m.b?.playerId].filter(Boolean);if(sides.length>1||sides.some(id=>!players.has(id))||m.winnerId!==(sides[0]||null)||m.loserId)fail('bucket-invalid-results');continue;}
  const a=m.a?.playerId,b=m.b?.playerId;
  if(!players.has(a)||!players.has(b)||a===b)fail('bucket-invalid-results');
  if(m.completed!==true)fail('bucket-not-decided');
  if(![a,b].includes(m.winnerId)||m.loserId!==(m.winnerId===a?b:a)||![m.scoreA,m.scoreB].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=6))fail('bucket-invalid-results');
 }
 const se=state.matches.filter(m=>m.bracket==='SE'),max=Math.max(...se.map(m=>Number(m.round))),finals=se.filter(m=>Number(m.round)===max);
 if(!Number.isSafeInteger(max)||max<0||max>8||finals.length!==1||finals[0].isBye)fail('bucket-invalid-results');
 for(let round=0;round<=max;round++){
  const rows=se.filter(m=>Number(m.round)===round),count=2**(max-round);
  if(rows.length!==count||new Set(rows.map(m=>m.indexInRound)).size!==count||rows.some(m=>!Number.isSafeInteger(m.indexInRound)||m.indexInRound<0||m.indexInRound>=count||m.completed!==true))fail('bucket-invalid-results');
  if(round>0)for(const m of rows){const feeders=se.filter(p=>Number(p.round)===round-1&&[m.indexInRound*2,m.indexInRound*2+1].includes(p.indexInRound));const expected=feeders.map(p=>p.winnerId||null).sort();if(digest(expected)!==digest([m.a?.playerId||null,m.b?.playerId||null].sort()))fail('bucket-invalid-results');}
 }
 state.championId=finals[0].winnerId;state.runnerUpId=finals[0].loserId;
 const bronzeRows=state.matches.filter(m=>m.bracket==='BZ');
 if(state.meta.bronzeMatch){
  const bronze=state.matches.find(m=>m.id===state.bronzeMatchId),semis=se.filter(m=>Number(m.round)===max-1);
  if(bronzeRows.length!==1||!bronze||bronze.bracket!=='BZ'||semis.length!==2||new Set(semis.map(m=>m.loserId)).size!==2||![bronze.a.playerId,bronze.b.playerId].every(id=>semis.some(m=>m.loserId===id)))fail('bucket-invalid-results');
  state.thirdId=bronze.winnerId;state.fourthId=bronze.loserId;
 }else {if(bronzeRows.length)fail('bucket-invalid-results');state.thirdId=null;state.fourthId=null;}
 return state;
}
module.exports={validateResults};

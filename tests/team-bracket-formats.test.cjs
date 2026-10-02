'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const source=html.slice(html.indexOf('function eligibleBracketTeams(){'),html.indexOf('/* ==== dispatcher: generate bracket ==== */'));
assert(source.startsWith('function eligibleBracketTeams(){'));
const make=new Function('state','shuffle','nextPow2','seedOrder','uid','syncMatchStatuses','rebuildCourtAssignments','canOperateCurrentTournament','showToast',source+';return {generateTeamBracket};');
let counter=0;
function draw(fmt,count){
  const state={meta:{battleMode:'team',formatType:fmt,teamSize:3,stations:2},teams:[],players:[],matches:[]};
  for(let i=0;i<count;i++){
    const ids=[0,1,2].map(j=>'p'+i+'_'+j);
    state.teams.push({id:'t'+i,memberPlayerIds:ids});
    state.players.push(...ids.map(id=>({id,checkedIn:true})));
  }
  const seedOrder=n=>{let result=[1];for(let size=2;size<=n;size*=2)result=result.flatMap(x=>[x,size+1-x]);return result;};
  const api=make(state,x=>x,n=>2**Math.ceil(Math.log2(n)),seedOrder,()=> 'tm'+(++counter),()=>{},()=>{},()=>true,()=>{});
  assert(api.generateTeamBracket());
  return state;
}
for(const count of [2,3,5,8]){
  const rr=draw('roundrobin',count);
  assert.equal(rr.matches.length,count*(count-1)/2);
  const pairings=new Set(rr.matches.map(m=>m.teamIds.slice().sort().join(':')));
  assert.equal(pairings.size,rr.matches.length);
  assert(rr.matches.every(m=>m.teamIds.every(Boolean)&&m.bracket==='RR'));
  const dbl=draw('double',count);
  assert(dbl.matches.some(m=>m.bracket==='WB'));
  assert(dbl.matches.some(m=>m.bracket==='LB'));
  assert.equal(dbl.matches.filter(m=>m.bracket==='GF').length,1);
  assert.equal(dbl.matches.filter(m=>m.bracket==='WB'&&m.round===0&&m.isBye).length,dbl.bracketSize-count);
}
console.log('PASS team format pairings and byes');

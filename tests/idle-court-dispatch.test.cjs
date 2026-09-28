const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
function fn(name,next){const start=src.indexOf('function '+name+'(');assert(start>=0,name);const end=src.indexOf('\n'+next,start);assert(end>start,name);return src.slice(start,end);}
const sandbox={Date,Number,Object,Set,Array,String,Math,
 courtKey:n=>'court'+n,
 activeSingleElimSchedulePhase:()=>null,
 isInActiveSingleElimPhase:()=>true,
 matchHasDecisionData:m=>!!(m.completed||m.scoreA||m.scoreB||m.log?.length),
 clearCourtAssignmentRefs:(st,ids)=>Object.values(st.courtAssignments).forEach(c=>{if(ids.includes(c.currentMatchId))c.currentMatchId=null;if(ids.includes(c.nextMatchId))c.nextMatchId=null;})};
vm.createContext(sandbox);
vm.runInContext(fn('idleCourtCandidates','function applyIdleCourtClaim')+'\n'+fn('applyIdleCourtClaim','async function claimIdleCourt'),sandbox);
const state=()=>({meta:{formatType:'double'},matches:[
 {id:'playing',station:1,status:'in_progress',a:{},b:{},seq:1},
 {id:'queued',station:1,status:'ready',a:{},b:{},seq:2,dispatchRevision:0},
 {id:'scored',station:1,status:'ready',a:{},b:{},seq:3,scoreA:1},
 {id:'waiting',station:2,status:'pending',a:{},b:null,seq:4}],
 courtAssignments:{court1:{currentMatchId:'playing',nextMatchId:'queued'},court2:{currentMatchId:null,nextMatchId:null}}});
const st=state();assert.deepEqual(Array.from(sandbox.idleCourtCandidates(st,2),m=>m.id),['queued']);
assert.equal(sandbox.applyIdleCourtClaim(st,'queued',2).ok,true);
assert.equal(st.matches[1].station,2);assert.equal(st.matches[1].dispatchRevision,1);
assert.equal(sandbox.applyIdleCourtClaim(st,'playing',2).ok,false);
const busy=state();busy.courtAssignments.court2.currentMatchId='waiting';
assert.equal(sandbox.applyIdleCourtClaim(busy,'queued',2).reason,'court-no-longer-idle');
console.log('PASS idle court claim and active-match guards');

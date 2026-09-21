const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const V=require('../ladder-v1.js');const {single}=require('./ladder-v1.cjs');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
// Regional sorting must not mutate the global legend qualification.
const ui=vm.createContext({window:{BXHLadderV1:V}});
vm.runInContext(html.slice(html.indexOf('const LADDER_TIERS ='),html.indexOf('function formatLadderDate('))+'\nvar ladderPublicData={players:Array.from({length:12},(_,i)=>({uid:"u"+i,seasonPoints:4000-i}))};',ui);
assert.equal(vm.runInContext('ladderDisplayTier(ladderPublicData.players[9])',ui),'BXH 傳說');
assert.equal(vm.runInContext('rankLadderRows([ladderPublicData.players[11]])[0].__rank',ui),1);
assert.equal(vm.runInContext('ladderDisplayTier(ladderPublicData.players[11])',ui),'宗師');
assert.equal(vm.runInContext('ladderPublicData.players[11].__rank',ui),undefined);
const defs=html.slice(html.indexOf('function deriveDoubleElimPlacements('),html.indexOf('\nfunction playerDerivedId('));
const rr=html.slice(html.indexOf('function computeRoundRobinStandings('),html.indexOf('\nfunction rebuildPropagationRoundRobin('));
const method=html.slice(html.indexOf('    async settleLadderTournament('),html.indexOf('    async adjustLadderPoints('));
async function setup(modify=()=>{},beforeTx=()=>{}){
 const s=single(16);s.cloudCode='TEST-LOCAL';s.meta.ladderMode='ranked';
 const data=new Map([['tournaments/TEST-LOCAL',{eventAuthority:'official',ladderMode:'ranked',data:JSON.stringify(s)}],
 ['ladderSystem/current',{currentSeason:'S1',startAt:Date.now()-1000,endAt:Date.now()+600000}]]);
 for(const p of s.players)data.set('users/'+p.accountUid,{active:true,role:'player'});
 modify(data,s);
 let writes=0;
 const snap=ref=>({exists:()=>data.has(ref),data:()=>structuredClone(data.get(ref))});
 const fx={doc:(_, ...parts)=>parts.join('/'),getDoc:async ref=>snap(ref),serverTimestamp:()=>123456,
  runTransaction:async(_,fn)=>{
   beforeTx(data);const pending=[];let wrote=false;
   const tx={get:async ref=>{assert.equal(wrote,false,'all reads before writes');return snap(ref)},
     set:(ref,value,opts)=>{wrote=true;pending.push([ref,value,opts?.merge])},
     update:(ref,value)=>{wrote=true;pending.push([ref,value,true])}};
   const r=await fn(tx);
   if(r.ok===false)assert.equal(pending.length,0,'failure must not commit partial awards');
   for(const [ref,value,merge]of pending){data.set(ref,merge?{...data.get(ref),...value}:value);writes++;}
   return r;
  }};
 const c=vm.createContext({window:{BXHLadderV1:V},cloudEnabled:true,authHandle:{currentUser:{uid:'admin'}},dbHandle:{},fx,
  cloudLadderTier:V.tier,cloudLadderTierIndex:t=>Math.max(0,V.tiers.findIndex(x=>x.name===t)),Date,console});
 vm.runInContext(rr+'\n'+defs+'\nvar api={'+method+'};',c);
 return {run:()=>c.api.settleLadderTournament('TEST-LOCAL',{participants:[{pointsEarned:99999}]}),data,get writes(){return writes}};
}
(async()=>{
 const t=await setup();let r=await t.run();assert.equal(r.ok,true);
 assert.equal(t.data.get('ladderPlayers/u0').seasonPoints,100);
 assert.equal(t.data.get('ladderPlayers/u0').rankTier,'白銀');
 assert.equal(t.data.get('ladderTransactions/TEST-LOCAL_u0').scoring.multiplier,1);
 assert.equal(t.data.get('tournaments/TEST-LOCAL').ladderResults[0].scoring.version,V.version);
 const writes=t.writes;r=await t.run();assert.equal(r.alreadyAwarded,true);assert.equal(t.writes,writes);
 for(const [field,value] of [['eventAuthority','community'],['testMode',true],['ladderMode','general']]){
  const x=await setup(db=>db.get('tournaments/TEST-LOCAL')[field]=value);assert.equal((await x.run()).ok,false);assert.equal(x.writes,0);
 }
 for(const [field,value] of [['rolloverInProgress',true],['startAt',Date.now()+600000],['endAt',Date.now()-600000]]){
  const x=await setup(db=>db.get('ladderSystem/current')[field]=value);assert.equal((await x.run()).ok,false);assert.equal(x.writes,0);
 }
 const stale=await setup(()=>{},db=>db.get('tournaments/TEST-LOCAL').data+=' ');
 assert.equal((await stale.run()).reason,'v1-state-changed');assert.equal(stale.writes,0);
 const mismatch=await setup(db=>db.set('ladderPlayers/u15',{currentSeason:'S0',seasonPoints:99}));
 assert.equal((await mismatch.run()).reason,'player-season-mismatch');assert.equal(mismatch.writes,0);
 const unfinished=await setup((db,s)=>{s.matches[0].completed=false;db.get('tournaments/TEST-LOCAL').data=JSON.stringify(s)});
 assert.equal((await unfinished.run()).reason,'v1-invalid-results');assert.equal(unfinished.writes,0);
 const duplicate=await setup((db,s)=>{s.players[1].accountUid=s.players[0].accountUid;db.get('tournaments/TEST-LOCAL').data=JSON.stringify(s)});
 assert.equal((await duplicate.run()).reason,'duplicate-player-account');assert.equal(duplicate.writes,0);
 const legacy=await setup(db=>Object.assign(db.get('tournaments/TEST-LOCAL'),{ladderPointsAwarded:true,ladderResults:[{pointsEarned:10}]}));
 const lr=await legacy.run();assert.equal(lr.alreadyAwarded,true);assert.equal(lr.results[0].pointsEarned,10);assert.equal(legacy.writes,0);
 const trial=await setup(db=>{
  Object.assign(db.get('ladderSystem/current'),{currentSeason:'S0',isTrialSeason:true});
  db.set('ladderPlayers/u0',{currentSeason:'S0',seasonPoints:5,careerPoints:55,highestRankTier:'黃金',totalEvents:2});
 });
 const tr=await trial.run();assert.equal(tr.ok,true);assert.equal(tr.seasonId,'S0');
 assert.equal(trial.data.get('ladderPlayers/u0').seasonPoints,105);
 assert.equal(trial.data.get('ladderPlayers/u0').careerPoints,55);
 assert.equal(trial.data.get('ladderPlayers/u0').highestRankTier,'黃金');
 assert.equal(trial.data.get('ladderPlayers/u0').totalEvents,3);
 assert.equal(trial.data.get('ladderTransactions/TEST-LOCAL_u0').isTrialSeason,true);
 assert.equal(trial.data.get('ladderTransactions/TEST-LOCAL_u0').countsTowardCareer,false);
 assert.equal(trial.data.get('tournaments/TEST-LOCAL').ladderTrialSeason,true);
 console.log('PASS saved-state scoring, S0 career isolation, metadata, retries, legacy preservation, season/auth-mode gates, stale/conflicting data and atomic failure');
})().catch(e=>{console.error(e);process.exitCode=1});

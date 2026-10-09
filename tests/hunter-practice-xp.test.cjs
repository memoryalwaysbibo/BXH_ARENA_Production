'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {memory}=require('./helpers/arena-pk-memory.cjs'),{createService}=require('../hunter-clash/arena/service.cjs'),adapter=require('../hunter-clash/arena/adapter.js'),xp=require('../hunter-clash/arena/practice-xp.cjs');
function fixture(){
 const m=memory();let now=Date.parse('2026-10-10T04:00:00+08:00'),seq=0;
 for(const uid of ['a','b','c','admin'])m.data.set('users/'+uid,{active:true,role:uid==='admin'?'super_admin':'player',displayName:uid});
 m.data.set('systemSettings/hunterClash',{enabled:true,environment:adapter.ENV,pairingTtlMs:120000,rules:{version:adapter.VERSION,targetScore:4}});
 const auth={app:{options:{projectId:m.db.projectId}},verifyIdToken:async uid=>({uid})},service=createService({db:m.db,auth,clock:()=>now});
 const call=(uid,op,input={})=>service.run(uid,op,{...input,...(!['getMyHistory','getChallenge'].includes(op)?{requestId:'xp'+(++seq)}:{})});
 return {...m,service,call,setTime:v=>now=Date.parse(v)};
}
async function ready(f,peer='b',count=1){
 const out=await f.call('a','createChallenge',{matchCount:count});let c=(await f.call(peer,'acceptCode',{pairingCode:out.pairingCode,expectedRevision:0})).challenge;
 for(const uid of ['a',peer])c=(await f.call(uid,'start',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;
 for(let n=0;n<count;n++){
  for(let r=0;r<2;r++)c=(await f.call('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:n%2?peer:'a',finish:'burst'})).challenge;
  if(n<count-1)c=(await f.call('a','nextGame',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;
 }
 c=(await f.call('a','confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})).challenge;
 return c;
}
async function finish(f,c,peer='b',requestId){return (await f.service.run(peer,'confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision,requestId:requestId||'finish_'+c.challengeId})).challenge;}
const history=async(f,uid='a')=>(await f.call(uid,'getMyHistory')).history;
test('only dual confirmation settles exact 5/2.5/0 XP; retry does not duplicate; wins and losses earn equally',async()=>{
 const f=fixture(),c=await ready(f,'b',10);assert.equal(f.data.has('arenaPKPlayers/a'),false);
 const result=await finish(f,c),h=await history(f);assert.equal(result.practiceXpByPlayer.a.xp,22.5);assert.equal(h.practiceXp.totalXp,22.5);
 assert.equal((await history(f,'b')).practiceXp.totalXp,22.5);
 assert.deepEqual(h.rows.map(r=>r.practiceXp.xp),[5,5,5,2.5,2.5,2.5,0,0,0,0]);
 assert.equal(h.practiceXp.remainingGames,0);assert.equal(h.total,10);
 assert.deepEqual(await finish(f,c),result);assert.equal((await history(f)).practiceXp.totalXp,22.5);
 await assert.rejects(f.call('b','confirmFinish',{challengeId:c.challengeId,expectedRevision:result.revision,resultRevision:c.resultRevision}),/terminal-state/);
});
test('daily limit spans opponents and rooms, peer quotas are independent, concurrent closing shares one counter',async()=>{
 const f=fixture();await finish(f,await ready(f,'b',6));await finish(f,await ready(f,'c',3),'c');
 const one=await ready(f,'c'),two=await ready(f,'c');const results=await Promise.all([finish(f,one,'c'),finish(f,two,'c')]);
 assert.deepEqual(results.map(c=>c.practiceXpByPlayer.a.xp),[2.5,0]);
 const h=await history(f);assert.equal(h.practiceXp.totalXp,40);assert.equal(h.practiceXp.completedToday,11);assert.equal(h.total,11);
 assert.equal(results[1].practiceXpByPlayer.c.xp,2.5);assert.equal(h.rows.at(-1).practiceXp.reason,'daily-limit');
});
test('Taiwan midnight resets quotas on closing day; unfinished prior-day room waits for dual confirmation',async()=>{
 const f=fixture();f.setTime('2026-10-10T23:59:50+08:00');await finish(f,await ready(f,'b',6));const c=await ready(f);
 f.setTime('2026-10-11T00:00:00+08:00');const done=await finish(f,c);assert.equal(done.practiceXpByPlayer.a.xp,5);
 const h=await history(f);assert.equal(h.practiceXp.day,'2026-10-11');assert.equal(h.practiceXp.todayXp,5);assert.equal(h.practiceXp.remainingGames,9);assert.equal(h.practiceXp.totalXp,27.5);
});
test('old rooms never backfill; kill switch preserves XP and records; client cannot submit rewards',async()=>{
 const f=fixture(),old=await ready(f);delete f.data.get('arenaPKChallenges/'+old.challengeId).practiceXpPolicy;
 const legacy=await finish(f,old);assert.equal(legacy.practiceXpByPlayer.a.reason,'before-launch');assert.equal((await history(f)).practiceXp.completedToday,0);
 await finish(f,await ready(f));f.data.get('systemSettings/hunterClash').practiceXpEnabled=false;
 const disabled=await finish(f,await ready(f));assert.equal(disabled.practiceXpByPlayer.a.xp,0);assert.equal((await history(f)).practiceXp.totalXp,5);assert.equal((await history(f)).total,3);
 await assert.rejects(f.call('a','createChallenge',{practiceXpUnits:999}),/invalid-input/);
});
test('revocation atomically removes credited XP and tombstones without reopening daily quotas',async()=>{
 const f=fixture(),done=await finish(f,await ready(f,'b',10));
 const input={challengeId:done.challengeId,expectedRevision:done.revision,reason:'測試撤銷',requestId:'revoke'};
 await f.service.run('admin','revokeChallenge',input);await f.service.run('admin','revokeChallenge',input);
 const h=await history(f);assert.equal(h.total,0);assert.equal(h.practiceXp.totalXp,0);assert.equal(h.practiceXp.remainingGames,0);
 const again=await finish(f,await ready(f));assert.equal(again.practiceXpByPlayer.a.xp,0);assert.equal((await history(f)).total,1);
 assert.equal([...f.data.keys()].some(k=>/^(ladder|playerStats|mailbox|titles)/.test(k)),false);
});
test('100-game series stays atomic and fractional XP aggregates survive paging; corruption rolls back',async()=>{
 const f=fixture(),done=await finish(f,await ready(f,'b',100)),first=await history(f);
 assert.equal(first.total,100);assert.equal(first.practiceXp.totalXp,22.5);
 const tail=(await f.call('a','getMyHistory',{cursor:first.nextCursor,generation:first.generation})).history;
 assert.equal(adapter.adapt([...first.rows,...tail.rows],'a').length,100);
 const key='arenaPKPlayers/a/matches/'+done.challengeId+'_g001';f.data.get(key).practiceXp.units=NaN;
 await assert.rejects(f.call('admin','revokeChallenge',{challengeId:done.challengeId,expectedRevision:done.revision,reason:'bad'}),/ledger-xp-invalid/);
 assert.equal(f.data.get('arenaPKChallenges/'+done.challengeId).status,'completed');assert.equal(f.data.get('arenaPKPlayers/b').practiceXpUnits,45);
});
test('practice XP changes only displayed growth, leaves formal grade, strength and source records unchanged',()=>{
 const c=vm.createContext({window:{},console});for(const file of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+file+'.js','utf8'),c);
 const u=c.window.BXHHunterUtils,formal=u.hunterBuildGrowth([]),grade=u.hunterLicenseGrade({eligible:false},formal.level);
 const combined=u.hunterGrowthWithPractice(formal,52.5);assert.equal(combined.level,2);assert.equal(combined.xp,52.5);assert.equal(formal.xp,0);assert.equal(formal.level,1);
 assert.deepEqual(u.hunterLicenseGrade({eligible:false},formal.level),grade);assert.equal(combined.xpFromPractice,52.5);assert.throws(()=>u.hunterGrowthWithPractice(formal,2.2),/invalid-practice-xp/);
 assert.equal(xp.dayKey(Date.parse('2026-10-10T15:59:59Z')),'2026-10-10');assert.equal(xp.dayKey(Date.parse('2026-10-10T16:00:00Z')),'2026-10-11');
});

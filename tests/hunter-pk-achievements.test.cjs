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
const ach=require('../hunter-clash/arena/achievements.js');
test('dual-confirmed PK badges use independent daily and opponent caps, no legacy backfill or extra XP',async()=>{
 const f=fixture(),legacy=await ready(f);delete f.data.get('arenaPKChallenges/'+legacy.challengeId).pkAchievementPolicy;await finish(f,legacy);
 assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).matches,0);
 f.data.get('systemSettings/hunterClash').practiceXpEnabled=false;
 await finish(f,await ready(f,'b',7));await finish(f,await ready(f,'c',4),'c');
 const h=await history(f),s=ach.summarize(adapter.adapt(h.rows,'a'));
 assert.equal(h.practiceXp.totalXp,5);assert.equal(s.matches,9);assert.equal(s.opponents,2);assert.equal(s.badges[0].unlocked,true);assert.equal(s.badges[1].unlocked,false);
 const c=await ready(f,'c');assert.equal((await history(f)).total,12);await finish(f,c,'c');
 assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).matches,9);
 assert.equal(ach.summarize(adapter.adapt((await history(f,'c')).rows,'c')).matches,5);
});
test('revocation removes badge eligibility without reopening quotas, retry is idempotent; midnight resets',async()=>{
 const f=fixture(),c=await ready(f,'b',6),done=await finish(f,c);assert.deepEqual(await finish(f,c),done);
 assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).matches,6);
 const input={challengeId:done.challengeId,expectedRevision:done.revision,reason:'experiment',requestId:'revoke-badge'};
 await f.service.run('admin','revokeChallenge',input);await f.service.run('admin','revokeChallenge',input);
 assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).badges[0].unlocked,false);
 await finish(f,await ready(f));assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).matches,0);
 f.setTime('2026-10-11T00:00:00+08:00');await finish(f,await ready(f));assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).matches,1);
 const k=[...f.data.keys()].find(k=>k.includes('/matches/')&&f.data.get(k).completed&&f.data.get(k).pkAchievement?.counted);
 f.data.get(k).pkAchievement.day='2026-10-10';assert.throws(()=>adapter.record(f.data.get(k),'a'),/achievement-invalid/);
});
test('badge thresholds, distinct opponents, deduplication and same-day ordinals are exact',()=>{
 const rows=[];for(let d=0;d<10;d++)for(let n=1;n<=10;n++){
  const at=Date.parse('2026-10-'+String(10+d).padStart(2,'0')+'T12:00:00+08:00');
  rows.push({completed:true,analyzable:true,sourceType:'hunter-clash',eventCode:'pk'+d,matchId:'game'+n,opponent:{uid:'peer'+n%5},confirmedAt:at,pkAchievement:{version:ach.VERSION,day:xp.dayKey(at),dayOrdinal:n,opponentOrdinal:1,counted:true}});
 }
 assert.equal(ach.summarize(rows.slice(0,9)).badges[1].unlocked,false);assert.equal(ach.summarize(rows.slice(0,10)).badges[1].unlocked,true);
 assert.equal(ach.summarize(rows.slice(0,99)).badges[2].unlocked,false);const s=ach.summarize([...rows,...rows]);assert.equal(s.matches,100);assert.equal(s.opponents,5);assert(s.badges.every(b=>b.unlocked));
 assert.equal(ach.summarize(rows.map(r=>({...r,completed:false}))).matches,0);
});

test('invalid daily badge counters roll back settlement without awarding XP or history',async()=>{
 const f=fixture(),c=await ready(f);
 const path='arenaPKPlayers/a/achievementDays/2026-10-10';
 f.data.set(path,{version:ach.VERSION,uid:'a',day:'2026-10-10',total:0,opponents:{u_b:1}});
 await assert.rejects(finish(f,c),/ledger-achievement-invalid/);
 assert.equal(f.data.get('arenaPKChallenges/'+c.challengeId).status,'final_pending');
 assert.equal((await history(f)).total,0);assert.equal((await history(f)).practiceXp.totalXp,0);
 f.data.delete(path);await finish(f,c);
 assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).matches,1);
});

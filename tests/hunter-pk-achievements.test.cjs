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
async function ready(f,peer='b',count=1,plans){
 const out=await f.call('a','createChallenge',{matchCount:count});let c=(await f.call(peer,'acceptCode',{pairingCode:out.pairingCode,expectedRevision:0})).challenge;
 for(const uid of ['a',peer])c=(await f.call(uid,'start',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;
 for(let n=0;n<count;n++){
  for(const round of plans?.[n]||Array.from({length:2},()=>({winnerUid:n%2?peer:'a',finish:'burst'})))c=(await f.call('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,...round})).challenge;
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
 assert.equal(h.practiceXp.totalXp,5);assert.equal(s.matches,9);assert.equal(s.wins,5);assert.equal(s.opponents,2);assert.equal(s.badges[0].unlocked,true);assert.equal(s.badges[1].unlocked,false);
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
  rows.push({isWin:true,completed:true,analyzable:true,sourceType:'hunter-clash',eventCode:'pk'+d,matchId:'game'+n,opponent:{uid:'peer'+n%5},confirmedAt:at,pkAchievement:{version:ach.VERSION,day:xp.dayKey(at),dayOrdinal:n,opponentOrdinal:1,counted:true}});
 }
 assert.equal(ach.summarize(rows.slice(0,9)).badges[1].unlocked,false);assert.equal(ach.summarize(rows.slice(0,10)).badges[1].unlocked,true);
 assert.equal(ach.summarize(rows.slice(0,99)).badges[2].unlocked,false);const s=ach.summarize([...rows,...rows]);assert.equal(s.matches,100);assert.equal(s.opponents,5);assert(s.badges.slice(0,6).every(b=>b.unlocked));assert.equal(s.badges.find(b=>b.id==='comeback').unlocked,false);
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

test('victory badges require eligible wins, dual confirmation and the correct player; revocation recalculates',async()=>{
 const f=fixture(),c=await ready(f);
 assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).wins,0);
 const done=await finish(f,c);
 const winner=ach.summarize(adapter.adapt((await history(f)).rows,'a'));
 const loser=ach.summarize(adapter.adapt((await history(f,'b')).rows,'b'));
 assert.equal(winner.wins,1);assert.equal(winner.badges.find(b=>b.id==='first_win').unlocked,true);
 assert.equal(loser.matches,1);assert.equal(loser.wins,0);assert.equal(loser.badges.find(b=>b.id==='first_win').unlocked,false);
 await f.service.run('admin','revokeChallenge',{challengeId:done.challengeId,expectedRevision:done.revision,reason:'experiment',requestId:'revoke-win'});
 const revoked=ach.summarize(adapter.adapt((await history(f)).rows,'a'));
 assert.equal(revoked.wins,0);assert.equal(revoked.badges.find(b=>b.id==='first_win').unlocked,false);
});
test('ten-win threshold uses qualified deduplicated wins rather than played matches',()=>{
 const at=Date.parse('2026-10-10T12:00:00+08:00');
 const row=n=>({completed:true,analyzable:true,sourceType:'hunter-clash',isWin:true,eventCode:'pk'+n,matchId:'game1',opponent:{uid:'peer'},confirmedAt:at,pkAchievement:{version:ach.VERSION,day:xp.dayKey(at),dayOrdinal:1,opponentOrdinal:1,counted:true}});
 const wins=Array.from({length:10},(_,i)=>row(i));
 const losses=Array.from({length:10},(_,i)=>({...row(i+10),isWin:false}));
 const badge=s=>s.badges.find(b=>b.id==='wins_10');
 const nine=ach.summarize([...wins.slice(0,9),...losses,...wins.slice(0,9)]);
 assert.equal(nine.matches,19);assert.equal(nine.wins,9);assert.equal(badge(nine).unlocked,false);
 const ten=ach.summarize([...wins,...losses,...wins]);assert.equal(ten.wins,10);assert.equal(badge(ten).unlocked,true);
 const excluded=[{...row(30),pkAchievement:undefined},{...row(31),completed:false},{...row(32),tombstone:true},{...row(33),analyzable:false},{...row(34),pkAchievement:{...row(34).pkAchievement,dayOrdinal:11,counted:false}},{...row(35),pkAchievement:{...row(35).pkAchievement,dayOrdinal:7,opponentOrdinal:7,counted:false}}];
 assert.equal(ach.summarize(excluded).wins,0);assert.equal(ach.summarize([...wins.slice(0,9),...excluded]).wins,9);
});

test('streaks follow settlement ordinals across rooms, pages and days; excluded losses break, wins do not add',()=>{
 const row=(day,n,isWin=true,counted=true)=>({completed:true,analyzable:true,sourceType:'hunter-clash',isWin,eventCode:'pk'+day+'_'+n,matchId:'game1',opponent:{uid:'peer'},confirmedAt:Date.parse(day+'T12:00:00+08:00'),pkAchievement:{version:ach.VERSION,day,dayOrdinal:n,opponentOrdinal:counted?1:7,counted}});
 const d='2026-10-10',e='2026-10-11';
 const first=[row(d,5),row(d,6),row(d,7,true,false)];
 assert.equal(ach.summarize(first.reverse()).bestStreak,2);assert.equal(ach.summarize([row(e,1),...first]).bestStreak,3);
 const loss=row(d,8,false,false),next=row(e,1);
 let s=ach.summarize([next,...first,loss]);assert.equal(s.bestStreak,2);assert.equal(s.currentStreak,1);assert.equal(s.badges.find(b=>b.id==='streak_3').unlocked,false);
 s=ach.summarize([row(e,3),next,row(e,2),loss,...first,...first]);assert.equal(s.bestStreak,3);assert.equal(s.currentStreak,3);assert.equal(s.badges.find(b=>b.id==='streak_3').unlocked,true);
 const gap={...row(e,2),analyzable:false};assert.equal(ach.summarize([...first,loss,next,gap,row(e,3)]).bestStreak,2);
 const legacy={...row(e,2),isWin:false,pkAchievement:undefined};assert.equal(ach.summarize([next,legacy,row(e,3),row(e,4)]).bestStreak,3);
});
test('a real three-room streak waits for both confirmations and is recalculated after revocation',async()=>{
 const f=fixture();await finish(f,await ready(f));await finish(f,await ready(f));
 const pending=await ready(f);assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).bestStreak,2);
 const done=await finish(f,pending);assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).bestStreak,3);
 assert.equal(ach.summarize(adapter.adapt((await history(f,'b')).rows,'b')).bestStreak,0);
 const input={challengeId:done.challengeId,expectedRevision:done.revision,reason:'experiment',requestId:'revoke-streak'};
 await f.service.run('admin','revokeChallenge',input);await f.service.run('admin','revokeChallenge',input);
 const s=ach.summarize(adapter.adapt((await history(f)).rows,'a'));assert.equal(s.bestStreak,2);assert.equal(s.badges.find(b=>b.id==='streak_3').unlocked,false);
});
test('comeback replays validated rounds: actual deficit and victory required; revoked evidence is removed',async()=>{
 const f=fixture(),plans=[[{winnerUid:'b',finish:'extreme'},{winnerUid:'a',finish:'knockout'},{winnerUid:'a',finish:'burst'}]];
 const pending=await ready(f,'b',1,plans);assert.equal(ach.summarize(adapter.adapt((await history(f)).rows,'a')).comebacks,0);
 const done=await finish(f,pending),rows=adapter.adapt((await history(f)).rows,'a');
 let s=ach.summarize([...rows,...rows]);assert.equal(s.comebacks,1);assert.equal(s.badges.find(b=>b.id==='comeback').unlocked,true);
 assert.equal(ach.summarize(adapter.adapt((await history(f,'b')).rows,'b')).comebacks,0);
 const tie=[{perspective:'for',points:2},{perspective:'against',points:2},{perspective:'for',points:2}];
 assert.equal(ach.summarize([{...rows[0],roundsPerspective:tie}]).comebacks,0);
 assert.equal(ach.summarize([{...rows[0],analyzable:false}]).comebacks,0);
 assert.equal(ach.summarize([{...rows[0],pkAchievement:{...rows[0].pkAchievement,dayOrdinal:7,opponentOrdinal:7,counted:false}}]).comebacks,0);
 await f.service.run('admin','revokeChallenge',{challengeId:done.challengeId,expectedRevision:done.revision,reason:'experiment',requestId:'revoke-comeback'});
 s=ach.summarize(adapter.adapt((await history(f)).rows,'a'));assert.equal(s.comebacks,0);assert.equal(s.badges.find(b=>b.id==='comeback').unlocked,false);
});

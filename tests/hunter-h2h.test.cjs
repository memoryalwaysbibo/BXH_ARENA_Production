'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
function setup(){
  const c=vm.createContext({window:{},console,Map,esc:String,render:()=>{},currentAuthUid:()=> 'owner',
    hunterOpponentIdentityCache:new Map(),hunterOpponentIdentityLoading:false,hunterOpponentIdentityGeneration:0,
    hunterH2HQuery:'',hunterH2HSelectedKey:'',hunterH2HSort:'matches-desc'});
  for(const file of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/'+file+'.js'),'utf8'),c);
  Object.assign(c,c.window.BXHHunterUtils);
  for(const name of ['hunterOpponentIdentityValue','hunterApplyOpponentIdentity','resolveHunterOpponentIdentities','hunterOpponentIdentityChip','hunterOpponentIdentityText','hunterH2HExclusionReason','hunterH2HExclusionNote','hunterBuildH2H','hunterH2HDirectoryView','hunterH2HPanelHtml']){
    const start=core.indexOf((name.startsWith('resolve')?'async ':'')+'function '+name+'(');
    assert(start>=0,name);
    const next=core.slice(start+1).search(/\n(?:async )?function /);
    vm.runInContext(core.slice(start,next<0?undefined:start+1+next),c);
  }
  return c;
}
function record(overrides={}){return {eventCode:'BXH-TEST',matchId:'m1',completedAt:10,analyzable:true,isWin:true,scoreFor:4,scoreAgainst:1,
  opponent:{localPlayerId:'1',playerId:'P1',name:'同名'},roundsPerspective:[
    {eventId:'1',type:'burst',perspective:'for',points:2},
    {eventId:'2',type:'knockout',perspective:'for',points:2},
    {eventId:'3',type:'spin',perspective:'against',points:1}],...overrides};}
test('H2H corrections and reversals use the same unique match set as career totals',()=>{
  const c=setup(),old=record(),corrected=record({confirmedAt:20,isWin:false});
  for(const rows of [[old,corrected],[corrected,old]]){
    const g=c.hunterBuildH2H(rows).list[0];assert.equal(g.matches,1);assert.equal(g.wins,0);assert.equal(g.losses,1);
    assert.equal(g.matches,c.hunterCareerSummary(rows).matches);
  }
  assert.equal(c.hunterBuildH2H([old,record({updatedAt:30,completed:false})]).list.length,0);
});
test('stable identities separate same-name players; only trusted ledgers contribute scores',()=>{
  const c=setup(),rows=[record(),record({matchId:'quick',resultMethod:'quick_decision',analyzable:false,isWin:false}),
    record({matchId:'broken',scoreFor:9}),record({matchId:'other',opponent:{playerId:'P2',name:'同名'}})];
  const h=c.hunterBuildH2H(rows);assert.equal(h.list.length,2);
  const g=h.list.find(g=>g.playerId==='P1');assert.equal(g.matches,3);assert.equal(g.scoredMatches,1);
  assert.equal(g.totalFor,4);assert.equal(g.totalAgainst,1);assert.equal(g.wins,2);assert.equal(g.losses,1);
  c.hunterH2HQuery='P2';assert.equal(c.hunterH2HDirectoryView(h).length,1);
  assert.equal(h.list.length,2);
});
test('empty H2H discloses loading, failure and event-only counts together after dedupe',()=>{
  const c=setup(),rows=['loading','unresolved','event-only'].map((scope,i)=>record({matchId:'m'+i,opponent:{localPlayerId:String(i)},opponentIdentity:{scope,playerId:null}}));
  const html=c.hunterH2HPanelHtml([...rows,rows[0]]);
  for(const text of ['0 位可識別對手','1 場正在辨識','1 場辨識失敗','1 場僅本場識別未納入'])assert(html.includes(text),text);
  assert.equal(c.hunterBuildH2H(rows).list.length,0);
});
test('retry shows loading for every match of that opponent, does not cache failure, and can recover',async()=>{
  const c=setup(),rows=[record({opponent:{localPlayerId:'1'}}),record({matchId:'m2',opponent:{localPlayerId:'1'}})];
  for(const r of rows)r.opponentIdentity={scope:'unresolved',playerId:null};
  let finish,calls=0;c.window.engagementService={playerCard:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}};
  const first=c.resolveHunterOpponentIdentities(rows);
  assert.equal(calls,1);assert.equal(c.hunterBuildH2H(rows).loading,2);
  finish({ok:false});await first;
  assert.equal(c.hunterBuildH2H(rows).unresolved,2);assert.equal(c.hunterOpponentIdentityCache.size,0);
  const retry=c.resolveHunterOpponentIdentities(rows);assert.equal(c.hunterBuildH2H(rows).loading,2);
  finish({ok:true,card:{playerId:'P1'}});await retry;
  assert.equal(c.hunterBuildH2H(rows).list[0].matches,2);
  assert.equal(c.hunterOpponentIdentityCache.size,1);
});
test('stale identity responses cannot apply after refresh or account change',async()=>{
  for(const invalidate of [c=>c.hunterOpponentIdentityGeneration++,c=>c.currentAuthUid=()=> 'another-owner']){
    const c=setup(),rows=[record({opponent:{localPlayerId:'1'}})];let finish;
    c.window.engagementService={playerCard:()=>new Promise(resolve=>{finish=resolve;})};
    const pending=c.resolveHunterOpponentIdentities(rows);invalidate(c);
    finish({ok:true,card:{playerId:'STALE'}});await pending;
    assert.equal(c.hunterOpponentIdentityCache.size,0);assert.equal(rows[0].opponentIdentity.playerId,null);
  }
});
test('successful lookup distinguishes unavailable card from a card missing stable identity',async()=>{
  for(const [result,reason] of [[{ok:true,card:null},'card-unavailable'],[{ok:true,card:{name:'對手'}},'missing-player-id']]){
    const c=setup(),rows=[record({opponent:{localPlayerId:'1'}})];
    c.window.engagementService={playerCard:async()=>result};await c.resolveHunterOpponentIdentities(rows);
    assert.equal(rows[0].opponentIdentity.reason,reason);
    assert.equal(c.hunterBuildH2H(rows).excluded,1);
    assert.equal(c.hunterCareerSummary(rows).matches,1);
    assert.equal(c.hunterCareerSummary(rows).wins,1);
    assert(c.hunterH2HExclusionNote(rows[0]).includes('本場勝敗與可信比分仍保留'));
  }
});
test('exclusion notes explain only known reasons; stable identity has no exclusion and loading is pending',()=>{
  const c=setup();assert.equal(c.hunterH2HExclusionNote(record()),'');
  const r=scope=>record({opponent:{localPlayerId:'1'},opponentIdentity:{scope,playerId:null}});
  assert(c.hunterH2HExclusionNote(r('unresolved')).includes('查詢失敗'));
  assert(c.hunterH2HExclusionNote(r('loading')).includes('H2H 辨識中：'));
  assert(!c.hunterH2HExclusionNote(r('loading')).includes('本場未納入'));
  assert(c.hunterH2HExclusionReason(record({opponent:{}})).includes('缺少對手的賽事或選手識別資料'));
  assert(!c.hunterH2HExclusionReason(r('event-only')).includes('名片未公開'));
  const hidden=r('event-only');hidden.opponentIdentity.reason='card-unavailable';
  assert(c.hunterH2HExclusionReason(hidden).includes('不代表對手沒有帳號'));
});
test('backend match identity takes priority over public cards and direct public IDs',async()=>{
  const c=setup(),key='H2H_'+'a'.repeat(64),rows=[record(),record({matchId:'m2',opponent:{localPlayerId:'2',name:'同名'}})];
  let calls=0;c.window.engagementService={hunterOpponentIdentity:async payload=>{calls++;assert(payload.matchId);return {ok:true,scope:'cross-event',opponentKey:key};},playerCard:()=>{throw Error('must-not-query-public-card');}};
  await c.resolveHunterOpponentIdentities(rows);assert.equal(calls,2);
  const h=c.hunterBuildH2H(rows);assert.equal(h.list.length,1);assert.equal(h.list[0].matches,2);
  assert.equal(h.list[0].publicPlayerId,null);
  assert(!c.hunterOpponentIdentityChip(rows[0]).includes(key));assert(c.hunterOpponentIdentityText(rows[0]).includes('確認玩家身分'));
  c.hunterH2HQuery=key;assert.equal(c.hunterH2HDirectoryView(h).length,0);
  c.hunterH2HQuery='';c.hunterH2HSelectedKey=key;assert.equal(c.hunterH2HDirectoryView(h).length,1);
});
test('backend exclusions retain reasons and do not invoke public-card lookup as a fallback',async()=>{
  const c=setup(),rows=[record()];c.window.engagementService={hunterOpponentIdentity:async()=>({ok:true,scope:'event-only',reason:'ambiguous-account-link'}),playerCard:()=>{throw Error('must-not-query-public-card');}};
  await c.resolveHunterOpponentIdentities(rows);assert.equal(c.hunterBuildH2H(rows).excluded,1);
  assert(c.hunterH2HExclusionNote(rows[0]).includes('互相衝突'));
});
test('malformed backend stable identities are retryable failures rather than cached identities',async()=>{
  const c=setup(),rows=[record()];c.window.engagementService={hunterOpponentIdentity:async()=>({ok:true,scope:'cross-event',opponentKey:'raw-uid'})};
  await c.resolveHunterOpponentIdentities(rows);assert.equal(c.hunterBuildH2H(rows).unresolved,1);
  assert.equal(c.hunterOpponentIdentityCache.size,0);
});
test('verified opponents appear after each batch while later identity requests are still pending',async()=>{
 const c=setup(),rows=Array.from({length:8},(_,i)=>record({matchId:'m'+i,opponent:{localPlayerId:'peer'+i}}));
 const waiting=[],progress=[];
 c.render=()=>progress.push(c.hunterBuildH2H(rows).list.length);
 c.window.engagementService={hunterOpponentIdentity:()=>new Promise(resolve=>waiting.push(resolve))};
 const task=c.resolveHunterOpponentIdentities(rows);assert.equal(waiting.length,4);
 waiting.slice(0,4).forEach((finish,i)=>finish({ok:true,scope:'cross-event',opponentKey:'H2H_'+String(i).repeat(64)}));
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(waiting.length,8);assert(progress.includes(4),'first verified batch must be rendered before the next batch finishes');
 waiting.slice(4).forEach((finish,i)=>finish({ok:true,scope:'cross-event',opponentKey:'H2H_'+String(i+4).repeat(64)}));
 await task;assert.equal(progress.at(-1),8);assert.equal(c.hunterOpponentIdentityLoading,false);
});
test('a render failure cannot suppress identity calls or permanently lock loading',async()=>{
 const c=setup(),rows=[record()];let calls=0;
 c.render=()=>{throw Error('render-fixture-failure');};c.console={warn:()=>{}};
 c.window.engagementService={hunterOpponentIdentity:async()=>{calls++;return {ok:true,scope:'cross-event',opponentKey:'H2H_'+'a'.repeat(64)};}};
 await c.resolveHunterOpponentIdentities(rows);
 assert.equal(calls,1);assert.equal(c.hunterBuildH2H(rows).list.length,1);assert.equal(c.hunterOpponentIdentityLoading,false);
});
test('cache-only resolution redraws new record objects instead of leaving the old zero count visible',async()=>{
 const c=setup(),rows=[record()];let renders=0;
 c.render=()=>renders++;c.hunterOpponentIdentityCache.set(c.hunterOpponentIdentityRef(rows[0]),{scope:'cross-event',playerId:'H2H_'+'a'.repeat(64),source:'verified-match'});
 c.window.engagementService={hunterOpponentIdentity:()=>{throw Error('must use cache');}};
 await c.resolveHunterOpponentIdentities(rows);assert.equal(renders,1);assert.equal(c.hunterBuildH2H(rows).list.length,1);
});
test('account changes stop dispatching later batches from the previous account',async()=>{
 const c=setup(),rows=Array.from({length:8},(_,i)=>record({matchId:'m'+i,opponent:{localPlayerId:'peer'+i}}));const waiting=[];
 let calls=0;c.window.engagementService={hunterOpponentIdentity:()=>++calls<=4?new Promise(resolve=>waiting.push(resolve)):Promise.resolve({ok:false})};
 const task=c.resolveHunterOpponentIdentities(rows);assert.equal(waiting.length,4);c.currentAuthUid=()=> 'different';
 waiting.forEach(finish=>finish({ok:true,scope:'cross-event',opponentKey:'H2H_'+'a'.repeat(64)}));
 await task;assert.equal(calls,4);assert.equal(c.hunterOpponentIdentityCache.size,0);
});

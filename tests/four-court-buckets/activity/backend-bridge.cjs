'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const P=require('./probe.cjs'),base=path.resolve(process.env.BXH_ACTIVITY_INTEGRATION_ROOT||'.integration');
const general=require(base+'/completion/tests/four-court-buckets/completion/fixture.cjs');
const {invoke:complete}=require(base+'/completion/tests/four-court-buckets/completion/probe.cjs');
const ranked=require(base+'/settlement/tests/four-court-buckets/settlement/probe.cjs');
(async()=>{let checks=0;
 for(const handler of ['event','backfill'])for(const route of ['general','ranked'])for(const courts of [4,6,12])for(const qr of [false,true]){
  const f=(route==='general'?general:ranked).fixture({courts,qr});
  if(route==='general')await complete(f);else await ranked.load(ranked.specs.find(s=>s.function==='settleLadderTournament'),true,f.m).invoke();
  const source=f.m.snapshot('tournaments/'+P.code),before=JSON.stringify([...f.m.rows].filter(([p])=>!p.startsWith('activity')));
  const api=P.load(f,true,{project:'bxh-arena'}),fn=handler==='event'?api.activityTournamentCompleted:api.activityCompletedTournamentBackfill,ev={params:{code:P.code},data:{after:source}};
  await fn(ev);
  for(const uid of ['u1','u2','u3','u4','admin'])assert.equal(f.m.rows.get('activityPointWallets/'+uid)?.balance,10,route+' '+uid);
  assert.equal(JSON.stringify([...f.m.rows].filter(([p])=>!p.startsWith('activity'))),before);
  const ledger=[...f.m.rows].filter(([p])=>p.startsWith('activityPointLedgers/'));assert.equal(ledger.length,5);await fn(ev);assert.equal([...f.m.rows].filter(([p])=>p.startsWith('activityPointLedgers/')).length,5);checks++;
 }
 console.log(JSON.stringify({activitySettlementBridgeChecks:checks,productionWrites:0,scope:'actual pinned PR713/PR715 settlement handlers feeding candidate activity handler through synthetic Firestore/auth boundaries'}));
})().catch(e=>{console.error(e);process.exitCode=1;});

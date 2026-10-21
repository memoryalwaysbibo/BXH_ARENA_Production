const test=require('node:test'),assert=require('node:assert/strict');
const {sealMatchTierPair}=require('../scripts/lib/rdw-tier-transaction-adapter.cjs');
const ref=id=>({id});
const matchRef=ref('match'),aRef=ref('a'),bRef=ref('b');
const grade=(uid,tier)=>({uid,permanentLicenseCurrent:{source:'server',verified:true,version:'hunter-license-v2.1',tier}});
function fixture(a=grade('A','c'),b=grade('B','b'),match={}){
 const data=new Map([['match',match],['a',a],['b',b]]),writes=[];
 const tx={get:async r=>({exists:data.has(r.id),data:()=>data.get(r.id)}),set:(r,value,options)=>{writes.push({r,value,options});data.set(r.id,{...data.get(r.id),...value});}};
 return {tx,writes,data};
}
const args={matchRef,eventId:'e',matchId:'m',playerA:{uid:'A',ref:aRef},playerB:{uid:'B',ref:bRef},capturedAt:100,matchStartedAt:101,resolveCurrentTier:async({player})=>player.permanentLicenseCurrent};
test('transaction seals reciprocal snapshots once and retries safely',async()=>{
 const f=fixture(),first=await sealMatchTierPair({tx:f.tx,...args});assert.equal(first.created,true);assert.equal(f.writes.length,1);
 assert.equal(first.pair.a.selfTierBefore,'c');assert.equal(first.pair.b.selfTierBefore,'b');
 assert.equal((await sealMatchTierPair({tx:f.tx,...args})).created,false);assert.equal(f.writes.length,1);
 await assert.rejects(sealMatchTierPair({tx:f.tx,...args,revision:1}),/snapshot-conflict/);
});
test('rejects missing or unverified server grade and identity mismatch',async()=>{
 await assert.rejects(sealMatchTierPair({tx:fixture(null).tx,...args}),/player-grade-missing/);
 await assert.rejects(sealMatchTierPair({tx:fixture(grade('WRONG','c')).tx,...args}),/player-identity-mismatch/);
 await assert.rejects(sealMatchTierPair({tx:fixture({uid:'A',permanentLicenseCurrent:{tier:'c'}}).tx,...args}),/verified-current-tier-required/);
 await assert.rejects(sealMatchTierPair({tx:fixture().tx,...args,resolveCurrentTier:undefined}),/trusted-tier-resolver-required/);
 await assert.rejects(sealMatchTierPair({tx:fixture().tx,...args,resolveCurrentTier:async()=>({source:'server',verified:true,version:'hunter-license-v2.1',tier:'unverified'})}),/verified-current-tier-required/);
});

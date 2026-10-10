'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('../scripts/lib/hunter-rating-provider-v0.cjs');

function snap(value){return {exists:value!=null,data:()=>value};}
function txFixture({match=null,a=null,b=null}={}){
  const writes=[];
  const refs={match:'matches/m1',a:'ratings/a',b:'ratings/b'};
  const values=new Map([[refs.match,match],[refs.a,a],[refs.b,b]]);
  const tx={
    get:async ref=>snap(values.get(ref)),
    set:(ref,value,options)=>writes.push({ref,value,options})
  };
  return {tx,refs,writes};
}

test('new players start at neutral 1000 and expose a versioned elo-400 provider',()=>{
  const payload=p.providerPayload(null,null);
  assert.deepEqual(payload,{source:'server',verified:true,version:p.VERSION,scale:p.SCALE,selfBefore:1000,opponentBefore:1000});
});

test('stronger opponent raises expected difficulty and upset produces larger gain',()=>{
  assert.ok(p.expected(1000,1200)<p.expected(1000,1000));
  const upset=p.settlePair({version:p.VERSION,scale:p.SCALE,rating:1000,games:4},{version:p.VERSION,scale:p.SCALE,rating:1200,games:9},'a');
  const even=p.settlePair({version:p.VERSION,scale:p.SCALE,rating:1000,games:4},{version:p.VERSION,scale:p.SCALE,rating:1000,games:9},'a');
  assert.ok(upset.deltaA>even.deltaA);
  assert.equal(Number((upset.deltaA+upset.deltaB).toFixed(4)),0);
});

test('prematch snapshots are sealed atomically for both perspectives',async()=>{
  const f=txFixture({a:{version:p.VERSION,scale:p.SCALE,rating:1020,games:5},b:{version:p.VERSION,scale:p.SCALE,rating:1110,games:8}});
  const pair=await p.sealMatchSnapshots({tx:f.tx,matchRef:f.refs.match,aRef:f.refs.a,bRef:f.refs.b,capturedAt:1000,matchStartedAt:1100});
  assert.equal(pair.a.selfBefore,1020);
  assert.equal(pair.a.opponentBefore,1110);
  assert.equal(pair.b.selfBefore,1110);
  assert.equal(pair.b.opponentBefore,1020);
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].ref,f.refs.match);
  assert.equal(f.writes[0].options.merge,true);
});

test('existing prematch snapshot is immutable across rating changes',async()=>{
  const first=txFixture({a:{version:p.VERSION,scale:p.SCALE,rating:1000,games:0},b:{version:p.VERSION,scale:p.SCALE,rating:1000,games:0}});
  const pair=await p.sealMatchSnapshots({tx:first.tx,matchRef:first.refs.match,aRef:first.refs.a,bRef:first.refs.b,capturedAt:1000,matchStartedAt:1100});
  const second=txFixture({
    match:{hunterRatingSnapshots:pair},
    a:{version:p.VERSION,scale:p.SCALE,rating:1300,games:20},
    b:{version:p.VERSION,scale:p.SCALE,rating:700,games:20}
  });
  await assert.rejects(
    p.sealMatchSnapshots({tx:second.tx,matchRef:second.refs.match,aRef:second.refs.a,bRef:second.refs.b,capturedAt:1000,matchStartedAt:1100}),
    /snapshot-immutable/
  );
});

test('same transaction retry is idempotent when rating states have not changed',async()=>{
  const first=txFixture({a:null,b:null});
  const pair=await p.sealMatchSnapshots({tx:first.tx,matchRef:first.refs.match,aRef:first.refs.a,bRef:first.refs.b,capturedAt:1000,matchStartedAt:1100});
  const retry=txFixture({match:{hunterRatingSnapshots:pair},a:null,b:null});
  const again=await p.sealMatchSnapshots({tx:retry.tx,matchRef:retry.refs.match,aRef:retry.refs.a,bRef:retry.refs.b,capturedAt:1000,matchStartedAt:1100});
  assert.deepEqual(again,pair);
});

test('malformed persisted rating fails closed',()=>{
  assert.throws(()=>p.playerState({version:p.VERSION,scale:p.SCALE,rating:NaN,games:1}),/state-invalid/);
  assert.throws(()=>p.playerState({version:'other',scale:p.SCALE,rating:1000,games:1}),/state-invalid/);
});

test('provider remains isolated from official Hunter grade calculation contract',()=>{
  const rating=p.settlePair(null,null,'a');
  assert.equal(rating.a.version,p.VERSION);
  assert.equal(rating.a.scale,p.SCALE);
  assert.equal(Object.hasOwn(rating.a,'hunterGrade'),false);
  assert.equal(Object.hasOwn(rating.a,'officialStrength'),false);
  assert.equal(Object.hasOwn(rating.a,'xp'),false);
});

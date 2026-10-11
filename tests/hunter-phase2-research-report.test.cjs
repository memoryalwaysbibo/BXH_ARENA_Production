'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const ledger=require('../scripts/lib/hunter-rating-ledger-v0.cjs');
const report=require('../scripts/hunter-phase2-research-report.cjs');

function lrow(eventCode,matchId,completedAt,a,b,winner,revision=1){
  return {version:ledger.VERSION,source:ledger.SOURCE,scoringVersion:'bxh-4pt-v1',eventCode,matchId,revision,status:'completed',updatedAt:completedAt+1,completedAt,playerA:a,playerB:b,winnerUid:winner,confirmed:true};
}
function rec(eventCode,matchId,uid,a,b,isWin,opponent,completedAt){
  return {
    eventCode,matchId,playerUid:uid,playerA:a,playerB:b,completedAt,
    scoringVersion:'bxh-4pt-v1',analyzable:true,isWin,scoreFor:isWin?4:1,scoreAgainst:isWin?1:4,
    opponent:{playerId:opponent},
    roundsPerspective:isWin
      ?[{type:'burst',points:2,perspective:'for'},{type:'knockout',points:2,perspective:'for'},{type:'spin',points:1,perspective:'against'}]
      :[{type:'spin',points:1,perspective:'for'},{type:'burst',points:2,perspective:'against'},{type:'burst',points:2,perspective:'against'}]
  };
}
function dataset(){
  const ledgerRows=[
    lrow('E1','m1',1000,'a','b','a'),
    lrow('E2','m2',2000,'a','c','c'),
    lrow('E3','m3',3000,'a','b','a'),
    lrow('E4','m4',4000,'a','d','a')
  ];
  const recordsByPlayer={
    a:[
      rec('E1','m1','a','a','b',true,'b',1000),
      rec('E2','m2','a','a','c',false,'c',2000),
      rec('E3','m3','a','a','b',true,'b',3000),
      rec('E4','m4','a','a','d',true,'d',4000)
    ]
  };
  return {ledgerRows,recordsByPlayer};
}

test('report joins replay ratings to Hunter backtest without changing official score',()=>{
  const r=report.buildReport(dataset());
  assert.equal(r.version,'hunter-phase2-research-report-v1');
  assert.equal(r.officialScoreChanged,false);
  assert.equal(r.researchOnly,true);
  assert.equal(r.summary.players,1);
  assert.equal(r.summary.candidateReadyPlayers,1);
  assert.equal(r.players[0].ratingCoverage,100);
  assert.ok(Number.isFinite(r.players[0].baselineScore));
  assert.ok(Number.isFinite(r.players[0].candidateScore));
});

test('report aliases player IDs and does not echo source identities',()=>{
  const r=report.buildReport(dataset());
  const json=JSON.stringify(r);
  for(const id of ['"a"','"b"','"c"','"d"'])assert.equal(json.includes(id),false);
  assert.match(r.players[0].player,/^P_[a-f0-9]{12}$/);
});

test('opponent strength buckets and repeat-opponent bias are explicit',()=>{
  const r=report.buildReport(dataset()),p=r.players[0];
  assert.equal(p.repeatOpponents.knownMatches,4);
  assert.equal(p.repeatOpponents.uniqueOpponents,3);
  assert.equal(p.repeatOpponents.repeatMatches,1);
  assert.equal(p.opponentStrength.weaker.matches+p.opponentStrength.peer.matches+p.opponentStrength.stronger.matches,4);
});

test('revoke changes replay-derived research ratings and report deterministically',()=>{
  const d=dataset(),before=report.buildReport(d);
  const revoke={...d.ledgerRows[0],revision:2,status:'revoked',updatedAt:5000,completedAt:null,winnerUid:null,confirmed:false};
  const after=report.buildReport({ledgerRows:[...d.ledgerRows,revoke],recordsByPlayer:d.recordsByPlayer});
  assert.notEqual(before.inputs.ledgerSha256,after.inputs.ledgerSha256);
  assert.ok(after.players[0].matches<before.players[0].matches);
});

test('same input is reproducible except generatedAt CLI metadata',()=>{
  const d=dataset(),a=report.buildReport(d),b=report.buildReport(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(a,b);
});

test('CLI output omits raw rounds, player IDs, match IDs and rating snapshots',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hunter-p2-report-'));
  try{
    const input=path.join(dir,'data.json');fs.writeFileSync(input,JSON.stringify(dataset()));
    const p=cp.spawnSync(process.execPath,['scripts/hunter-phase2-research-report.cjs','--input',input],{encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);
    const out=JSON.parse(p.stdout);
    assert.equal(out.researchOnly,true);
    for(const token of ['roundsPerspective','ratingSnapshot','matchId','playerUid'])assert.equal(p.stdout.includes(token),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

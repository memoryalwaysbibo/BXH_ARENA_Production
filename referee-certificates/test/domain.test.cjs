'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../functions/domain.cjs');
const row=overrides=>({decisions:0,events:0,size:null,precision:'unknown',period:'系統記錄前',note:'',status:'active',...overrides});
test('nine approved ranks and ten hundred-person milestones stay independent',()=>{
  assert.deepEqual(D.RANKS.map(x=>x.decisions),[1,20,50,100,200,450,750,1100,1500]);
  assert.deepEqual(D.RANKS.map(x=>Object.values(x.scales)),[[0,0,0],[0,0,0],[1,0,0],[2,1,0],[3,2,0],[4,3,0],[6,4,1],[8,5,2],[10,6,3]]);
  assert.deepEqual(D.MILESTONES.map(x=>x.threshold),[100,200,300,400,500,600,700,800,900,1000]);
  assert.equal(D.eligibleLevel({decisions:0,scales:{64:100,96:100,128:100}}),0);
  for(const rank of D.RANKS){assert.equal(D.eligibleLevel({decisions:rank.decisions,scales:rank.scales}),rank.level);assert.ok(D.eligibleLevel({decisions:rank.decisions-1,scales:rank.scales})<rank.level);}
  assert.equal(D.eligibleLevel({decisions:1500,scales:{64:0,96:0,128:0}}),2);
});
test('148 people is one event and covers 64/96/128 and 100 without multiplying decisions',()=>{
  const s=D.aggregate(D.emptySource(),[row({decisions:7,events:3,size:148,precision:'exact'})]);
  assert.equal(s.decisions,7);assert.equal(s.eventCount,3);assert.deepEqual(s.scales,{64:3,96:3,128:3});assert.equal(s.milestones[100],3);assert.equal(s.milestones[200],0);
});
test('at_least 96 does not imply 100; unknown adds only total events; revoked does not count',()=>{
  const s=D.aggregate(D.emptySource(),[row({events:2,size:96,precision:'at_least'}),row({events:4}),row({decisions:100,events:100,size:1000,precision:'exact',status:'revoked'})]);
  assert.equal(s.eventCount,6);assert.equal(s.unknownScaleEvents,4);assert.deepEqual(s.scales,{64:2,96:2,128:0});assert.equal(s.milestones[100],0);assert.equal(s.maxPrecision,'at_least');assert.equal(s.decisions,0);
});
test('backfill requires safe nonnegative integers and explicit lower-bound semantics',()=>{
  for(const change of [{decisions:-1},{events:0.5},{size:0,events:1,precision:'exact'},{events:1,precision:'unknown',size:100},{decisions:Number.MAX_SAFE_INTEGER},{decisions:1,period:''}])assert.throws(()=>D.normalizeBackfill(row({decisions:1,...change})),D.CertificateError);
});
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNf8AAAAASUVORK5CYII=';
test('photo validates canonical base64, magic bytes, MIME and payload bounds',()=>{
  assert.equal(D.normalizePhoto(PNG),PNG);assert.equal(D.normalizePhoto(null),null);
  for(const value of [PNG.replace('image/png','image/jpeg'),'https://example.com/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,AAAA',PNG+' ',PNG.replace('base64,','base64,\n'),'x'.repeat(600001)])assert.throws(()=>D.normalizePhoto(value),D.CertificateError);
  const badWebp=Buffer.alloc(24);badWebp.write('RIFF');badWebp.writeUInt32LE(100,4);badWebp.write('WEBP',8);badWebp.write('VP8 ',12);
  assert.throws(()=>D.normalizePhoto('data:image/webp;base64,'+badWebp.toString('base64')),/photo-signature-invalid/);
});
module.exports={PNG};

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../functions/domain.cjs');
const row=overrides=>({decisions:0,events:0,size:null,precision:'unknown',period:'系統記錄前',note:'',status:'active',...overrides});
test('nine approved ranks and ten hundred-person milestones stay independent',()=>{
  assert.deepEqual(D.RANKS.map(x=>x.decisions),[0,20,50,100,200,450,750,1100,1500]);
  assert.deepEqual(D.RANKS.map(x=>Object.values(x.scales)),[[0,0,0],[0,0,0],[1,0,0],[2,1,0],[3,2,0],[4,3,0],[6,4,1],[8,5,2],[10,6,3]]);
  assert.deepEqual(D.MILESTONES.map(x=>x.threshold),[100,200,300,400,500,600,700,800,900,1000]);
  assert.equal(D.eligibleLevel({decisions:0,scales:{64:100,96:100,128:100}}),1);
  for(const rank of D.RANKS){assert.equal(D.eligibleLevel({decisions:rank.decisions,scales:rank.scales}),rank.level);if(rank.level>1)assert.ok(D.eligibleLevel({decisions:rank.decisions-1,scales:rank.scales})<rank.level);}
  assert.equal(D.eligibleLevel({decisions:1500,scales:{64:0,96:0,128:0}}),2);
});
test('148 people inclusively covers 64/96/128 and 100 without multiplying decisions',()=>{
  const entries=Array.from({length:3},(_,i)=>row({kind:'event',events:1,size:148,precision:'exact',sourceKey:'historical:event'+i,basis:'verified event',recognitionValid:true}));
  entries.push(...Array.from({length:7},(_,i)=>row({kind:'decision',decisions:1,sourceKey:'historical:decision'+i,basis:'verified responsibility',recognitionValid:true})));
  const s=D.aggregate(D.emptySource(),entries);
  assert.equal(s.decisions,7);assert.equal(s.eventCount,3);assert.deepEqual(s.scales,{64:3,96:3,128:3});assert.equal(s.milestones[100],3);assert.equal(s.milestones[200],0);
});
test('auxiliary and untyped legacy estimates never increase decisions; duplicate source deduplicates',()=>{
  const r=row({kind:'decision',decisions:1,sourceKey:'historical:one',basis:'verified',recognitionValid:true});
  const s=D.aggregate(D.emptySource(),[r,r,row({decisions:100}),row({kind:'auxiliary',auxiliary:4,sourceKey:'historical:assist',basis:'assisted',recognitionValid:true})]);
  assert.equal(s.decisions,1);assert.equal(s.pendingBackfills,1);assert.equal(s.auxiliaryCount,4);
  const source=D.emptySource();source.decisions=1;source.systemRecords=[{status:'verified',tournamentCode:'BXH-AAAA',matchId:'m0'}];
  assert.equal(D.aggregate(source,[{...r,sourceKey:'match:BXH-AAAA:m0'}]).decisions,1);
});
test('lower bounds and unknown scales stay conservative',()=>{
 const source=D.emptySource();D.addEvent(source,2,96,'at_least');D.addEvent(source,4,null,'unknown');
 const s=D.aggregate(source,[]);assert.deepEqual(s.scales,{64:2,96:2,128:0});assert.equal(s.milestones[100],0);assert.equal(s.unknownScaleEvents,4);
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
test('bounded exact-key batches can represent L9 without changing thresholds or relying on aggregate guesses',()=>{
 const entries=[];
 for(let i=0;i<8;i++){const n=i===7?100:200;entries.push(row({kind:'decision',decisions:n,sourceKeys:Array.from({length:n},(_,j)=>'historical:batch'+i+'match'+j),sourceKey:'historical:batch'+i+'match0',basis:'explicitly reviewed each key',recognitionValid:true}));}
 for(let i=0;i<10;i++)entries.push(row({kind:'event',events:1,size:148,precision:'exact',sourceKey:'historical:event'+i,basis:'reviewed event',recognitionValid:true}));
 const s=D.aggregate(D.emptySource(),entries);assert.equal(s.decisions,1500);assert.equal(D.eligibleLevel(s),9);
 const overlapping={...entries[0],sourceKeys:entries[0].sourceKeys.slice(0,2),decisions:2};assert.equal(D.aggregate(D.emptySource(),[entries[0],overlapping]).decisions,200);
 assert.throws(()=>D.normalizeBackfill({...entries[0],decisions:201}),/recognition-count-invalid/);
});

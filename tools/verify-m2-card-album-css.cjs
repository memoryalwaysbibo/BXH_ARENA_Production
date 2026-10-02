'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(process.env.BXH_M2_ROOT||process.cwd());
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'modules/card-album/styles.css'),'utf8');
const link='<link rel="stylesheet" href="modules/card-album/styles.css?v=20261002-m2-1">';
const open='<style>\n.card-album-head';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const blob=x=>{const b=Buffer.from(x);return crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');};

test('candidate index and extracted CSS digests are fixed',()=>{
  assert.equal(blob(index),'52a33590b3ca5a9d118aaeae70cd9d16f78baceb');
  assert.equal(sha(css),'034f6ce6fe55540c7a495d23480ad9723795df374a9e5bf1cde91afdde5f2789');
});
test('Card Album inline block is removed exactly once and external link exists exactly once',()=>{
  assert.equal(index.includes(open),false);
  assert.equal(index.split(link).length-1,1);
});
test('stylesheet keeps the exact cascade position',()=>{
  const a=index.indexOf('referee-score-v2.css?v=14.2.38-score-fault');
  const b=index.indexOf(link);
  const c=index.indexOf('title-reward-mail.css?v=20260930-1');
  assert.ok(a>=0 && b>a && c>b);
});
test('re-inlining the exact CSS reconstructs the M1 index byte-for-byte',()=>{
  const restored=index.replace(link,'<style>\n'+css+'</style>');
  assert.equal(blob(restored),'f5c5d2205d26aeedd340c8a822b4f3fecefa377b');
});
test('extracted CSS has no relative URL semantics to change',()=>{
  assert.equal(/url\s*\(/i.test(css),false);
});
test('all Card Album selector families remain present',()=>{
  for(const token of ['.card-album-head','.card-album-note','.card-album-set','.card-album-grid','.card-album-slot','.card-album-count','.card-album-preview-overlay','.card-album-preview','.card-album-trades','.card-album-trade-row','.card-album-targets']){
    assert.ok(css.includes(token),token);
  }
});
test('mobile 3-column rule is retained',()=>{
  assert.match(css,/@media\(max-width:700px\)\{\.card-album-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:8px\}\}/);
});
test('M2 does not move or rename Management V2 module entrypoints',()=>{
  for(const f of ['modules/management-v2/navigation.js','modules/management-v2/adapter.js','modules/management-v2/bootstrap.js','modules/management-v2/styles.css']) assert.ok(index.includes(f));
});

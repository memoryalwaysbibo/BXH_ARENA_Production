'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {verifyData01bRaw,verifyData01bFile,EXPECTED_SHA256,EXPECTED_MANIFEST,EXPECTED_COUNTS}=require('./data01b-preflight.cjs');
test('canonical manifest and all nine section counts are pinned',()=>{
 assert.match(EXPECTED_SHA256,/^[a-f0-9]{64}$/);
 assert.match(EXPECTED_MANIFEST,/^[a-f0-9]{64}$/);
 assert.equal(Object.values(EXPECTED_COUNTS).reduce((a,b)=>a+b,0),197);
 assert.equal(Object.keys(EXPECTED_COUNTS).length,9);
});
test('arbitrary and replacement 197-record fixture cannot bypass SHA pin',()=>{
 assert.throws(()=>verifyData01bRaw(Buffer.from('{}')),/DATA01B_SHA256_MISMATCH/);
 assert.throws(()=>verifyData01bRaw(Buffer.from(JSON.stringify({batchId:'DATA-01B-20261009',records:Array(197).fill({})}))),/DATA01B_SHA256_MISMATCH/);
 assert.throws(()=>verifyData01bRaw('{}'),/DATA01B_RAW_BUFFER_REQUIRED/);
 assert.throws(()=>verifyData01bFile(''),/DATA01B_FILE_REQUIRED/);
});
const file=process.env.BXH_CATALOG_DATA01B_FILE;
test('private original fixture preflight, when injected', {skip:!file},()=>{
 const raw=fs.readFileSync(file),result=verifyData01bRaw(raw);
 assert.equal(result.summary.records,197);
 assert.equal(result.summary.collections,9);
 assert.equal(result.summary.manifestDigest,EXPECTED_MANIFEST);
 const mutated=Buffer.from(raw);mutated[mutated.length-2]^=1;
 assert.throws(()=>verifyData01bRaw(mutated),/DATA01B_SHA256_MISMATCH/);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('both staff roster frontend bundles receive fresh cache keys',()=>{
 const html=fs.readFileSync(__dirname+'/../index.html','utf8');
 for(const id of ['bxh-main-app-m7','bxh-cloud-runtime-m8']){
  const script=html.split('\n').find(line=>line.includes('id="'+id+'"'));
  assert(script?.includes('&staff-roster=20261030.1'));
 }
});

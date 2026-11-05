'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {wave,sourceGeneration}=require('./check.cjs');
(async()=>{
 const results=[];
 const cases=[{capacity:128,waitlistCapacity:0},{capacity:64,waitlistCapacity:36}];
 const output=path.join(__dirname,'results100.json');
 const candidateSha256=Object.fromEntries(['family-registration.js','registration-admission.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'candidate',file))).digest('hex')]));
 const save=()=>fs.writeFileSync(output,JSON.stringify({scope:'Local real Firestore Emulator; synthetic authenticated users; not live Cloud Run capacity',count:100,repetitions:2,sourceGeneration,candidateSha256,method:'All clients begin preview together, then immediately join with preview allocation. No manual retries, no frontend polling. Independent module graphs simulate per-process schedulers, in one Node process.',results},null,2)+'\n');
 for(const scenario of cases){
  for(let repetition=1;repetition<=2;repetition++){
   const modes=repetition===1?[[false,1],[true,1],[true,4]]:[[true,4],[true,1],[false,1]];
   for(const [candidate,instances]of modes){
    const result=await wave(candidate,100,scenario.capacity,scenario.waitlistCapacity,instances);
    result.repetition=repetition;
    result.failureCounts=result.failed.reduce((out,error)=>{out[error]=(out[error]||0)+1;return out;},{});
    results.push(result);save();
   }
  }
 }
 console.log('SUMMARY100 '+JSON.stringify(results.map(({candidate,instances,capacity,waitlistCapacity,repetition,succeeded,failureCounts,counts,p50Ms,p95Ms,maxMs,retries})=>({candidate,instances,capacity,waitlistCapacity,repetition,succeeded,failureCounts,counts,p50Ms,p95Ms,maxMs,retries}))));
 await require('firebase-admin/firestore').getFirestore().terminate();
})().catch(error=>{console.error(error);process.exitCode=1;});

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {db,service,seed,request,audit,drainAll}=require('./harness.cjs');
const percentile=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)]||0;
const report={scope:'Actual local Firestore Emulator + captured family handler; synthetic Auth; 5 independent queue service objects in one Node process. Not live Cloud Run, real phones, Auth or App Check.',sourceGeneration:require('./captured-family-source.json').sourceGeneration,results:[]};
const out=path.join(__dirname,'../evidence/waves.json');
async function wave(n,capacity,waitlistCapacity,repetition){
 const services=Array.from({length:5},(_,i)=>service({workerId:'wave-worker-'+i}));
 const {code,ids}=await seed(n,capacity,waitlistCapacity),start=performance.now(),accepted=[],finished=[];
 // All clients start their acceptance request before any worker is released.
 await Promise.all(ids.map(async(uid,i)=>{await services[i%5].enqueue(uid,request(code,uid));accepted.push(performance.now()-start);}));
 const acceptedMs=performance.now()-start;
 await drainAll(services,code);
 const states=await Promise.all(ids.map(async(uid,i)=>{const s=await services[i%5].status(uid,code,request(code,uid).operationId);finished.push(performance.now()-start);return s.operation;}));
 const a=await audit(code,Math.min(n,capacity+waitlistCapacity));
 assert(states.every(s=>['completed','rejected'].includes(s.state)));
 assert.equal(a.summary.completed,Math.min(n,capacity+waitlistCapacity));assert.equal(a.summary.rejected,Math.max(0,n-capacity-waitlistCapacity));
 assert(a.jobs.filter(j=>j.state==='rejected').every(j=>j.reason==='full'));
 assert.equal(a.summary.jobs,n);assert.equal(new Set(a.rows.map(r=>r.id)).size,a.rows.length);
 const result={n,capacity,waitlistCapacity,repetition,workers:5,...a.summary,acceptance:{p50Ms:Math.round(percentile(accepted,.5)),p95Ms:Math.round(percentile(accepted,.95)),maxMs:Math.round(Math.max(...accepted)),totalMs:Math.round(acceptedMs)},totalMs:Math.round(performance.now()-start),resultReadbackP95Ms:Math.round(percentile(finished,.95)),timeout:0,remaining:states.filter(s=>!['completed','rejected'].includes(s.state)).length};
 report.results.push(result);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(result));
}
(async()=>{
 for(let repetition=1;repetition<=2;repetition++)for(const n of [50,100,150]){
  await wave(n,200,0,repetition);
  await wave(n,Math.floor(n*.6),Math.floor(n*.2),repetition);
 }
 report.completedAt=new Date().toISOString();report.queueSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../backend/queue.cjs'))).digest('hex');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 await db.terminate();
})().catch(async e=>{console.error(e);await db.terminate();process.exitCode=1;});

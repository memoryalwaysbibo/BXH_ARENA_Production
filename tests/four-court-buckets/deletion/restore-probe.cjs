'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const probe=require('./restore-fixture.cjs'),spec={function:'restoreIdleTournament',path:'operations.js'};
(async()=>{let checks=0;
// The deployed score-storage fence must survive the additional lease guards.
for(const marker of ['scoreStorage','scoreBucketProjection'])for(const value of [null,false,{}])for(const side of ['tournaments','publicTournaments'])for(const candidate of [false,true]){
 const m=probe.memory();probe.restoration(m);m.rows.get(side+'/BXH-TEST01')[marker]=value;
 const mod=probe.load(spec,candidate,m,path.resolve(__dirname,'../../../release/buckets/deletion/restore-operations.js'));
 await assert.rejects(mod.restoreIdleTournament(probe.request({reason:'test reason'})),/bucket-scoring-required/);
 assert.equal(m.writes,0);checks++;
}
{
 const a=probe.memory(),b=probe.memory();probe.restoration(a);probe.restoration(b);
 const original=probe.load(spec,false,a),candidate=probe.load(spec,true,b,path.resolve(__dirname,'../../../release/buckets/deletion/restore-operations.js'));
 const left=await original.restoreIdleTournament(probe.request({reason:'test reason'}));
 const right=await candidate.restoreIdleTournament(probe.request({reason:'test reason'}));
 assert.deepEqual(JSON.parse(JSON.stringify(left)),JSON.parse(JSON.stringify(right)));
 assert.deepEqual([...a.rows],[...b.rows]);assert(a.roomWrites>0);checks++;
}
for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}, {status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
 const m=probe.memory();probe.restoration(m);m.rows.get(side+'/BXH-TEST01')[marker]=value;
 const mod=probe.load(spec,true,m,path.resolve(__dirname,'../../../release/buckets/deletion/restore-operations.js'));
 await assert.rejects(mod.restoreIdleTournament(probe.request({reason:'test reason'})),/bucket-scoring-required/);
 assert.equal(m.roomWrites,0);assert.equal(m.writes,0);checks++;
}
console.log(JSON.stringify({checks,productionWrites:0,deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

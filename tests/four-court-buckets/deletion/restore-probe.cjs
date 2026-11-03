'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const probe=require('./restore-fixture.cjs'),spec={function:'restoreIdleTournament',path:'operations.js'};
(async()=>{let checks=0;
for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}, {status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
 const m=probe.memory();probe.restoration(m);m.rows.get(side+'/BXH-TEST01')[marker]=value;
 const mod=probe.load(spec,true,m,path.resolve(__dirname,'../../../release/buckets/deletion/restore-operations.js'));
 await assert.rejects(mod.restoreIdleTournament(probe.request({reason:'test reason'})),/bucket-scoring-required/);
 assert.equal(m.roomWrites,0);assert.equal(m.writes,0);checks++;
}
console.log(JSON.stringify({checks,productionWrites:0,deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

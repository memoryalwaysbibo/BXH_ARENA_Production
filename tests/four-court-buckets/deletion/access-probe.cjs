'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {memory}=require('./restore-fixture.cjs'),code='BXH-TEST01',fixture=path.join(__dirname,'fixtures/access');
const core=require(path.join(fixture,'room-access-core.js'));
function load(m,candidate){
 const file=candidate?path.resolve(__dirname,'../../../release/buckets/deletion/room-access-service.js'):path.join(fixture,'room-access-service.js');
 const module={exports:{}};const req=n=>n==='./room-access-core'?core:n==='./_qr_checkin/admin-firestore.cjs'?{FieldValue:{delete:()=>({_delete:true})}}:require(n);
 vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})')(req,module,module.exports);
 return module.exports.createRoomAccessService(m.db,()=>100000);
}
function setup(){const m=memory();m.rows.set('users/admin',{active:true,role:'player'});Object.assign(m.rows.get('tournaments/'+code),{roomAccessMode:'password',roomAccessVersion:1,roomAccessSalt:'0123456789abcdef0123456789abcdef',roomAccessHash:''});const t=m.rows.get('tournaments/'+code);t.roomAccessHash=require('node:crypto').scryptSync('test-password',Buffer.from(t.roomAccessSalt,'hex'),32).toString('hex');return m;}
const request=action=>({auth:{uid:'admin'},data:{action,code,password:'test-password',operationId:'operation-access-001',mode:'public'}});
(async()=>{let checks=0;
 // Preserve the deployed configure fence while extending migration/deletion isolation.
 for(const marker of ['scoreStorage','scoreBucketProjection'])for(const value of [null,false,{}])for(const side of ['tournaments','publicTournaments'])for(const candidate of [false,true]){
  const m=memory();m.rows.get(side+'/'+code)[marker]=value;
  await assert.rejects(load(m,candidate)(request('configure')),/bucket-scoring-required/);assert.equal(m.writes,0);checks++;
 }
 for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}, {status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
  const m=setup();m.rows.get(side+'/'+code)[marker]=value;
  await assert.rejects(load(m,true)(request('verify')),/room-deletion-or-migration-in-progress/);assert.equal(m.writes,0);checks++;
 }
 for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}, {status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
  const m=memory();m.rows.get(side+'/'+code)[marker]=value;
  await assert.rejects(load(m,true)(request('configure')),/bucket-scoring-required/);assert.equal(m.writes,0);checks++;
 }
 for(const action of ['verify','configure']){const a=action==='verify'?setup():memory(),b=action==='verify'?setup():memory();
  assert.deepEqual(await load(a,false)(request(action)),await load(b,true)(request(action)));assert.deepEqual([...a.rows],[...b.rows]);assert(a.writes>0);checks++;
 }
 console.log(JSON.stringify({accessChecks:checks,productionWrites:0,deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

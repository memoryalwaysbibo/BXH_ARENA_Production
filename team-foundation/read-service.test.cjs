'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createReadService}=require('./read-service.cjs');
function setup(){
 const data=new Map([
 ['teamsV1/t',{captainUid:'c',memberUids:['c','d','m'],roles:{d:'deputy'},status:'active'}],
 ['teamMembershipsV1/c',{teamId:'t'}],['teamMembershipsV1/d',{teamId:'t'}],['teamMembershipsV1/m',{teamId:'t'}],
 ['teamsV1/t/history/h',{subjectUid:'gone',subjectName:'小賈',actorName:'黑爸',actorRole:'captain',method:'remove',occurredAt:1793095800000}],
 ['teamsV1/t/historyReasons/h',{code:'other',label:'其他',note:'私有說明',subjectUid:'gone'}],
 ['teamsPublicV1/t',{name:'隊伍',members:[{uid:'c',name:'黑爸',role:'captain',ladderPoints:12,hunterTier:'b',secret:'PRIVATE'}],secret:'PRIVATE'}]
 ]);const reads=[];
 const db={doc:p=>p,collection:p=>({orderBy:()=>({limit:n=>({path:p,limit:n})})}),runTransaction:fn=>fn({get:async p=>{reads.push(p);if(typeof p==='object')return {docs:[{id:'h',data:()=>data.get('teamsV1/t/history/h')}]};return {exists:data.has(p),data:()=>data.get(p)};}})};
 return {read:createReadService({db}),data,reads};
}
test('public member endpoint excludes unexpected fields',async()=>{const f=setup();const r=await f.read({actorUid:'outsider',action:'members',teamId:'t'});assert.equal(JSON.stringify(r).includes('PRIVATE'),false);assert.deepEqual(f.reads,['teamsPublicV1/t']);});
test('history requires current membership and returns separate date/time without reason',async()=>{
 const f=setup();await assert.rejects(f.read({actorUid:'outsider',action:'history',teamId:'t'}),/permission/);
 const r=await f.read({actorUid:'m',action:'history',teamId:'t'});assert.ok(r.items[0].date);assert.ok(r.items[0].time);assert.equal(JSON.stringify(r).includes('私有說明'),false);assert.equal(r.pageLimit,50);
});
test('reason is visible to subject and current leadership; stale roles do not authorize',async()=>{
 for(const uid of ['c','d','gone']){const f=setup();assert.equal((await f.read({actorUid:uid,action:'reason',teamId:'t',historyId:'h'})).note,'私有說明');}
 for(const uid of ['m','outsider']){const f=setup();await assert.rejects(f.read({actorUid:uid,action:'reason',teamId:'t',historyId:'h'}),/permission/);assert.ok(!f.reads.some(p=>typeof p==='string'&&p.includes('historyReasons')));}
 const f=setup();f.data.delete('teamMembershipsV1/d');await assert.rejects(f.read({actorUid:'d',action:'reason',teamId:'t',historyId:'h'}),/permission/);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('modules/main-app/core.js','utf8');
const start=source.indexOf('async function publishRegistrationConfig(){'),end=source.indexOf('\nfunction ',start);
assert(start>=0&&end>start);
function fixture(available=true,code=null){
 const saves=[],messages=[];let renderCount=0;
 const room={id:'draft',meta:{name:'Synthetic lab',registrationCapacity:160,stations:6,publishedAt:123,registrationStatus:'open'}};
 const ctx=vm.createContext({state:room,Date,cloudStatus:'connected',window:{cloudSync:{connect:async()=>{},createRoom:async()=>code}},cloudAvailable:()=>available,
  computeRegistrationStatus:()=> 'open',saveRecord:async s=>saves.push(JSON.parse(JSON.stringify(s))),render:()=>renderCount++,showToast:m=>messages.push(m),cloudCreateRoomErrorMessage:()=> '發布失敗'});
 vm.runInContext(source.slice(start,end),ctx);return {ctx,room,saves,messages,run:()=>ctx.publishRegistrationConfig()};
}
for(const available of [false,true])test('failed new-room publication restores unpublished state and persists it; cloud='+available,async()=>{
 const f=fixture(available);await f.run();assert.equal(f.room.meta.publishedAt,null);assert.equal(f.room.meta.registrationStatus,'draft');assert.equal(f.room.cloudCode,undefined);
 assert.equal(f.saves.at(-1).meta.publishedAt,null);assert(f.messages.every(m=>!m.includes('賽事已發布')));
 assert.equal(f.room.meta.registrationCapacity,160);assert.equal(f.room.meta.stations,6);
});
test('successful room creation keeps confirmed publication and the cloud code',async()=>{
 const f=fixture(true,'BXH-CREATED');Object.assign(f.ctx,{cloneStateForSave:s=>JSON.parse(JSON.stringify(s)),enqueueCloudStateWrite:async()=>true,publishPendingPosterCover:async()=>{},cloudUnsub:null,applyRemoteState:()=>{},publicTournamentsCache:null,publicTournamentsError:null});
 f.ctx.window.cloudSync.subscribe=()=>()=>{};await f.run();assert.equal(f.room.cloudCode,'BXH-CREATED');assert(f.room.meta.publishedAt>123);assert(f.messages.some(m=>m.includes('賽事已發布')));
});
test('a thrown create failure also leaves a persisted unpublished draft',async()=>{
 const f=fixture();f.ctx.window.cloudSync.createRoom=async()=>{throw Error('unavailable');};await f.run();
 assert.equal(f.saves.at(-1).meta.publishedAt,null);assert.equal(f.room.cloudCode,undefined);
});

function errorMessage(code,reason){
 const begin=source.indexOf('function cloudCreateRoomErrorMessage('),stop=source.indexOf('\nasync function cloudStartRoom',begin);
 assert(begin>=0&&stop>begin);
 const ctx=vm.createContext({window:{__BXH_LAST_CLOUD_ERROR_CODE:code,__BXH_LAST_ROOM_CREATE_REASON:reason},isPartnerOrganizerMode:()=>false});
 vm.runInContext(source.slice(begin,stop),ctx);return ctx.cloudCreateRoomErrorMessage('發布失敗');
}
for(const [code,reason,expected]of [
 ['functions/failed-precondition','unsupported-mode','賽事模式'],
 ['functions/failed-precondition','auto-create-not-enabled','尚未就緒'],
 ['functions/permission-denied',null,'未通過授權'],
 ['functions/unauthenticated',null,'重新登入'],
 ['functions/unavailable',null,'暫時無法連線'],
 ['functions/failed-precondition','mirror-mismatch','草稿資料驗證未通過'],
 ['functions/failed-precondition','room-code-conflict','房間代碼重複']
])test(`room-create diagnostic explains ${reason||code}`,()=>{
 const message=errorMessage(code,reason);assert(message.startsWith('發布失敗：'));assert(message.includes(expected));
});
test('unknown service detail is never exposed to the room creator',()=>{
 assert(!errorMessage('functions/internal','secret server payload').includes('secret'));
});

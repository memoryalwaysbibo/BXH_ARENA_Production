'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createLoader}=require('../modules/main-app/ladder-location.js');
const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const secondary=fs.readFileSync(path.join(__dirname,'../ladder-secondary-ui.js'),'utf8');
const response=locations=>({ok:true,version:1,locations});
const loc={city:'台南市',region:'仁德區'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const plain=x=>JSON.parse(JSON.stringify(x));
function between(a,b){return core.slice(core.indexOf(a),core.indexOf(b,core.indexOf(a)));}
function sandbox(loader){
  const listeners={};
  const ctx={window:{BXHLadderLocations:loader},Map,console,setTimeout,clearTimeout,queueMicrotask,
    ladderPublicData:{players:[]},ladderPublicLoaded:true,ladderPublicError:'',firebaseUser:{uid:'a'},
    renderLadderLeaderboardPage:()=>'',ladderLeaderboardTable:()=>'',
    ladderTierFromPoints:()=> '青銅',ladderDisplayTier:()=> '青銅',LADDER_TIER_INDEX:{青銅:1},
    document:{addEventListener:(name,fn)=>{listeners[name]=fn;},getElementById:()=>null,createElement:()=>({}),head:{appendChild:()=>{}}}
  };
  vm.createContext(ctx);
  vm.runInContext(between('const TAIWAN_CITY_DISTRICTS=','function profileCityOptionsHtml'),ctx);
  vm.runInContext(between('function ladderCompare(','function defaultLadderProfile('),ctx);
  vm.runInContext(between('let ladderLocationCity=','function ladderLocationLabel('),ctx);
  ctx.ladderLocationLabel=()=> '台南市・仁德區 地區榜';
  vm.runInContext(secondary,ctx);
  ctx.listeners=listeners;
  return ctx;
}
test('global list needs no location service, including members without geography',()=>{
  const ctx=sandbox(createLoader(()=>{throw Error('must not read');},()=>{}));
  ctx.rows=[{uid:'a',seasonPoints:50}];
  assert.deepEqual(plain(vm.runInContext('ladderLocationRows(rows)',ctx)),ctx.rows);
});
test('old ladder rows resolve current geography and appear in season/career boards',async()=>{
  const loader=createLoader(async()=>response({a:loc,b:{city:'高雄市',region:'左營區'}}),()=>{});
  const ctx=sandbox(loader);ctx.ladderPublicData={players:[{uid:'a',playerName:'仁德玩家',seasonPoints:50,careerPoints:100},{uid:'b',seasonPoints:100,careerPoints:200}]};
  vm.runInContext('ladderLocationCity="台南市";ladderLocationRegion="仁德區"',ctx);
  assert.match(ctx.ladderLeaderboardTable([],false),/正在讀取玩家最新地區/);
  await loader.state(ctx.ladderPublicData).promise;
  assert.match(ctx.ladderLeaderboardTable([],false),/仁德玩家/);
  assert.match(ctx.ladderLeaderboardTable([],false),/NO\.1/);
  ctx.listeners.click({target:{closest:selector=>selector==='[data-ladder-score-mode]'?{getAttribute:()=> 'career'}:null},preventDefault(){},stopPropagation(){}});
  assert.match(ctx.ladderLeaderboardTable([],false),/100/);
});
test('career-only positive scores survive while season remains empty',async()=>{
  const loader=createLoader(async()=>response({a:loc}),()=>{}),ctx=sandbox(loader);
  ctx.ladderPublicData={players:[{uid:'a',playerName:'生涯玩家',seasonPoints:0,careerPoints:100}]};
  vm.runInContext('ladderLocationCity="台南市"',ctx);ctx.ladderLeaderboardTable([],false);
  await loader.state(ctx.ladderPublicData).promise;
  assert.match(ctx.ladderLeaderboardTable([],false),/此地區目前沒有符合/);
  ctx.listeners.click({target:{closest:s=>s==='[data-ladder-score-mode]'?{getAttribute:()=> 'career'}:null},preventDefault(){},stopPropagation(){}});
  assert.match(ctx.ladderLeaderboardTable([],false),/生涯玩家/);
});
test('slow/error regional data never displays no-score or not-ranked claims',async()=>{
  const gate=deferred(),loader=createLoader(()=>gate.promise,()=>{}),ctx=sandbox(loader);
  ctx.ladderPublicData={players:[{uid:'a',seasonPoints:30}]};vm.runInContext('ladderLocationCity="台南市"',ctx);
  const loading=ctx.ladderLeaderboardTable([],false);assert.match(loading,/正在讀取/);assert.doesNotMatch(loading,/尚未上榜|尚無玩家取得/);
  gate.reject(Error('offline'));await loader.state(ctx.ladderPublicData).promise;
  const failed=ctx.ladderLeaderboardTable([],false);assert.match(failed,/地區資料讀取失敗/);assert.doesNotMatch(failed,/尚未上榜|尚無玩家取得/);
  vm.runInContext('ladderLocationCity=""',ctx);assert.doesNotMatch(ctx.ladderLeaderboardTable([],false),/地區資料讀取失敗/);
});
test('failed partial batches cannot publish an incomplete regional ranking',async()=>{
  let calls=0;const loader=createLoader(async ids=>{if(++calls===2)throw Error('offline');return response(Object.fromEntries(ids.map(id=>[id,loc])));},()=>{});
  const snapshot={players:Array.from({length:201},(_,i)=>({uid:'p'+i}))};
  await loader.ensure(snapshot).promise;assert.equal(loader.state(snapshot).status,'error');assert.equal(loader.state(snapshot).locations.size,0);
});
test('batch limits, duplicates, and one request per snapshot',async()=>{
  const batches=[];const loader=createLoader(async ids=>{batches.push(ids);return response(Object.fromEntries(ids.map(id=>[id,loc])));},()=>{});
  const snapshot={players:Array.from({length:205},(_,i)=>({uid:'p'+i})).concat({uid:'p0'})};
  const a=loader.ensure(snapshot),b=loader.ensure(snapshot);assert.equal(a,b);await a.promise;
  assert.deepEqual(batches.map(x=>x.length),[100,100,5]);assert.equal(a.locations.size,205);
});
test('refresh and profile edit use new snapshots; late old requests remain isolated',async()=>{
  const old=deferred(),fresh=deferred();let calls=0;
  const loader=createLoader(()=>++calls===1?old.promise:fresh.promise,()=>{});
  const a={players:[{uid:'a'}]},b={players:[{uid:'a'}]};loader.ensure(a);await Promise.resolve();loader.ensure(b);await Promise.resolve();
  fresh.resolve(response({a:{city:'高雄市',region:'左營區'}}));await loader.state(b).promise;
  old.resolve(response({a:loc}));await loader.state(a).promise;
  assert.equal(loader.state(b).locations.get('a').city,'高雄市');
});
test('missing response keys fail closed; explicit cleared geography is valid',async()=>{
  const snapshot={players:[{uid:'a'}]};
  for(const result of [{ok:true,version:1,locations:{}},{ok:false},{ok:true,version:99,locations:{a:loc}}]){
    const loader=createLoader(async()=>result,()=>{});await loader.ensure(snapshot).promise;assert.equal(loader.state(snapshot).status,'error');
  }
  const loader=createLoader(async()=>response({a:{city:'',region:''}}),()=>{});await loader.ensure(snapshot).promise;assert.equal(loader.state(snapshot).status,'ready');
});
test('member location display uses latest combined region and clears a stale city',()=>{
  const ctx=sandbox(createLoader(()=>{},()=>{}));
  ctx.profile={city:'高雄市',region:'台南市 仁德區'};assert.deepEqual(plain(vm.runInContext('profileLocationParts(profile)',ctx)),loc);
  ctx.profile.region='';assert.deepEqual(plain(vm.runInContext('profileLocationParts(profile)',ctx)),{city:'',region:''});
});
test('city-only filter and district filter handle several members and shared district names',async()=>{
  const loader=createLoader(async()=>response({a:loc,b:{city:'台南市',region:'東區'},c:{city:'新竹市',region:'東區'},d:{city:'',region:''}}),()=>{}),ctx=sandbox(loader);
  ctx.rows=['a','b','c','d'].map(uid=>({uid,seasonPoints:10}));ctx.ladderPublicData={players:ctx.rows};
  vm.runInContext('ladderLocationCity="臺南市"',ctx);loader.ensure(ctx.ladderPublicData);await loader.state(ctx.ladderPublicData).promise;
  assert.deepEqual(plain(vm.runInContext('ladderLocationRows(rows).map(p=>p.uid)',ctx)),['a','b']);
  vm.runInContext('ladderLocationRegion="東區"',ctx);assert.deepEqual(plain(vm.runInContext('ladderLocationRows(rows).map(p=>p.uid)',ctx)),['b']);
});
test('guest renderer uses the same regional filter, notice, and local ranking',()=>{
  const guest=between('function renderGuestLadder(){','function applyGuestLadderFilter(){');
  assert(guest.includes('rankLadderRows(ladderLocationRows('));
  assert(guest.includes('${ladderLocationFilterHtml()}'));
  const renderer=between('function guestLadderRowsHtml(rows){','function renderGuestLadder(){');
  assert(renderer.includes('ladderLocationNoticeHtml()'));
});
test('cloud adapter calls only the bounded location reader and preserves failures',async()=>{
  const cloud=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
  const method=cloud.slice(cloud.indexOf('async getLadderLocations('),cloud.indexOf('async getLadderSnapshot('));
  const calls=[],ctx={cloudEnabled:true,functionsHandle:{},fnx:{httpsCallable:(handle,name,options)=>{
    calls.push({name,options});return async data=>{calls.push(data);return {data:response({a:loc})};};
  }}};
  vm.createContext(ctx);vm.runInContext('adapter={'+method+'}',ctx);
  assert.deepEqual(plain(await ctx.adapter.getLadderLocations(['a'])),response({a:loc}));
  assert.deepEqual(plain(calls),[{name:'ladderLocationService',options:{timeout:15000}},{uids:['a']}]);
  ctx.cloudEnabled=false;await assert.rejects(ctx.adapter.getLadderLocations(['a']),/cloud-unavailable/);
  assert.equal(calls.length,2);
});

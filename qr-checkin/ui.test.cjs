'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(url='https://arena.bxh.com.tw/?checkin=BXH-ABC123&checkinToken=test') {
 let uid='u1',handler,resolve,reject;
 const tasks=[],calls=[],location={href:url},loginNotice={hidden:true};
 const sandbox={URL,Date,crypto:require('node:crypto').webcrypto,location,history:{replaceState(a,b,url){location.href=url;}},document:{getElementById(id){return id==='qr-checkin-login-notice'?loginNotice:null;},addEventListener(type,fn){handler=fn;}},setTimeout(fn){tasks.push(fn);return tasks.length;},clearTimeout(){},window:{engagementService:{tournamentOperation(name,data){calls.push({name,data});return new Promise((r,j)=>{resolve=r;reject=j;});}}}};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(__dirname+'/../modules/main-app/qr-checkin.js','utf8'),sandbox);
 const feature=sandbox.window.BXHQrCheckin;
 function bind(){feature.bind({state:()=>({cloudCode:'BXH-ABC123'}),uid:()=>uid,render(){},toast(){},qr(){}});}
 bind();
 return {feature,calls,tasks,location,loginNotice,setUid(value){uid=value;bind();},complete(result){resolve(result);},fail(error){reject(error);},handler:()=>handler};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('logged-in QR visitor auto-submits once without confirmation button',async()=>{
 const x=setup();x.tasks.shift()();await flush();assert.equal(x.calls.length,1);assert.equal(x.calls[0].data.action,'scan');
 x.complete({ok:true,name:'選手一',eventName:'測試賽',code:'BXH-ABC123',currentAt:1800000000000});await flush();
 assert.match(x.feature.renderEntry(),/報到成功/);assert.match(x.feature.renderEntry(),/測試賽/);assert.equal(new URL(x.location.href).searchParams.has('checkinToken'),false);
});
test('while request is pending no success can be rendered',async()=>{
 const x=setup();x.tasks.shift()();await flush();assert.match(x.feature.renderEntry(),/正在確認報到/);assert.doesNotMatch(x.feature.renderEntry(),/報到成功/);
});
test('not logged in shows login instruction and never calls scan',()=>{
 const x=setup();x.setUid(null);for(const fn of x.tasks)fn();assert.equal(x.calls.length,0);assert.match(x.feature.renderEntry(),/請先登入/);
});
test('old account response is discarded after logout',async()=>{
 const x=setup();x.tasks.shift()();await flush();x.setUid(null);x.complete({ok:true,name:'PRIVATE NAME'});await flush();assert.doesNotMatch(x.feature.renderEntry(),/PRIVATE NAME/);
});
test('repeat scan displays original time and already-completed text',async()=>{
 const x=setup();x.tasks.shift()();await flush();x.complete({ok:true,already:true,name:'選手',currentAt:1800000000000});await flush();assert.match(x.feature.renderEntry(),/您已完成報到/);
});
test('untrusted display names are escaped in success screen',async()=>{
 const x=setup();x.tasks.shift()();await flush();x.complete({ok:true,name:'<img src=x onerror=alert(1)>',currentAt:1800000000000});await flush();assert.doesNotMatch(x.feature.renderEntry(),/<img/);assert.match(x.feature.renderEntry(),/&lt;img/);
});
test('history distinguishes player and operator accounts and escapes both',async()=>{
 const x=setup('https://arena.bxh.com.tw/');
 const pending=x.handler()({target:{closest:()=>({dataset:{qrCheckin:'open'}})},preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(x.calls[0].data.action,'status');x.complete({enabled:false});await flush();
 assert.equal(x.calls[1].data.action,'history');x.complete({records:[{playerId:'p1',name:'選手',accountUid:'<player>',actorUid:'<staff>',action:'manual',at:1800000000000}]});await pending;
 const html=x.feature.renderModal();assert.match(html,/選手帳號：&lt;player&gt;/);assert.match(html,/操作帳號：&lt;staff&gt;/);assert.doesNotMatch(html,/<player>|<staff>/);
});

test('real-shell login notice follows pending QR and authenticated identity independently of app rendering',()=>{
 const x=setup();assert.equal(x.loginNotice.hidden,true);
 x.setUid(null);assert.equal(x.loginNotice.hidden,false);
 x.setUid('u1');assert.equal(x.loginNotice.hidden,true);
 const normal=setup('https://arena.bxh.com.tw/');normal.setUid(null);assert.equal(normal.loginNotice.hidden,true);
});

test('in-app QR uses the existing account without a page navigation',async()=>{
 const x=setup('https://arena.bxh.com.tw/?watch=BXH-OTHER');
 assert.equal(x.feature.acceptUrl('https://arena.bxh.com.tw/?checkin=BXH-ABC123&checkinToken=onsite'),true);
 x.feature.bind({state:()=>({cloudCode:'BXH-ABC123'}),uid:()=> 'u1',render(){},toast(){},qr(){}});
 for(const fn of x.tasks.splice(0))fn();await flush();
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].data.token,'onsite');
 x.complete({ok:true,name:'選手',currentAt:1800000000000});await flush();assert.match(x.feature.renderEntry(),/報到成功/);
});
test('scanned credentials reject foreign origins, missing tokens and oversized tokens',()=>{
 const x=setup('https://arena.bxh.com.tw/');
 for(const url of ['https://evil.test/?checkin=BXH-ABC123&checkinToken=test','https://arena.bxh.com.tw/?checkin=BXH-ABC123','https://arena.bxh.com.tw/?checkin=bad&checkinToken=test','https://arena.bxh.com.tw/?checkin=BXH-ABC123&checkinToken='+ 'a'.repeat(2049)]){
  assert.equal(x.feature.acceptUrl(url),false);assert.equal(x.location.href,'https://arena.bxh.com.tw/');
 }
 assert.equal(x.calls.length,0);
});
test('unauthenticated in-app QR waits for login then continues',async()=>{
 const x=setup('https://arena.bxh.com.tw/');x.setUid(null);
 assert.equal(x.feature.acceptUrl('https://arena.bxh.com.tw/?checkin=BXH-ABC123&checkinToken=onsite'),true);
 for(const fn of x.tasks.splice(0))fn();assert.equal(x.calls.length,0);
 x.setUid('u2');for(const fn of x.tasks.splice(0))fn();await flush();assert.equal(x.calls.length,1);
});
test('busy submission rejects another credential without replacing pending URL',async()=>{
 const x=setup();x.tasks.shift()();await flush();const original=x.location.href;
 assert.equal(x.feature.acceptUrl('https://arena.bxh.com.tw/?checkin=BXH-ABC123&checkinToken=other'),false);
 assert.equal(x.location.href,original);assert.equal(x.calls.length,1);
});

test('App Check failure tells a scanning player to retry verification without claiming missing manager rights',async()=>{
 const x=setup();x.tasks.shift()();await flush();
 const error=new Error('網站驗證未完成，請重新嘗試。 functions/permission-denied');
 error.code='functions/permission-denied';error.details={reason:'app-check-unavailable'};x.fail(error);await flush();
 const html=x.feature.renderEntry();assert.match(html,/網站驗證未完成/);assert.doesNotMatch(html,/管理權限|報到成功/);
});
test('generic permission denial during scan does not diagnose manager rights or mark attendance',async()=>{
 const x=setup();x.tasks.shift()();await flush();const error=new Error('permission-denied');error.code='functions/permission-denied';x.fail(error);await flush();
 const html=x.feature.renderEntry();assert.match(html,/報到請求未通過驗證/);assert.doesNotMatch(html,/管理權限|報到成功/);
 assert.equal(new URL(x.location.href).searchParams.has('checkinToken'),true);
 const pending=x.handler()({target:{closest:()=>({dataset:{qrCheckin:'retry'}})},preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(x.calls.length,2);assert.equal(x.calls[1].data.action,'scan');
 x.complete({ok:true,name:'選手',currentAt:1800000000000});await pending;assert.match(x.feature.renderEntry(),/報到成功/);
});
test('manager permission denial keeps the management-specific explanation',async()=>{
 const x=setup('https://arena.bxh.com.tw/');
 const pending=x.handler()({target:{closest:()=>({dataset:{qrCheckin:'open'}})},preventDefault(){},stopImmediatePropagation(){}});
 x.fail(new Error('permission-denied'));await pending;assert.match(x.feature.renderModal(),/您沒有本場報到管理權限/);
});
test('manager App Check failure is distinguished from missing manager rights',async()=>{
 const x=setup('https://arena.bxh.com.tw/');
 const pending=x.handler()({target:{closest:()=>({dataset:{qrCheckin:'open'}})},preventDefault(){},stopImmediatePropagation(){}});
 const error=new Error('permission-denied');error.details={reason:'app-check-unavailable'};x.fail(error);await pending;
 assert.match(x.feature.renderModal(),/網站驗證未完成/);assert.doesNotMatch(x.feature.renderModal(),/您沒有本場報到管理權限/);
});

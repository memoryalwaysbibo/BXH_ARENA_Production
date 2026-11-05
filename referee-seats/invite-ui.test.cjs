'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const {communityFixture}=require('./test-harness.cjs');
function ui(h){
 let actor=null,listener,location=new URL('https://arena.test/'),opens=[],calls=[],rendered='';
 const window={crypto,location,history:{replaceState:(_,__,href)=>{location=new URL(href);window.location=location;}},cloudSync:{manageRefereeSeats:async d=>{calls.push({...d});try{return await h.handle({auth:{uid:actor},data:d});}catch(e){return {ok:false,reason:e.message};}}}};
 const c={window,document:{addEventListener:(name,fn)=>{listener=fn;}},URL,URLSearchParams,setTimeout,clearTimeout,Date};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../modules/main-app/community-referee-invite.js','utf8'),c);
 const api=window.BXHCommunityRefereeInvite;
 const ctx={state:()=>JSON.parse(h.doc().data),uid:()=>actor,inviter:()=>actor==='host',render:()=>{api.bind(ctx);rendered=api.renderEntry();},open:async(code,station)=>{opens.push({code,station});},toast:()=>{}};
 ctx.render();
 return {api,window,calls,opens,html:()=>rendered,login:uid=>{actor=uid;ctx.render();},click:async action=>{listener({target:{closest:()=>({dataset:{refInvite:action}})},preventDefault(){},stopImmediatePropagation(){}});for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));ctx.render();}};
}
async function fixture(){const h=communityFixture();await h.run('host','enable');const q=await h.run('host','create-qr',{station:1,slot:'main',expectedCourtRevision:0});return {h,url:'https://arena.test/#'+new URLSearchParams({referee:'BXH-TEST',invite:q.requestId,token:q.qrToken})};}
test('QR survives login, previews without claiming, then confirms through actual service and enters the court',async()=>{
 const {h,url}=await fixture(),u=ui(h);assert(u.api.acceptUrl(url));assert.equal(u.html(),'');u.login('main');assert.match(u.html(),/讀取邀請/);
 await u.click('inspect');assert.match(u.html(),/1 號台｜主裁判/);assert.equal(h.doc().refereeSeatsV1.courts[1].main,null);
 await u.click('accept');assert.equal(h.doc().refereeSeatsV1.courts[1].main.uid,'main');assert.equal(u.opens.length,1);assert.equal(u.html(),'');assert.equal(u.window.location.hash,'');
});
test('QR rejects foreign origin, malformed tokens and ordinary check-in URLs',async()=>{
 const {h,url}=await fixture(),u=ui(h);for(const raw of [url.replace('arena.test','evil.test'),url.replace('token=','other='),'https://arena.test/?checkin=BXH-TEST&checkinToken=abc'])assert.equal(u.api.parseUrl(raw),null);
 assert(u.api.parseUrl(url));
});
test('acceptance response loss keeps the same operation and never assigns the seat twice',async()=>{
 const {h,url}=await fixture(),u=ui(h);u.login('main');u.api.acceptUrl(url);await u.click('inspect');const original=u.window.cloudSync.manageRefereeSeats;let lost=true;
 u.window.cloudSync.manageRefereeSeats=async d=>{const result=await original(d);if(d.action==='accept-qr'&&lost){lost=false;return {ok:false,reason:'cloud-unavailable'};}return result;};
 await u.click('accept');assert.equal(u.opens.length,0);const revision=h.doc().refereeSeatsV1.revision;
 await u.click('accept');assert.equal(u.opens.length,1);assert.equal(h.doc().refereeSeatsV1.revision,revision);
 const accepts=u.calls.filter(x=>x.action==='accept-qr');assert.equal(accepts.length,2);assert.equal(accepts[0].operationId,accepts[1].operationId);
});
test('ended event shows only result and confirmation; no accept or inspect action remains',async()=>{
 const {h,url}=await fixture(),u=ui(h);h.doc().tournamentPhase='done';u.login('main');u.api.acceptUrl(url);await u.click('inspect');assert.match(u.html(),/比賽已有結果/);assert.doesNotMatch(u.html(),/data-ref-invite="(?:accept|inspect)"/);await u.click('dismiss');assert.equal(u.html(),'');
});
test('late preview cannot cross a logout and login to the same account',async()=>{
 const {h,url}=await fixture(),u=ui(h);u.login('main');u.api.acceptUrl(url);let release;const original=u.window.cloudSync.manageRefereeSeats;
 u.window.cloudSync.manageRefereeSeats=async d=>{const result=await original(d);await new Promise(resolve=>{release=resolve;});return result;};
 await u.click('inspect');assert(release);u.login(null);u.login('main');release();await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(u.html(),/data-ref-invite="accept"/);assert.equal(h.doc().refereeSeatsV1.courts[1].main,null);
});

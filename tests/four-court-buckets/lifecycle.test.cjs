'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../../modules/scoring/four-court-lifecycle.cjs');
const marker=(code='BXH-LIFE6',epoch='epoch-1')=>({schema:'bxh-match-buckets-v1',status:'active',code,epoch});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(extra={}){
 const auth={currentUser:{uid:'ref1'}},identities=new Set(),sessions=[],statuses=[];
 const authApi={onAuthStateChanged(a,cb){identities.add(cb);return ()=>identities.delete(cb);}};
 const sessionFactory=options=>{const item={options,stopped:false,connects:0,disconnects:0,pending:[],client:{getView:()=>({pending:item.pending}),connect(){item.connects++;options.onView({status:'syncing',state:null});},disconnect(){item.disconnects++;options.onView({status:'offline',state:null});}},start(host){host.cloudSync={commitRefereeCommand:async data=>({ok:true,code:data.code}),manageRefereeSeats:async()=>({ok:true})};},stop(){item.stopped=true;}};sessions.push(item);return item;};
 const controller=create({enabled:true,auth,authApi,sessionFactory,onStatus:v=>statuses.push(v),...extra});
 return {controller,auth,sessions,statuses,identity(uid){auth.currentUser=uid?{uid}:null;for(const cb of [...identities])cb(auth.currentUser);},ready(index=0){const s=sessions[index];s.options.onView({status:'ready',state:{}});s.options.onState({id:'room-'+s.options.code,cloudCode:s.options.code,meta:{},matches:[{id:'m1',scoreA:1}]});}};
}
test('default closed rollout and malformed markers cannot create sessions or run App Check',async()=>{
 let checks=0;const h=harness({enabled:false,ensureAppCheck:async()=>checks++});const stop=h.controller.subscribe('BXH-LIFE6',()=>assert.fail('closed state leaked'));
 h.controller.observe('BXH-LIFE6',marker());await tick();assert.equal(h.sessions.length,0);assert.equal(checks,0);assert.equal(h.statuses.at(-1).reason,'bucket-client-disabled');stop();h.controller.dispose();
 const bad=harness();bad.controller.observe('BXH-LIFE6',{});await tick();assert.equal(bad.sessions.length,0);assert.equal(bad.statuses.at(-1).reason,'bucket-not-ready');bad.controller.dispose();
});
test('switch/epoch/auth cancellation rejects delayed setup and every stale callback',async()=>{
 let finish;const h=harness({ensureAppCheck:()=>new Promise(resolve=>finish=resolve)}),states=[];
 const stop=h.controller.subscribe('BXH-LIFE6',s=>states.push(s));h.controller.observe('BXH-LIFE6',marker());await tick();const oldFinish=finish;
 h.controller.observe('BXH-LIFE6',marker('BXH-LIFE6','epoch-2'));await tick();oldFinish();await tick();assert.equal(h.sessions.length,0);finish();await tick();h.ready();assert.equal(states.length,1);
 const old=h.sessions[0];h.controller.observe('BXH-LIFE6',marker('BXH-LIFE6','epoch-3'));assert(old.stopped);old.options.onState({cloudCode:'BXH-LIFE6',matches:['stale']});assert.equal(states.length,1);
 await tick();h.identity('ref5');finish();await tick();assert.equal(h.sessions.length,1);assert.equal(h.statuses.at(-1).reason,'auth-changed');assert.equal(h.statuses.at(-1).clear,true);stop();h.controller.dispose();
});
test('primary unsubscribe closes the session; page restoration reconnects the same pending intentions',async()=>{
 const h=harness(),seen=[];let stop=h.controller.subscribe('BXH-LIFE6',v=>seen.push(v));const seat=h.controller.subscribe('BXH-LIFE6',()=>{},{primary:false});h.controller.observe('BXH-LIFE6',marker());await tick();h.ready();
 h.sessions[0].pending=['score:m1'];h.controller.suspend();assert.equal(h.sessions[0].stopped,false);assert.equal(h.sessions[0].disconnects,1);h.controller.resume();await tick();assert.equal(h.sessions.length,1);assert.equal(h.sessions[0].connects,1);assert.equal(h.controller.view('BXH-LIFE6').status,'syncing');h.ready();assert.deepEqual(h.sessions[0].pending,['score:m1']);
 stop();assert(h.sessions[0].stopped);assert.equal(h.controller.view('BXH-LIFE6'),null);assert.equal((await h.controller.command({code:'BXH-LIFE6'},'commitRefereeCommand')).ok,false);seat();h.controller.dispose();
});
test('preview reads use a separate temporary session and preserve the active room',async()=>{
 const h=harness(),stop=h.controller.subscribe('BXH-LIFE6',()=>{});h.controller.observe('BXH-LIFE6',marker());await tick();h.ready();
 const pending=h.controller.read('BXH-LIFE12',marker('BXH-LIFE12'));await tick();h.ready(1);const result=await pending;assert.equal(result.data.cloudCode,'BXH-LIFE12');assert(h.sessions[1].stopped);assert.equal(h.sessions[0].stopped,false);assert.equal(h.controller.view('BXH-LIFE6').status,'ready');
 assert.equal((await h.controller.command({code:'BXH-LIFE6'},'commitRefereeCommand')).ok,true);stop();h.controller.dispose();
});
test('served browser bundle loads without Firebase side effects and exposes the same lifecycle API',()=>{
 const sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('../../modules/scoring/four-court-browser.js'),'utf8'),sandbox);assert.equal(typeof sandbox.BXHFourCourtLifecycle.create,'function');assert.equal(typeof sandbox.BXHFourCourtSession.create,'function');assert.equal(sandbox.BXHMatchBuckets.route(5,12),'court-2');
});
test('recovery reads cannot replace a failed session with unresolved commands; explicit reconnect keeps it',async()=>{
 const h=harness(),stop=h.controller.subscribe('BXH-LIFE6',()=>{});h.controller.observe('BXH-LIFE6',marker());await tick();h.ready();h.sessions[0].pending=['score:m1'];h.sessions[0].options.onView({status:'error',state:{},pending:['score:m1']});
 assert.equal((await h.controller.read('BXH-LIFE6',marker())).reason,'bucket-operation-unresolved');assert.equal(h.sessions.length,1);assert.equal(h.sessions[0].stopped,false);assert.equal(h.controller.reconnect('BXH-LIFE6').ok,true);assert.deepEqual(h.sessions[0].pending,['score:m1']);stop();h.controller.dispose();
});

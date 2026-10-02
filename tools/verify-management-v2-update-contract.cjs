'use strict';
// Runs the actual entrypoint update IIFE in a Node VM with test doubles.
// This is a logic/asset-boundary test, NOT browser cache, PWA or device acceptance.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(process.env.BXH_PILOT_ROOT||path.join(__dirname,'..'));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const blocks=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
const guards=blocks.filter(x=>x.includes('(function bxhFreshVersionGuard(){'));
assert.equal(guards.length,1,'Exactly one canonical update guard must exist');
const guard=guards[0],build=guard.match(/var CURRENT_BUILD="([^"]+)";/)?.[1];
assert.ok(build,'Cannot determine update guard build');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
  let now=1000000,reply=options.reply||{build},pendingBody=!!options.pendingBody;
  const ids=new Map(),listeners=new Map(),requests=[],redirects=[],timers=[];
  const session=new Map(),local=new Map([['bxh:management-interface','v2'],['keep-login','sentinel']]);
  function storage(map){return {getItem(k){if(options.storageDenied)throw Error('storage denied');return map.get(k)||null;},setItem(k,v){if(options.storageDenied)throw Error('storage denied');map.set(k,String(v));}};}
  function element(tag){return {tag,children:[],style:{},setAttribute(){},appendChild(el){el.parent=this;this.children.push(el);if(el.id)ids.set(el.id,el);},remove(){if(this.id)ids.delete(this.id);if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}};}
  function bind(target,type,fn){const key=target+':'+type;if(!listeners.has(key))listeners.set(key,[]);listeners.get(key).push(fn);}
  const body=element('body');
  const doc={baseURI:'https://arena.bxh.com.tw/',hidden:false,body:pendingBody?null:body,
    getElementById:id=>ids.get(id)||null,createElement:element,addEventListener:(t,f)=>bind('document',t,f)};
  const location={href:'https://arena.bxh.com.tw/?room=BXH-TEST&keep=1#referee',replace:url=>redirects.push(url),reload:()=>redirects.push('reload')};
  const context={URL,location,document:doc,sessionStorage:storage(session),localStorage:storage(local),
    Date:class extends Date {static now(){return now;}},setInterval:(fn,ms)=>{timers.push({fn,ms});},
    fetch:async(url,settings)=>{requests.push({url,settings});if(reply instanceof Error)throw reply;if(typeof reply==='function')return reply();return {ok:true,json:async()=>reply};}};
  context.window={addEventListener:(t,f)=>bind('window',t,f)};
  vm.runInNewContext(guard,context,{timeout:1000,filename:'index-update-guard.js'});
  return {requests,redirects,session,local,timers,doc,context,
    banner:()=>ids.get('bxh-update-banner'),setReply:x=>{reply=x;},advance:ms=>{now+=ms;},
    async emit(target,type){for(const fn of listeners.get(target+':'+type)||[])fn();await flush();},
    async ready(){doc.body=body;await this.emit('window','DOMContentLoaded');}};
}

test('document, update IIFE and version.json use the same build',()=>{
  assert.equal(html.match(/<meta name="bxh-build" content="([^"]+)"/)?.[1],build);
  assert.equal(JSON.parse(read('version.json')).build,build);
});
test('same build does not announce an update; file-path changes alone are insufficient',async()=>{
  const h=harness();await h.emit('window','pageshow');assert.equal(h.requests.length,1);assert.equal(h.banner(),undefined);assert.deepEqual(h.redirects,[]);
});
test('different build shows one banner without automatic navigation',async()=>{
  const h=harness({reply:{build:'m1-test-new-build'}});await h.emit('window','pageshow');await h.emit('window','pageshow');
  assert.ok(h.banner());assert.equal(h.doc.body.children.length,1);assert.deepEqual(h.redirects,[]);
});
test('manual update preserves room, query, hash and local preference',async()=>{
  const h=harness({reply:{build:'m1-test-new-build'}});await h.emit('window','pageshow');
  const button=h.banner().children[1];button.onclick();const url=new URL(h.redirects[0]);
  assert.equal(url.origin,'https://arena.bxh.com.tw');assert.equal(url.searchParams.get('room'),'BXH-TEST');
  assert.equal(url.searchParams.get('keep'),'1');assert.equal(url.hash,'#referee');
  assert.equal(url.searchParams.get('bxh_build'),'m1-test-new-build');assert.ok(url.searchParams.get('bxh_force'));
  assert.equal(h.local.get('bxh:management-interface'),'v2');assert.equal(h.local.get('keep-login'),'sentinel');
  assert.equal(h.banner(),undefined);assert.equal(button.disabled,true);
});
test('version requests bypass fetch cache and remain same-origin',async()=>{
  const h=harness();await h.emit('window','pageshow');const r=h.requests[0],url=new URL(r.url);
  assert.equal(url.origin,'https://arena.bxh.com.tw');assert.equal(url.pathname,'/version.json');assert.ok(url.searchParams.get('_'));
  assert.equal(r.settings.cache,'no-store');assert.equal(r.settings.credentials,'same-origin');
});
test('network failure is non-blocking and the next forced check recovers',async()=>{
  const h=harness({reply:Error('offline')});await h.emit('window','pageshow');assert.equal(h.banner(),undefined);assert.deepEqual(h.redirects,[]);
  h.setReply({build:'m1-test-new-build'});await h.emit('window','pageshow');assert.ok(h.banner());assert.equal(h.requests.length,2);
});
test('HTTP errors and invalid JSON do not trigger navigation',async()=>{
  const h=harness({reply:()=>({ok:false,json:async()=>{throw Error('must not parse');}})});await h.emit('window','pageshow');
  h.setReply(()=>({ok:true,json:async()=>{throw Error('invalid JSON');}}));await h.emit('window','pageshow');
  assert.equal(h.banner(),undefined);assert.deepEqual(h.redirects,[]);
});
test('denied session storage does not prevent explicit update',async()=>{
  const h=harness({storageDenied:true,reply:{build:'m1-test-new-build'}});await h.emit('window','pageshow');
  assert.ok(h.banner());h.banner().children[1].onclick();assert.equal(h.redirects.length,1);
});
test('a missing document body defers the banner until DOMContentLoaded',async()=>{
  const h=harness({pendingBody:true,reply:{build:'m1-test-new-build'}});await h.emit('window','pageshow');
  assert.equal(h.banner(),undefined);await h.ready();assert.ok(h.banner());assert.deepEqual(h.redirects,[]);
});
test('focus checks are throttled while forced visibility checks can refresh',async()=>{
  const h=harness();await h.emit('window','pageshow');await h.emit('window','focus');assert.equal(h.requests.length,1);
  h.advance(60000);await h.emit('window','focus');assert.equal(h.requests.length,2);
  await h.emit('document','visibilitychange');assert.equal(h.requests.length,3);
});
test('recent update attempts suppress repeated banners for fifteen seconds',async()=>{
  const h=harness({reply:{build:'m1-test-new-build'}});h.session.set('bxh_update_attempt_m1-test-new-build','1000000');
  await h.emit('window','pageshow');assert.equal(h.banner(),undefined);h.advance(15001);
  await h.emit('window','pageshow');assert.ok(h.banner());
});
test('PWA manifest and push worker/registration are unchanged; no new offline-shell promise',()=>{
  const pinned={'manifest.webmanifest':'d97d03b6634567d66d9249706b2a5608a92350ac','firebase-messaging-sw.js':'f5c3e973080bdc772169f5ff79e3750c0c6469a1','court-call-ui.js':'d51843ec769e6043f023e70344c656c4e882bed9'};
  for(const [name,expected] of Object.entries(pinned)){
    const bytes=fs.readFileSync(path.join(root,name));
    assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),expected,name);
  }
  const manifest=JSON.parse(read('manifest.webmanifest'));assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
  assert.match(read('court-call-ui.js'),/register\('\/firebase-messaging-sw\.js',\{scope:'\/',updateViaCache:'none'\}\)/);
  for(const match of html.matchAll(/(?:src|href)="(modules\/management-v2\/[^"?]+)(?:\?[^"\s]+)?"/g)){
    const url=new URL(match[1],'https://arena.bxh.com.tw/');assert.equal(url.origin,'https://arena.bxh.com.tw');assert.ok(fs.existsSync(path.join(root,match[1])));
  }
});

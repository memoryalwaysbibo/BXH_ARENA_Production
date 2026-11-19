import {test} from 'node:test';import assert from 'node:assert/strict';import {bindSpectatorLifecycle} from './browser-lifecycle.mjs';
test('DOM lifecycle binding scopes hide/show/router/identity and unregisters',async()=>{
 const window=new EventTarget(),document=new EventTarget();document.hidden=false;const calls=[];let closes=0,route='spectator',identity='guest';
 const binding=bindSpectatorLifecycle({window,document,spectator:{async setContext(c){calls.push(c);},close(){closes++;}},context:()=>({route,identity,room:'lab96',epoch:'e-lab96'})});
 await binding.sync();assert.equal(calls.at(-1).hidden,false);
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(calls.at(-1).hidden,true);
 document.hidden=false;window.dispatchEvent(new Event('pagehide'));assert.equal(calls.at(-1).hidden,true);
 window.dispatchEvent(new Event('pageshow'));assert.equal(calls.at(-1).hidden,false);
 route='referee';window.dispatchEvent(new Event('spectator-route-change'));assert.equal(calls.at(-1).route,'referee');
 identity='changed';window.dispatchEvent(new Event('spectator-identity-change'));assert.equal(calls.at(-1).identity,'changed');
 window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('popstate'));const n=calls.length;
 binding.dispose();window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));assert.equal(calls.length,n);assert.equal(closes,1);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {load,render}=require('./team-card.js');const esc=x=>String(x).replace(/</g,'&lt;').replace(/>/g,'&gt;');
test('card uses only verified public fields and safely renders the team',async()=>{
 let payload;const info=await load({uid:'player',read:async p=>(payload=p,{team:{id:'t',name:'<隊伍>',role:'deputy',level:7,selectedFrame:7,secret:'PRIVATE'}})});
 assert.deepEqual(payload,{action:'card-team',targetUid:'player'});const html=render(info,esc);assert.match(html,/&lt;隊伍&gt;/);assert.match(html,/副隊長/);assert.match(html,/team-frame-7/);assert.doesNotMatch(html,/PRIVATE/);
});
test('no-team and unavailable lookups remain distinct',async()=>{
 const none=await load({uid:'u',read:async()=>({team:null})});assert.match(render(none,esc),/尚未加入戰隊/);assert.match(render(none,esc),/前往戰隊大廳/);
 const error=await load({uid:'u',read:async()=>{throw Error('denied');}});assert.equal(render(error,esc),'');
 assert.equal((await load({uid:'bad/id',read:async()=>{throw Error('must not call');}})).state,'unavailable');
});

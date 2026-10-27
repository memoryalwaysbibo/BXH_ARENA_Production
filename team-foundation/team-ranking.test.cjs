'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {create}=require('./team-ranking.js');
const esc=x=>String(x).replace(/</g,'&lt;').replace(/>/g,'&gt;');
test('ranking loads only after signed-in render, shows partial warning and escapes names',async()=>{
 let uid=null,calls=0;const c=create({identity:()=>uid,read:async()=>{calls++;return {items:[{rank:1,name:'<隊>',captainName:'A',memberCount:2,strength:500}],total:1,partial:true,excluded:1};}});
 assert.match(c.render(esc),/請先登入/);assert.equal(calls,0);uid='u';c.render(esc);await new Promise(setImmediate);const html=c.render(esc);assert.equal(calls,1);assert.match(html,/&lt;隊&gt;/);assert.match(html,/名次可能變動/);
});
test('changing account before response discards old ranking',async()=>{
 let uid='a',resolve;const c=create({identity:()=>uid,read:()=>new Promise(r=>{resolve=r;})});c.render(esc);await Promise.resolve();uid=null;resolve({items:[{name:'OLD'}],total:1,excluded:0});await new Promise(setImmediate);assert.match(c.render(esc),/請先登入/);assert.doesNotMatch(c.render(esc),/OLD/);
});
test('first render defers change notification and ignores a queued load after account switch',async()=>{
 let uid='a',calls=0,changes=0;const c=create({identity:()=>uid,read:async()=>{calls++;return {items:[],total:0,excluded:0};},onChange:()=>{changes++;c.render(esc);}});
 c.render(esc);assert.equal(changes,0);uid='b';c.render(esc);await new Promise(setImmediate);
 assert.equal(calls,1);assert.ok(changes>=1);
});
test('ranking displays known frame variants without accepting arbitrary classes',async()=>{
 const c=create({identity:()=> 'u',read:async()=>({items:[{rank:1,name:'A',captainName:'C',memberCount:2,strength:5,selectedFrame:4},{rank:2,name:'B',captainName:'C',memberCount:2,strength:4,selectedFrame:'evil'}],total:2,excluded:0})});
 c.render(esc);await new Promise(setImmediate);const html=c.render(esc);assert.match(html,/team-identity team-frame-4/);assert.doesNotMatch(html,/team-frame-evil/);
});

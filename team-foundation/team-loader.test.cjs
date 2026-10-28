'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');const code=fs.readFileSync(__dirname+'/team-loader.js','utf8');
function fixture(flag){const paths=[];let renders=0;const window={BXH_TEAM_PREVIEW:flag,console:{warn(){}}};const document={createElement:()=>({}),head:{appendChild:s=>{paths.push(s.src);queueMicrotask(()=>s.onload());}}};vm.runInNewContext(code,{window,document,Promise,render:()=>renders++});return {paths,get renders(){return renders;},window};}
test('disabled loader requests no team files',async()=>{const f=fixture(false);await new Promise(setImmediate);assert.deepEqual(f.paths,[]);assert.equal(f.renders,0);});
test('enabled loader requests files in dependency order then refreshes navigation',async()=>{const f=fixture(true);await new Promise(setImmediate);assert.equal(f.paths.length,10);assert.match(f.paths[0],/team-api\.js/);assert.match(f.paths[3],/team-emblem\.js/);assert.match(f.paths[8],/team-card\.js/);assert.match(f.paths[9],/team-main-integration\.js/);assert.equal(f.renders,1);});
test('a failed module load stops remaining downloads and does not refresh navigation',async()=>{
 const paths=[],warnings=[];let renders=0;const window={BXH_TEAM_PREVIEW:true,console:{warn:m=>warnings.push(m)}};
 const document={createElement:()=>({}),head:{appendChild:s=>{paths.push(s.src);queueMicrotask(()=>paths.length===2?s.onerror():s.onload());}}};
 vm.runInNewContext(code,{window,document,Promise,render:()=>renders++});await new Promise(setImmediate);
 assert.equal(paths.length,2);assert.equal(renders,0);assert.deepEqual(warnings,['戰隊功能暫時無法載入']);
});
test('turning the flag off during loading stops the rest of the downloads',async()=>{
 const paths=[];let renders=0;const window={BXH_TEAM_PREVIEW:true,console:{warn(){}}};
 const document={createElement:()=>({}),head:{appendChild:s=>{paths.push(s.src);queueMicrotask(()=>{window.BXH_TEAM_PREVIEW=false;s.onload();});}}};
 vm.runInNewContext(code,{window,document,Promise,render:()=>renders++});await new Promise(setImmediate);
 assert.equal(paths.length,1);assert.equal(renders,0);
});

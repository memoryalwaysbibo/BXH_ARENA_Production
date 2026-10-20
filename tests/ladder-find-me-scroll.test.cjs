"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../ladder-secondary-ui.js"),"utf8");
const start=source.indexOf("  function ladderScrollToRankRow(");
const end=source.indexOf("\n  function rerender(){",start);
assert.ok(start>=0&&end>start,"rank scroll helper must exist");
const helper=source.slice(start,end);

function setup(nested,blocked){
  const notices=[];
  const timers=[];
  const root={scrollTop:0,scrollHeight:1800,clientHeight:500};
  const scroller={className:"leaderboard-scroller",scrollTop:0,scrollHeight:1800,clientHeight:500,
    getBoundingClientRect:()=>({top:40,bottom:540,height:500}),
    scrollTo({top}){if(!blocked)this.scrollTop=top;}};
  const row={isConnected:true,parentElement:nested?scroller:null,
    getBoundingClientRect(){const pos=900-(nested?scroller.scrollTop:root.scrollTop);return {top:pos,bottom:pos+50,height:50};}};
  scroller.parentElement=null;
  const context={document:{scrollingElement:root,documentElement:root,body:{}},
    window:{innerHeight:500,scrollY:0,getComputedStyle:()=>({overflowY:"auto"}),
      scrollTo({top}){if(!blocked){root.scrollTop=top;this.scrollY=top;}},
      setTimeout(fn){timers.push(fn);}},
    showToast(msg){notices.push(msg)},console:{warn(){}}
  };
  vm.createContext(context);
  vm.runInContext(helper,context);
  return {context,row,root,scroller,timers,notices,flush(){while(timers.length)timers.shift()();}};
}

test("scrolls a nested mobile leaderboard container to the current row",()=>{
  const h=setup(true,false);
  h.context.ladderScrollToRankRow(h.row,0);
  h.flush();
  assert.ok(h.scroller.scrollTop>0);
  assert.equal(h.notices.length,0);
});

test("falls back to the document when there is no nested scroller",()=>{
  const h=setup(false,false);
  h.context.ladderScrollToRankRow(h.row,0);
  h.flush();
  assert.ok(h.root.scrollTop>0);
  assert.equal(h.notices.length,0);
});

test("reports a failed scroll rather than treating the highlight as success",()=>{
  const h=setup(true,true);
  h.context.ladderScrollToRankRow(h.row,0);
  h.flush();
  assert.equal(h.notices.length,1);
  assert.match(h.notices[0],/無法自動捲動/);
});

"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../ladder-secondary-ui.js"),"utf8");
const start=source.indexOf("    if(findMe){");
const end=source.indexOf("    var more=event.target",start);
const handler=source.slice(start,end);
test("find-me only expands when current player is outside rendered rows",()=>{
  assert.match(handler,/if\(targetCount>ladderVisibleCount\)/);
  assert.match(handler,/ladderVisibleCount=Math\.max\(ladderVisibleCount,index\+1\)/);
});
test("find-me patches the ranking board instead of triggering a full app render",()=>{
  assert.match(handler,/board\.innerHTML=updated\.innerHTML/);
  assert.match(handler,/ladderRankingTableHtml\(adminMode\)/);
  assert.ok(!/\n\s*rerender\(\);\n\s*\/\/ The app/.test(handler));
});
test("V3 verified scroll remains in use",()=>{
  assert.match(handler,/ladderScrollToRankRow\(row,0\)/);
});

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const start=core.indexOf('let liveSelectedCourt=0;');
const end=core.indexOf('function liveCourtCardHtml(',start);
assert(start>=0&&end>start,'live court selection module exists');
const context={state:{id:'room-1',cloudCode:'BXH-TEST01'},liveCurrentMatchForStation:n=>({m:n===10?{completed:false}:null})};
vm.createContext(context);
vm.runInContext(core.slice(start,end)+'\nthis.select=liveCourtSelection;this.setCourt=n=>liveSelectedCourt=n;this.getCourt=()=>liveSelectedCourt;this.getRoom=()=>liveSelectedRoom;',context);

assert.equal(context.select(1),1,'one court needs no alternate selection');
assert.equal(context.select(12),1,'expanding keeps the selected court');
context.setCourt(10);
assert.equal(context.select(20),10,'twenty courts keep a valid selected court');
assert.equal(context.select(8),1,'shrinking removes a stale court selection');
context.setCourt(-1);
assert.equal(context.select(8),-1,'show all remains selected across refreshes');
assert.equal(context.select(20),-1,'show all follows expanded court counts');
context.setCourt(7);
context.state={id:'room-2',cloudCode:'BXH-TEST02'};
assert.equal(context.select(12),10,'a new room starts at its first active match');
assert.equal(context.getRoom(),'BXH-TEST02');
console.log('PASS live court count expansion, shrink and room switch');

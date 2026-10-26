const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function target(){
 const events=new Map();
 return {style:{},isConnected:true,
  addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},
  removeEventListener(type,fn){events.get(type)?.delete(fn);},
  emit(type,e={}){for(const fn of events.get(type)||[])fn(e);},
  count(type){return events.get(type)?.size||0;}
 };
}
function fixture(){
 let viewport=target(),canvas=target();const win=target();let transforms=0;
 const ctx={window:win,document:{getElementById:id=>id==='board-viewport'?viewport:id==='board-canvas'?canvas:null},
  bracketViewMode:'board',boardPanX:0,boardPanY:0,boardZoom:1,
  bindCompletedMatchCorrectionLongPress(){},bindManualCourtAssignLongPress(){},
  applyBoardTransform(){transforms++;},setBoardZoom(){},setBoardPinchZoom(){}};
 vm.createContext(ctx);
 vm.runInContext(core.slice(core.indexOf('let boardModeInteractionCleanup ='),core.indexOf('\nfunction freezeArchivedControls()')),ctx);
 return {ctx,win,get viewport(){return viewport;},transforms:()=>transforms,replace(){viewport.isConnected=false;viewport=target();canvas=target();}};
}
test('100 live rerenders retain exactly one pair of global mouse handlers',()=>{
 const h=fixture();
 for(let i=0;i<100;i++){h.replace();h.ctx.bindBoardModeInteractions();}
 assert.equal(h.win.count('mousemove'),1);assert.equal(h.win.count('mouseup'),1);assert.equal(h.win.count('blur'),1);
 h.viewport.emit('mousedown',{clientX:10,clientY:20});h.win.emit('mousemove',{clientX:30,clientY:50});
 assert.equal(h.ctx.boardPanX,20);assert.equal(h.ctx.boardPanY,30);assert.equal(h.transforms(),1);
 h.ctx.clearBoardModeInteractions();assert.equal(h.win.count('mousemove'),0);assert.equal(h.win.count('mouseup'),0);
});
test('rerender during mouse drag releases the detached viewport and its active drag',()=>{
 const h=fixture();h.ctx.bindBoardModeInteractions();const old=h.viewport;
 old.emit('mousedown',{clientX:0,clientY:0});h.replace();h.ctx.bindBoardModeInteractions();
 h.win.emit('mousemove',{clientX:100,clientY:100});assert.equal(h.transforms(),0);assert.equal(old.count('touchmove'),0);
 h.viewport.emit('mousedown',{clientX:0,clientY:0});h.win.emit('blur');h.win.emit('mousemove',{clientX:100,clientY:100});assert.equal(h.transforms(),0);
});
test('leaving board view removes global and local listeners',()=>{
 const h=fixture();h.ctx.bindBoardModeInteractions();h.ctx.bracketViewMode='list';h.ctx.bindBoardModeInteractions();
 assert.equal(h.win.count('mousemove'),0);assert.equal(h.viewport.count('touchmove'),0);
});
test('one-finger pan still moves from its touch origin',()=>{
 const h=fixture();h.ctx.bindBoardModeInteractions();let prevented=false;
 h.viewport.emit('touchstart',{touches:[{clientX:12,clientY:30}]});
 h.viewport.emit('touchmove',{touches:[{clientX:22,clientY:70}],preventDefault(){prevented=true;}});
 assert.equal(h.ctx.boardPanX,10);assert.equal(h.ctx.boardPanY,40);assert.equal(h.transforms(),1);assert(prevented);
});

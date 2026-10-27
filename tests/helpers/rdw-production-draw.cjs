'use strict';
// Execute selected actual production draw functions; deterministic shuffle/clock
// keep the matrix reproducible. The reviewed server engine normalizes each draw.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {nextPow2,seedOrder}=require('../../referee-seats/functions/engine/match-utils.cjs');
const source=fs.readFileSync(path.join(__dirname,'../../modules/main-app/core.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');if(start<0)throw Error('draw-function-missing:'+name);const next=/^function /gm;next.lastIndex=start+1;const end=next.exec(source)?.index||source.length;return source.slice(start,end);}
const selected=['singleElimScheduleTier','applyChallongeSingleElimOrder','doubleElimCrossFeedIndex','generateSingleElim','generateDoubleElim','generateRoundRobin'].map(fn).join('\n');
function draw({format='single',count=8,stations=2}={}){
 const state={cloudCode:'BXH-FORM27',createdBy:'owner',registrationRosterRevision:4,meta:{formatType:format,eventAuthority:'official',ladderMode:'ranked',battleMode:'individual',stations,registrationStatus:'open'},players:Array.from({length:count},(_,i)=>({id:'p'+i,uid:'uid_'+i,name:'Synthetic '+i})),matches:[],courtAssignments:{},startedAt:null,rosterLocked:false};
 let serial=0;const normalize=()=>createEngine(state,{uid:'owner'},100,'synthetic-draw').rebuildPropagationForState(state);
 const ctx={state,nextPow2,seedOrder,shuffle:x=>x.slice(),uid:p=>p+(++serial),eligiblePlayers:()=>state.players,showToast:m=>{throw Error(m);},rebuildPropagationSingle:()=>{},rebuildPropagationDouble:()=>{},syncMatchStatuses:normalize,orderedMatches:()=>state.matches.slice().sort((a,b)=>a.seq-b.seq),Date:{now:()=>100},window:{BXHDoubleElim:require('../../double-elimination-core.js')}};
 vm.createContext(ctx);vm.runInContext(selected+';generate=({single:generateSingleElim,double:generateDoubleElim,roundrobin:generateRoundRobin})[state.meta.formatType];',ctx);if(!ctx.generate())throw Error('draw-failed');normalize();state.bracketDraw={id:'draw',revision:7};return JSON.parse(JSON.stringify(state));
}
module.exports={draw};

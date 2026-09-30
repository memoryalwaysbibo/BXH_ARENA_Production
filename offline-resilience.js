(function(){
"use strict";
const DB_NAME="bxh_arena_offline_v1", STORE="match_ops", DB_VERSION=1, MAX_RETRIES=8;
let replayHandler=null, flushing=false, timer=null;
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:"operationId"});s.createIndex("createdAt","createdAt");s.createIndex("status","status");}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function all(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),r=tx.objectStore(STORE).getAll();r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)));r.onerror=()=>reject(r.error);});}
async function put(row){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(row);tx.oncomplete=()=>resolve(row);tx.onerror=()=>reject(tx.error);});}
async function del(id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function emit(){status().then(detail=>window.dispatchEvent(new CustomEvent("bxh-offline-status",{detail}))).catch(()=>{});}
function makeId(op){return [op.roomCode||"",op.matchId||"",op.dispatchRevision||0,op.winnerId||""].join(":");}
async function enqueue(op){const operationId=op.operationId||makeId(op),rows=await all(),existing=rows.find(x=>x.operationId===operationId);if(existing)return existing;const row=Object.assign({},op,{operationId,createdAt:Date.now(),updatedAt:Date.now(),status:"pending",retryCount:0});await put(row);emit();return row;}
async function status(){const rows=await all();return {online:navigator.onLine,pending:rows.filter(x=>x.status==="pending"||x.status==="retry").length,conflicts:rows.filter(x=>x.status==="conflict").length,failed:rows.filter(x=>x.status==="failed").length,total:rows.length};}
function conflictError(e){const s=String(e&&((e.code||"")+" "+(e.message||""))||"").toLowerCase();return /already-completed|dispatch|revision|invalid-selection|missing-players|stale|conflict|match.*changed/.test(s);}
async function flush(){if(flushing||!navigator.onLine||typeof replayHandler!=="function")return;flushing=true;try{const rows=await all();for(const row of rows){if(!navigator.onLine)break;if(row.status==="conflict"||row.status==="failed")continue;try{await replayHandler(row);await del(row.operationId);}catch(e){row.retryCount=Number(row.retryCount||0)+1;row.updatedAt=Date.now();row.lastError=String(e&&((e.code||"")+" "+(e.message||""))||e||"unknown");if(conflictError(e))row.status="conflict";else if(row.retryCount>=MAX_RETRIES)row.status="failed";else row.status="retry";await put(row);if(row.status==="conflict")break;}}}finally{flushing=false;emit();}}
function setReplayHandler(fn){replayHandler=typeof fn==="function"?fn:null;if(replayHandler)flush();}
function start(){if(timer)return;window.addEventListener("online",flush);document.addEventListener("visibilitychange",()=>{if(!document.hidden)flush();});timer=setInterval(flush,30000);emit();}
window.BXHOfflineResilience={enqueue,flush,status,setReplayHandler,start,all};
start();
})();
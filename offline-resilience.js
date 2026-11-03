/* BXH ARENA Offline Resilience v2 */
(function(){'use strict';
const DB='bxh-arena-offline-v1',STORE='operations',MAX_ATTEMPTS=8;let dbp=null,replaying=false,retryTimer=null,lastQueueCountsKey=null;
function open(){if(dbp)return dbp;dbp=new Promise((resolve,reject)=>{if(!('indexedDB'in window)){reject(new Error('indexeddb-unavailable'));return;}const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('status','status',{unique:false});s.createIndex('createdAt','createdAt',{unique:false});}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbp;}
function uuid(){return(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():'op-'+Date.now()+'-'+Math.random().toString(36).slice(2);}
function stable(value){return JSON.stringify(value,(key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,k)=>{o[k]=v[k];return o;},{}):v);}
function confirmationIntent(p={}){
 const quick=p.mode==='quick_decision';
 return stable([String(p.actorUid||''),String(p.tournamentCode||'').toUpperCase(),p.matchId||null,Number(p.station||0),Number(p.dispatchRevision||0),p.mode||'score',p.playerAId||null,p.playerBId||null,p.selectedWinnerId||null,quick?null:p.scoreA??null,quick?null:p.scoreB??null,quick?[]:p.log||[],quick?[]:p.faultActions||[]]);
}
function fingerprint(p){return confirmationIntent(p||{});}
function confirmationReceipt(op,match){return {version:1,operationId:op.id,actorUid:op.actorUid,intent:confirmationIntent(op),confirmedAt:match.confirmedAt};}
function matchesConfirmationReceipt(op,match){
 const r=match&&match.offlineConfirmationReceipt;
 if(!op?.id||!op.actorUid||!r||r.version!==1||r.operationId!==op.id||r.actorUid!==op.actorUid||r.intent!==confirmationIntent(op)||match.completed!==true||!Number.isFinite(r.confirmedAt)||r.confirmedAt!==match.confirmedAt)return false;
 return r.intent===confirmationIntent({...op,matchId:match.id,station:match.station,dispatchRevision:match.dispatchRevision||0,mode:match.resultMethod,playerAId:match.a?.playerId,playerBId:match.b?.playerId,selectedWinnerId:match.winnerId,scoreA:match.scoreA,scoreB:match.scoreB,log:match.log||[],faultActions:match.faultActions||[]});
}
async function put(op){const db=await open();await new Promise((res,rej)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).put(op);t.oncomplete=res;t.onerror=()=>rej(t.error);});}
async function all(){const db=await open();return new Promise((res,rej)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>res((r.result||[]).sort((a,b)=>a.createdAt-b.createdAt));r.onerror=()=>rej(r.error);});}
async function enqueue(payload){
 const fp=fingerprint(payload),db=await open();
 // A single read/write transaction serializes this check across tabs as well.
 const op=await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),read=store.getAll();let selected;
  read.onsuccess=()=>{
   selected=(read.result||[]).find(x=>fingerprint(x)===fp&&['pending','retry','syncing'].includes(x.status));
   if(!selected){selected=Object.assign({},payload||{},{id:uuid(),fingerprint:fp,type:'match-confirmation',status:'pending',createdAt:Date.now(),updatedAt:Date.now(),attempts:0,lastError:null});store.put(selected);}
  };
  tx.oncomplete=()=>resolve(selected);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('queue-write-aborted'));
 });
 emit();schedule(500);return op;
}
async function remove(id){const db=await open();await new Promise((res,rej)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).delete(id);t.oncomplete=res;t.onerror=()=>rej(t.error);});emit();}
async function counts(){const r=await all();return{pending:r.filter(x=>['pending','retry','syncing'].includes(x.status)).length,conflict:r.filter(x=>x.status==='conflict').length,failed:r.filter(x=>x.status==='failed').length,total:r.length};}
function queueCountsKey(value){const x=value&&typeof value==='object'?value:{};return[Number(x.pending||0),Number(x.conflict||0),Number(x.failed||0),Number(x.total||0)].join('|');}
async function emit(){try{const detail=await counts(),key=queueCountsKey(detail);if(key===lastQueueCountsKey)return;lastQueueCountsKey=key;window.dispatchEvent(new CustomEvent('bxh-offline-queue-change',{detail}));}catch(e){}}
function schedule(ms){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(navigator.onLine)replay();},Math.max(250,ms||1000));}
function isConflict(reason){return ['already-completed','station-mismatch','dispatch-stale','invalid-selection','missing-players','player-mismatch','validation-failed','permission-denied','station-not-assigned','not-found'].includes(reason);}
async function replay(){if(replaying||!navigator.onLine||typeof window.BXHCommitOfflineMatch!=='function')return;replaying=true;try{for(const op of(await all()).filter(x=>['pending','retry','syncing'].includes(x.status))){if(!navigator.onLine)break;if((op.attempts||0)>=MAX_ATTEMPTS){op.status='failed';op.lastError=op.lastError||'retry-limit';op.updatedAt=Date.now();await put(op);window.dispatchEvent(new CustomEvent('bxh-offline-operation-failed',{detail:{op,reason:op.lastError}}));continue;}op.status='syncing';op.attempts=(op.attempts||0)+1;op.lastAttemptAt=Date.now();op.updatedAt=Date.now();await put(op);emit();let r;try{r=await window.BXHCommitOfflineMatch(op);}catch(e){r={ok:false,reason:(e&&e.message)||'network'};}if(r&&r.ok){await remove(op.id);window.dispatchEvent(new CustomEvent('bxh-offline-operation-synced',{detail:{op,result:r}}));continue;}const reason=(r&&r.reason)||'network';op.lastError=reason;op.updatedAt=Date.now();if(isConflict(reason)){op.status='conflict';await put(op);window.dispatchEvent(new CustomEvent('bxh-offline-operation-conflict',{detail:{op,reason}}));continue;}op.status=op.attempts>=MAX_ATTEMPTS?'failed':'retry';await put(op);if(op.status==='failed')window.dispatchEvent(new CustomEvent('bxh-offline-operation-failed',{detail:{op,reason}}));else schedule(Math.min(60000,2000*Math.pow(2,Math.min(op.attempts,5))));break;}}finally{replaying=false;emit();}}
async function retryFailed(){for(const op of await all()){if(op.status==='failed'){op.status='retry';op.attempts=0;op.lastError=null;op.updatedAt=Date.now();await put(op);}}emit();schedule(300);}
window.BXHOfflineQueue={enqueue,all,remove,counts,replay,retryFailed,confirmationReceipt,matchesConfirmationReceipt,MAX_ATTEMPTS};
window.addEventListener('online',()=>schedule(400));window.addEventListener('bxh-cloud-ready',()=>schedule(500));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.onLine)schedule(500);});setInterval(()=>{if(navigator.onLine)replay();},30000);setTimeout(()=>{emit();if(navigator.onLine)replay();},800);
})();
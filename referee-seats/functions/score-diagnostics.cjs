'use strict';
const {createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const ACTIONS=new Set(['score','fault','undo','rematch','pause','resume','confirm','quick','correct','start','ready','skip','idle-claim','claim-skipped','manual-assign','swap','force-exit','reopen','claim-detached','retirement-transfer','resize']);
// Diagnostic failures must never change the scoring result. Do not log payloads,
// names, UID, credentials, state, or error messages supplied by dependencies.
function createScoreDiagnostics(request,{emit=record=>console.log(JSON.stringify(record)),now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout,slowMs=20000}={}){
 const d=request.data||{},started=now();
 const context={component:'referee-score',schema:1,room:/^BXH-[A-Z0-9]{4,16}$/.test(d.code||'')?d.code:'invalid',action:ACTIONS.has(d.action)?d.action:'unknown',operation:createHash('sha256').update(String(d.operationId||'')).digest('hex').slice(0,16)};
 if(Number.isInteger(d.station)&&d.station>=1&&d.station<=32)context.station=d.station;
 const header=request.rawRequest?.headers?.['x-cloud-trace-context'];
 const trace=typeof header==='string'?/^([a-f0-9]{32})(?:\/|;|$)/.exec(header):null;
 if(trace)context['logging.googleapis.com/trace']='projects/bxh-arena/traces/'+trace[1];
 let attempt=0,phase='transaction-start',phaseStarted=started,closed=false,timer;
 const elapsed=at=>Math.max(0,Math.round(now()-at));
 function write(event,extra={}){try{emit({...context,event,attempt,phase,elapsedMs:elapsed(started),phaseElapsedMs:elapsed(phaseStarted),...extra});}catch{}}
 write('started');
 try{timer=schedule(()=>{if(!closed)write('slow');},slowMs);timer?.unref?.();}catch{}
 return {
  beginAttempt(){if(closed)return;const previousPhase=phase,previousPhaseMs=elapsed(phaseStarted);attempt++;phase='read-documents';phaseStarted=now();write(attempt>1?'retry':'attempt',{previousPhase,previousPhaseMs});},
  phase(next){if(closed)return;const previousPhase=phase,previousPhaseMs=elapsed(phaseStarted);phase=next;phaseStarted=now();write('phase',{previousPhase,previousPhaseMs});},
  complete(){if(!closed)write('complete');},
  failed(error){const raw=error?.code;const errorCode=Number.isInteger(raw)?raw:['aborted','deadline-exceeded','unavailable','resource-exhausted','permission-denied','internal','cancelled','not-found','failed-precondition'].includes(raw)?raw:'unclassified';if(!closed)write('failed',{errorCode});},
  close(){closed=true;try{if(timer!==undefined)cancel(timer);}catch{}}
 };
}
module.exports={createScoreDiagnostics};

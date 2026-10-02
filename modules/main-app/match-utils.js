(function(){
// Core P1J — pure match/court display utilities.
// State-dependent referee scheduling/stage logic intentionally remains in core.

function courtKey(n){ return "court"+n; }

function matchLabel(m){
  if(!m) return "";
  if(m.bracket==="WB") return "勝部．第"+(m.round+1)+"輪";
  if(m.bracket==="LB") return "敗部．第"+(m.round+1)+"輪";
  if(m.bracket==="GF") return "總決賽";
  if(m.bracket==="GFR") return "總決賽重置戰";
  if(m.bracket==="RR") return "第"+(m.round+1)+"輪";
  if(m.bracket==="BZ") return "季軍賽";
  return "第"+(m.round+1)+"輪";
}

function liveEtaCountdownText(deadline){
  if(!deadline) return "—";
  const sec=Math.max(0,Math.ceil((Number(deadline)-Date.now())/1000));
  if(sec<=30) return "即將上場";
  const mm=Math.floor(sec/60),ss=sec%60;
  return "約 "+String(mm).padStart(2,"0")+":"+String(ss).padStart(2,"0");
}

function matchStatusClass(m){
  if(m.isBye) return "";
  const s = m.status || (m.completed ? "completed" : "pending");
  return "ms-card-"+s;
}

function correctionMatchHasActualPlay(m){
  if(!m) return false;
  const scoreA=Number(m.scoreA||0),scoreB=Number(m.scoreB||0);
  return !!(m.completed || m.status==="completed" || m.confirmedAt || m.resultMethod || (Array.isArray(m.log)&&m.log.length) || (Array.isArray(m.faultActions)&&m.faultActions.length) || scoreA>0 || scoreB>0);
}
function correctionParticipantSignature(m){return [m&&m.a&&m.a.playerId||"",m&&m.b&&m.b.playerId||""].join("|");}
function matchHasDecisionData(m){return !!(m&&(m.completed||m.winnerId||m.loserId||Number(m.scoreA||0)>0||Number(m.scoreB||0)>0||(Array.isArray(m.log)&&m.log.length)||(Array.isArray(m.faultActions)&&m.faultActions.length)));}

function nextPow2(n){let p=2;while(p<n)p*=2;return p;}
function seedOrder(size){
  let order=[1];
  while(order.length<size){const total=order.length*2+1,next=[];order.forEach(s=>{next.push(s);next.push(total-s);});order=next;}
  return order;
}
function sameStringSet(a,b){if(a.size!==b.size)return false;for(const x of a)if(!b.has(x))return false;return true;}

Object.assign(window.BXHMatchUtils||(window.BXHMatchUtils={}),{courtKey,matchLabel,liveEtaCountdownText,matchStatusClass});

})();

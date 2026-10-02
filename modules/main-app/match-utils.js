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

Object.assign(window.BXHMatchUtils||(window.BXHMatchUtils={}),{courtKey,matchLabel,liveEtaCountdownText,matchStatusClass});

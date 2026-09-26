/* BXH ranked registration pre-open UX
   - Ranked events move from "等待開始" to the "報名中" lobby section at T-5 minutes.
   - Registration eligibility is NOT changed: getEffectiveRegistrationStatus remains server/time authoritative.
   - A local boundary timer forces a re-render at T-5 and T0 even when Firestore is quiet. */
'use strict';

(function rankedRegistrationPreopenUx(){
  const PREOPEN_MS=5*60*1000;
  const MAX_TIMEOUT_MS=2147483000;
  let installed=false;
  let boundaryTimer=null;
  let retryTimer=null;
  let originalLifecycle=null;
  let originalLobbyRender=null;

  function rankedEvent(t){
    return !!t && String(t.ladderMode||'').toLowerCase()==='ranked' && t.testLadderEnabled!==true;
  }

  function registrationOpenMs(t){
    if(!t) return NaN;
    let raw=t.registrationOpenAt;
    if(raw==null||raw==='') return NaN;
    if(typeof raw==='number'&&Number.isFinite(raw)) return raw;
    if(raw instanceof Date) return raw.getTime();
    if(typeof raw==='object'){
      try{
        if(typeof raw.toMillis==='function'){
          const ms=Number(raw.toMillis());
          if(Number.isFinite(ms)) return ms;
        }
      }catch{}
      const seconds=Number(raw.seconds);
      if(Number.isFinite(seconds)) return seconds*1000;
    }
    try{
      if(typeof normalizeDateTime==='function'){
        const normalized=normalizeDateTime(raw);
        if(normalized!=null&&normalized!=='') raw=normalized;
      }
    }catch{}
    if(typeof raw==='number'&&Number.isFinite(raw)) return raw;
    const numeric=Number(raw);
    if(Number.isFinite(numeric)&&numeric>100000000000) return numeric;
    const parsed=Date.parse(String(raw));
    return Number.isFinite(parsed)?parsed:NaN;
  }

  function effectiveRegistrationStatus(t){
    try{
      return typeof getEffectiveRegistrationStatus==='function'
        ? String(getEffectiveRegistrationStatus(t)||'')
        : '';
    }catch{
      return '';
    }
  }

  function isPreopenWindow(t,now=Date.now()){
    if(!rankedEvent(t)) return false;
    if(effectiveRegistrationStatus(t)!=='scheduled') return false;
    const openMs=registrationOpenMs(t);
    return Number.isFinite(openMs)&&now>=openMs-PREOPEN_MS&&now<openMs;
  }

  function registrationDescriptor(base){
    try{
      if(typeof roomStatusDescriptor==='function'){
        const d=roomStatusDescriptor('registration');
        if(d) return {key:d.key,label:d.label,dot:d.dot,phase:base.phase,preopen:true};
      }
    }catch{}
    return {key:'registration',label:'報名中',dot:'green',phase:base.phase,preopen:true};
  }

  function decorateLifecycle(t,base,now=Date.now()){
    if(!base||base.phase!=='waiting'||!isPreopenWindow(t,now)) return base;
    return registrationDescriptor(base);
  }

  function cachedItems(){
    try{
      return Array.isArray(publicTournamentsCache)?publicTournamentsCache:[];
    }catch{
      return [];
    }
  }

  function nextBoundary(items,now=Date.now()){
    let next=Infinity;
    for(const t of Array.isArray(items)?items:[]){
      if(!rankedEvent(t)) continue;
      const openMs=registrationOpenMs(t);
      if(!Number.isFinite(openMs)) continue;
      for(const boundary of [openMs-PREOPEN_MS,openMs]){
        if(boundary>now+50&&boundary<next) next=boundary;
      }
    }
    return next;
  }

  function rerenderLobby(){
    try{
      if(typeof isTournamentLobbyVisible==='function'&&!isTournamentLobbyVisible()) return;
    }catch{}
    try{
      if(typeof renderPreservingScroll==='function') renderPreservingScroll();
      else if(typeof render==='function') render();
    }catch(error){
      console.warn('[ranked preopen render]',error);
    }
  }

  function scheduleBoundary(){
    if(boundaryTimer){
      clearTimeout(boundaryTimer);
      boundaryTimer=null;
    }
    const now=Date.now();
    const next=nextBoundary(cachedItems(),now);
    if(!Number.isFinite(next)) return;
    const delay=Math.min(MAX_TIMEOUT_MS,Math.max(80,next-now+80));
    boundaryTimer=setTimeout(()=>{
      boundaryTimer=null;
      rerenderLobby();
      scheduleBoundary();
    },delay);
  }

  function install(){
    if(installed) return true;
    if(typeof publicEventLifecycleStatus!=='function') return false;
    originalLifecycle=publicEventLifecycleStatus;
    publicEventLifecycleStatus=function(t){
      return decorateLifecycle(t,originalLifecycle(t));
    };

    if(typeof renderTournamentLobby==='function'){
      originalLobbyRender=renderTournamentLobby;
      renderTournamentLobby=function(...args){
        const html=originalLobbyRender.apply(this,args);
        setTimeout(scheduleBoundary,0);
        return html;
      };
    }

    installed=true;
    scheduleBoundary();
    return true;
  }

  function boot(){
    if(install()) return;
    let attempts=0;
    retryTimer=setInterval(()=>{
      attempts++;
      if(install()||attempts>=100){
        clearInterval(retryTimer);
        retryTimer=null;
      }
    },100);
  }

  if(typeof document!=='undefined'){
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){scheduleBoundary();rerenderLobby();}});
  }
  if(typeof window!=='undefined'){
    window.addEventListener('focus',()=>{scheduleBoundary();rerenderLobby();});
    window.BxhRankedRegistrationPreopen={
      PREOPEN_MS,
      rankedEvent,
      registrationOpenMs,
      isPreopenWindow,
      decorateLifecycle,
      nextBoundary,
      scheduleBoundary,
      install
    };
  }
})();

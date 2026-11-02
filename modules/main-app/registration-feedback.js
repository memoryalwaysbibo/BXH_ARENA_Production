(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BXHRegistrationFeedback=api;
})(globalThis,()=>{
  'use strict';
  const PREFIX='bxh:registration-feedback:v1:';
  const ACTIVE=['preparing','submitting','checking','unconfirmed'];
  const STATUS=['confirmed','waitlist','pending_draw'];
  const identifier=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
  const valid=r=>r&&r.version===1&&identifier(r.uid)&&/^BXH-[A-Z0-9]{4,16}$/.test(r.code)
    &&Array.isArray(r.ids)&&r.ids.length>0&&r.ids.length<=21&&r.ids.every(identifier)
    &&new Set(r.ids).size===r.ids.length&&Number.isFinite(r.createdAt);
  const key=(uid,code)=>PREFIX+encodeURIComponent(uid)+':'+code;
  const clone=r=>JSON.parse(JSON.stringify(r));
  function originalRequest(record,request){
    if(!request||request.action!=='join'||request.code!==record.code||!identifier(request.operationId)||request.operationId.length<8||request.operationId.length>100
      ||typeof request.childEligibilityConfirmed!=='boolean'||!Array.isArray(request.childIds)
      ||JSON.stringify(request.childIds.map(id=>id===null?record.uid:'family_'+id))!==JSON.stringify(record.ids)
      ||Object.keys(request).some(k=>!['action','code','operationId','childIds','allocation','childEligibilityConfirmed'].includes(k)))return null;
    if(request.allocation!==undefined&&(!Array.isArray(request.allocation)||request.allocation.length!==record.ids.length||request.allocation.some((r,i)=>r.registrationId!==record.ids[i]||!['confirmed','waitlist'].includes(r.status)||Object.keys(r).some(k=>!['registrationId','status'].includes(k)))))return null;
    return clone(request);
  }
  function definitive(error){
    // Only explicit backend rejections prove that this request did not commit.
    const reason=[error?.message,error?.details?.reason,error?.code].filter(Boolean).join(' ');
    return /(?:^|[\s:])(?:full|allocation-changed|not-open-yet|closed|not-enabled|profile-incomplete|child-not-found|child-eligibility-required|roster-locked|tournament-started|onsite-waitlist-managed|family-lottery-unavailable|room-password-required|registration-state-conflict|invalid-operation|invalid-participants|registration-no-longer-active)(?:$|[\s:])/.test(reason)
      || /\bABORTED\b|functions\/aborted/.test(reason);
  }
  function failureMessage(error){
    const text=String(error?.message||'');
    if(/registration-no-longer-active/.test(text))return '目前沒有這筆有效報名，請重新確認賽事名單。';
    if(/(?:^|\s)full(?:$|\s)/.test(text))return '正取與備取皆已額滿。';
    if(/allocation-changed/.test(text))return '名額配置已變動，請重新確認名額後再報名。';
    if(/\bABORTED\b|functions\/aborted/.test(text))return '系統忙碌，本次報名未完成，請稍後再試。';
    return '請依提示重新確認名額後再試。';
  }
  function create({getUid,read,retry,storage,onChange=()=>{},onRecovered=()=>{},schedule=setTimeout,unschedule=clearTimeout,
    now=Date.now,visible=()=>true,slowMs=8000,deadlineMs=65000,readTimeoutMs=8000,delays=[12000,24000,40000,60000]}={}){
    if(typeof getUid!=='function'||typeof read!=='function')throw Error('feedback-dependencies-required');
    const entries=new Map();let owner=null,scannedOwner=null,disposed=false;
    const emit=()=>{if(!disposed)onChange(snapshot(false));};
    const current=e=>!disposed&&e.uid===getUid()&&owner===e.uid&&entries.get(e.code)===e;
    function clearTimers(e){for(const t of e.timers)unschedule(t);e.timers.clear();}
    function later(e,fn,ms){const timer=schedule(()=>{e.timers.delete(timer);if(current(e))fn();},ms);e.timers.add(timer);return timer;}
    function persist(e){
      const r={version:1,uid:e.uid,code:e.code,ids:e.ids,createdAt:e.createdAt};
      if(e.retry)r.retry=e.retry;
      if(!valid(r))throw Error('feedback-invalid-submission');
      try{storage?.setItem(key(e.uid,e.code),JSON.stringify(r));e.durable=!!storage&&storage.getItem(key(e.uid,e.code))===JSON.stringify(r);}
      catch{e.durable=false;}
    }
    function remove(e){try{storage?.removeItem(key(e.uid,e.code));}catch{/* A later restore rechecks the server. */}}
    function entry(r,state){return {...r,state,durable:true,attempts:0,timers:new Set(),autoTimer:null,flight:null,query:null,result:null,lastCheckAt:null,settle:null};}
    function restore(force=false){
      const uid=getUid()||null;
      if(uid!==owner){for(const e of entries.values()){clearTimers(e);e.settle?.(null,Error('stale-session'));}entries.clear();owner=uid;scannedOwner=null;}
      if(disposed||!uid)return;
      if(scannedOwner===uid&&!force)return;
      scannedOwner=uid;
      try{
        for(let i=0,n=storage?.length||0;i<n;i++){
          const k=storage.key(i);if(!k?.startsWith(PREFIX+encodeURIComponent(uid)+':'))continue;
          let r;try{r=JSON.parse(storage.getItem(k));}catch{continue;}
          if(!valid(r)||r.uid!==uid||key(uid,r.code)!==k||entries.has(r.code))continue;
          const e=entry({...r,retry:originalRequest(r,r.retry)},'unconfirmed');entries.set(r.code,e);later(e,()=>void recheck(e.code),0);
        }
      }catch{/* Storage is optional; in-page tracking continues. */}
    }
    function snapshot(sync=true){if(sync)restore();return [...entries.values()].map(e=>({code:e.code,state:e.state,durable:e.durable,
      statuses:e.result?.rows?.map(r=>r.status)||(e.result?[e.result.status]:[]),createdAt:e.createdAt,submitted:!!e.ids,lastCheckAt:e.lastCheckAt,
      canRetry:!!e.retry&&typeof retry==='function'&&!e.flight&&e.state==='unconfirmed',message:e.message||null}));}
    function complete(e,result,recovered=false){
      if(!current(e)||!ACTIVE.includes(e.state))return;
      clearTimers(e);e.result=result;e.state='confirmed';remove(e);e.settle?.(result);
      if(recovered)onRecovered({code:e.code,result});emit();
    }
    function queueCheck(e){
      if(!current(e)||!ACTIVE.includes(e.state)||!e.ids||e.attempts>delays.length)return;
      if(e.autoTimer!==null){unschedule(e.autoTimer);e.timers.delete(e.autoTimer);}
      e.autoTimer=later(e,()=>{e.autoTimer=null;void recheck(e.code);},delays[Math.max(0,e.attempts-1)]||delays.at(-1)||12000);
    }
    async function recheck(code){
      restore();const e=entries.get(code);
      if(!e||!current(e)||!e.ids||!ACTIVE.includes(e.state))return null;
      if(e.query)return e.query;
      if(!visible())return null;
      if(e.lastCheckAt!==null&&now()-e.lastCheckAt<3000)return null;
      if(e.autoTimer!==null){unschedule(e.autoTimer);e.timers.delete(e.autoTimer);e.autoTimer=null;}
      e.state='checking';e.attempts++;emit();
      e.query=(async()=>{
        let timer;
        try{
          const response=await Promise.race([Promise.resolve().then(()=>read(code)),new Promise(resolve=>{timer=schedule(()=>resolve(null),readTimeoutMs);})]);
          if(!current(e)||!ACTIVE.includes(e.state))return null;
          e.lastCheckAt=now();
          // Require every selected identity, never another family member or an empty read.
          const rows=Array.isArray(response?.rows)?response.rows:[];
          const selected=e.ids.map(id=>rows.find(r=>r.registrationId===id&&STATUS.includes(r.status)));
          if(response?.ok===true&&selected.every(Boolean)){
            const safeRows=selected.map(r=>({registrationId:r.registrationId,status:r.status}));
            const result={ok:true,status:safeRows[0].status,rows:safeRows,recovered:true};
            complete(e,result,true);return result;
          }
          e.state='unconfirmed';return null;
        }catch{if(current(e)&&ACTIVE.includes(e.state))e.state='unconfirmed';return null;}
        finally{unschedule(timer);e.query=null;if(current(e)){e.lastCheckAt=now();emit();queueCheck(e);}}
      })();
      return e.query;
    }
    function run(code,send){
      restore();const uid=getUid();if(!uid||disposed)return Promise.reject(Error('auth-required'));
      if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))return Promise.reject(Error('invalid-code'));
      const existing=entries.get(code);
      if(existing&&ACTIVE.includes(existing.state)){
        if(existing.flight)return existing.flight;
        void recheck(code);return Promise.reject(Error('registration-result-pending'));
      }
      const e=entry({uid,code,createdAt:now()},'preparing');entries.set(code,e);
      e.flight=new Promise((resolve,reject)=>{let settled=false;e.settle=(result,error)=>{if(settled)return;settled=true;error?reject(error):resolve(result);};});
      // Start asynchronously so duplicate clicks always see the same in-flight promise.
      Promise.resolve().then(async()=>{
        const assertCurrent=()=>{if(!current(e)||e.state==='failed')throw Error('stale-session');};
        const submitting=(ids,request)=>{assertCurrent();e.ids=[...ids];e.retry=originalRequest(e,request);persist(e);e.state='submitting';emit();};
        later(e,()=>{if(e.ids)void recheck(code);else{e.slow=true;emit();}},slowMs);
        later(e,()=>{e.state=e.ids?'unconfirmed':'failed';if(!e.ids)e.message='前置確認逾時，尚未送出報名。';emit();e.settle(null,Error(e.ids?'registration-result-pending':'registration-preparation-timeout'));if(!e.ids)clearTimers(e);},deadlineMs);
        try{
          assertCurrent();const result=await send({submitting,assertCurrent});assertCurrent();
          if(!result||result.ok===false||!STATUS.includes(result.status))throw Error('registration-empty-response');
          complete(e,result);
        }catch(error){
          if(!current(e))return;
          if(e.state==='confirmed')return; // A delayed transport error cannot undo server confirmation.
          if(!e.ids||definitive(error)){
            clearTimers(e);remove(e);e.state='failed';e.message=e.message||failureMessage(error);e.settle(null,error);emit();
          }else{
            e.state='unconfirmed';emit();const recovered=await recheck(code);
            if(current(e)&&!recovered&&e.state!=='confirmed')e.settle(null,Error('registration-result-pending'));
          }
        }
      });
      const flight=e.flight;flight.finally(()=>{if(current(e)){e.flight=null;emit();}}).catch(()=>{});emit();return flight;
    }
    function retryOriginal(code){
      restore();const previous=entries.get(code);
      if(!previous||!current(previous)||!previous.retry||typeof retry!=='function'||!ACTIVE.includes(previous.state))return Promise.reject(Error('original-request-unavailable'));
      if(previous.flight)return previous.flight;
      const request=clone(previous.retry),ids=[...previous.ids];clearTimers(previous);previous.state='failed';
      return run(code,async progress=>{
        progress.submitting(ids,request);await retry(request);progress.assertCurrent();
        // An idempotent receipt may predate cancellation. Confirm CURRENT rows,
        // never show an old successful receipt as a fresh active registration.
        const response=await read(code);progress.assertCurrent();
        if(response?.ok!==true||!Array.isArray(response.rows))throw Error('registration-empty-response');
        const rows=ids.map(id=>response.rows.find(r=>r.registrationId===id&&STATUS.includes(r.status)));
        if(!rows.every(Boolean))throw Error('registration-no-longer-active');
        return {ok:true,status:rows[0].status,rows:rows.map(r=>({registrationId:r.registrationId,status:r.status})),recovered:true};
      }).then(result=>{if(getUid()===previous.uid&&entries.get(code)?.state==='confirmed')onRecovered({code,result});return result;});
    }
    function dismiss(code){const e=entries.get(code);if(e&&!ACTIVE.includes(e.state)){clearTimers(e);entries.delete(code);emit();}}
    function refresh(force=false){restore(force);emit();}
    function resume(){restore();for(const e of entries.values())if(e.ids&&ACTIVE.includes(e.state)&&e.attempts<=delays.length)void recheck(e.code);emit();}
    function dispose(){disposed=true;for(const e of entries.values()){clearTimers(e);e.settle?.(null,Error('stale-session'));}entries.clear();}
    return {run,recheck,retryOriginal,snapshot,restore:refresh,resume,dismiss,dispose};
  }
  function mount(controller,document){
    let panel=null,last='';
    function render(rows){
      const signature=JSON.stringify(rows);if(signature===last&&panel?.isConnected)return;last=signature;
      if(!panel){panel=document.createElement('section');panel.className='registration-feedback-panel';panel.setAttribute('aria-label','報名處理進度');document.body.appendChild(panel);}
      panel.replaceChildren();panel.hidden=!rows.length;
      for(const row of rows){
        const box=document.createElement('div');box.className='registration-feedback-item';
        const title=document.createElement('strong');title.textContent=row.state==='confirmed'?'報名狀態已確認':row.state==='failed'?'本次報名未完成':row.state==='preparing'?'正在確認報名資格':row.state==='submitting'?'報名送出中':row.state==='checking'?'正在查詢報名結果':'報名結果尚未確認';
        const detail=document.createElement('p');detail.setAttribute('role','status');detail.setAttribute('aria-live','polite');
        const statuses=row.statuses.map(s=>({confirmed:'正取',waitlist:'備取',pending_draw:'等待抽籤'}[s]));
        detail.textContent=row.code+'｜'+(row.state==='confirmed'?statuses.join('、'):row.state==='failed'?row.message:row.state==='preparing'?'尚未取得名額，請稍候。':row.state==='submitting'?'請勿重複點擊；送出不代表已取得名額。':'正在確認是否報名成功，請勿重新送出。');
        box.append(title,detail);
        if(ACTIVE.includes(row.state)&&row.submitted){const button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='查詢報名結果';button.disabled=row.state==='checking';button.onclick=()=>void controller.recheck(row.code);box.appendChild(button);}
        if(row.canRetry){const button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='重送原報名';button.onclick=()=>{void controller.retryOriginal(row.code).catch(()=>{});};box.appendChild(button);const hint=document.createElement('p');hint.textContent='沿用同一筆報名確認結果，不會另建新請求；名額仍依伺服器判定。';box.appendChild(hint);}
        if(!ACTIVE.includes(row.state)){const button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent='關閉提示';button.onclick=()=>controller.dismiss(row.code);box.appendChild(button);}
        if(row.submitted&&!row.durable&&ACTIVE.includes(row.state)){const warning=document.createElement('p');warning.textContent='此瀏覽器無法保存進度，請留在此頁確認結果。';box.appendChild(warning);}
        panel.appendChild(box);
      }
    }
    return render;
  }
  return {create,mount,PREFIX,definitive};
});

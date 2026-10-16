(function(){
  'use strict';
  let ctx=null,boundKey='',modal=false,busy=false,settings=null,rows=[],message='',timer=null,scanStarted='',scanResult=null,scanBusy=false;
  const errorText=e=>{
    const raw=String(e?.message||e||'');
    for(const [key,label] of Object.entries({
      'not-confirmed':'您目前不在正取名單，請洽現場工作人員協助。',
      'ambiguous-player':'帳號對應多位選手，請洽工作人員人工報到。',
      'qr-expired':'報到 QR 已過期，請重新掃描現場 QR。',
      'invalid-qr':'報到 QR 無效，請重新掃描現場 QR。',
      'checkin-closed':'目前未開放報到，請洽現場工作人員。',
      'feature-unavailable':'本場 QR 報到尚未啟用。',
      'onsite-integration-required':'本場使用現場抽籤，請由工作人員人工報到。',
      'permission-denied':'您沒有本場報到管理權限。'
    }))if(raw.includes(key))return label;
    return '報到結果尚未確認，請重試或洽工作人員查核。';
  };
  function identity(){return ctx?.uid()||'';}
  function key(){return identity()+':'+(ctx?.state().cloudCode||'');}
  async function call(payload){return window.engagementService.tournamentOperation('tournamentCheckin',payload);}
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function time(ms){return ms?new Date(ms).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'既有人工報到，尚無時間紀錄';}
  function entry(){
    const u=new URL(location.href),code=u.searchParams.get('checkin'),token=u.searchParams.get('checkinToken');
    return code&&token&&/^BXH-[A-Z0-9]{4,16}$/.test(code)?{code,token}:null;
  }
  function qrUrl(){const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('checkin',ctx.state().cloudCode);u.searchParams.set('checkinToken',settings.token);return u.href;}
  async function refresh(loadHistory=true){
    const k=key(),code=ctx.state().cloudCode;
    const s=await call({action:'status',code});
    const history=loadHistory?await call({action:'history',code}):null;
    if(!modal||key()!==k)return;
    settings=s;if(history)rows=history.records||[];
    ctx.render();
    if(s.enabled) {
      setTimeout(()=>{if(modal&&key()===k&&settings===s)ctx.qr('qr-checkin-code',qrUrl(),280);},0);
    }
    clearTimeout(timer);
    timer=setTimeout(()=>{if(modal&&key()===k)refresh(false).catch(e=>{settings=null;message=errorText(e);ctx.render();});},45000);
  }
  async function open(){
    modal=true;settings=null;rows=[];message='正在讀取報到資料…';ctx.render();
    try{await refresh();message='';}catch(e){message=errorText(e);}
    ctx.render();
  }
  async function configure(enabled){
    const k=key();busy=true;ctx.render();
    try{await call({action:'configure',code:ctx.state().cloudCode,enabled});if(key()!==k)return;await refresh();message='';}
    catch(e){if(key()===k)message=errorText(e);}
    finally{busy=false;ctx.render();}
  }
  async function manual(player,checkedIn){
    if(busy)return;
    const k=key(),code=ctx.state().cloudCode,operationId=crypto.randomUUID();
    busy=true;ctx.render();
    try{
      const r=await call({action:checkedIn?'manual':'revoke',code,playerId:player.id,operationId});
      if(key()!==k)return;
      if(r.ok!==true)throw Error('not-confirmed');
      // Reload server state; never save an old local snapshot after success.
      const remote=await window.cloudSync.joinRoom(code);
      if(key()!==k)return;
      if(remote?.ok!==true)throw Error('readback-failed');
      ctx.applyRemote(remote.data);ctx.toast(checkedIn?'報到成功':'已撤銷報到');
    }catch(e){if(key()===k)ctx.toast(errorText(e),true);}
    finally{busy=false;ctx.render();}
  }
  async function scan(force=false){
    const e=entry(),uid=identity();if(!e||!uid||scanBusy)return;
    const k=uid+':'+e.code+':'+e.token;
    if(!force&&scanStarted===k)return;
    scanStarted=k;scanBusy=true;scanResult=null;ctx.render();
    try{
      const r=await call({action:'scan',...e});
      if(identity()!==uid)return;
      if(r.ok!==true)throw Error('not-confirmed');
      scanResult=r;
      const url=new URL(location.href);url.searchParams.delete('checkin');url.searchParams.delete('checkinToken');history.replaceState(null,'',url.href);
    }catch(error){if(identity()===uid)scanResult={error:errorText(error)};}
    finally{scanBusy=false;ctx.render();}
  }
  function renderEntry(){
    const e=entry();
    if(!e&&!scanResult&&!scanBusy)return '';
    if(e&&!identity())return '<section class="panel" role="status"><b>現場報到</b><p>請先登入您的 ARENA 帳號，登入後自動完成正取報到。</p></section>';
    if(e&&!scanStarted&&!scanBusy)setTimeout(()=>scan(),0);
    const r=scanResult;
    return '<section class="panel" role="status" aria-live="polite"><h2>'+(!r?'正在確認報到…':r.error?'報到尚未完成':r.already?'您已完成報到':'報到成功')+'</h2>'+(r?.error?'<p>'+esc(r.error)+'</p><button class="btn btn-primary" data-qr-checkin="retry">重試</button>':r?'<p>'+esc(r.name)+'｜'+esc(r.eventName||'')+'｜'+esc(r.code||e?.code||scanStarted.split(':')[1])+'</p><p>'+esc(time(r.currentAt))+'（台灣時間）</p><button class="btn btn-primary" data-qr-checkin="dismiss">完成</button>':'')+'</section>';
  }
  function renderModal(){
    if(!modal)return '';
    if(settings?.enabled)setTimeout(()=>{if(modal&&settings?.enabled)ctx.qr('qr-checkin-code',qrUrl(),280);},0);
    const s=ctx.state(),players=s.players||[];
    return '<div class="modal-overlay"><div class="modal-box" role="dialog" aria-modal="true" aria-label="現場報到"><h2>現場報到</h2><p>'+esc(s.meta?.name)+'｜'+esc(s.cloudCode)+'</p><p>正取 '+players.length+' 人｜已報到 '+players.filter(p=>p.checkedIn).length+' 人｜未報到 '+players.filter(p=>!p.checkedIn).length+' 人</p>'+
      '<div class="btn-row"><button class="btn btn-primary" data-qr-checkin="'+(settings?.enabled?'stop':'start')+'" '+(busy||!settings?'disabled':'')+'>'+(settings?.enabled?'停止報到':'開始報到')+'</button><button class="btn btn-ghost" data-qr-checkin="refresh" '+(busy?'disabled':'')+'>更新紀錄</button><button class="btn btn-ghost" data-qr-checkin="fullscreen" '+(!settings?.enabled?'disabled':'')+'>全螢幕 QR</button></div>'+
      (settings?.enabled?'<div id="qr-checkin-display" style="text-align:center;background:#fff;color:#111;padding:20px"><h3>正取選手掃碼報到</h3><div id="qr-checkin-code" style="display:flex;justify-content:center"></div><p>QR 每 45 秒更新，請掃描現場畫面</p></div>':'<p>QR 報到未開放</p>')+
      '<p role="status">'+esc(message)+'</p><h3>最近 100 筆報到異動</h3><div style="max-height:240px;overflow:auto">'+rows.map(r=>'<p>'+esc(r.name||'報到窗口')+'｜'+esc(({scan:'QR 報到',manual:'人工報到',revoke:'撤銷報到',open:'開啟報到',close:'停止報到'})[r.action]||r.action)+'｜'+esc(time(r.at))+'<br><small>操作帳號：'+esc(r.actorUid)+'</small></p>').join('')+'</div><p class="hint">備取請先由工作人員移入正取，再掃碼或人工報到。</p><button class="btn btn-ghost btn-block" data-qr-checkin="close">關閉</button></div></div>';
  }
  document.addEventListener('click',async event=>{
    const b=event.target.closest('[data-qr-checkin]');if(!b||!ctx)return;
    event.preventDefault();event.stopImmediatePropagation();
    const a=b.dataset.qrCheckin;
    if(a==='open')await open();
    if(a==='close'){modal=false;clearTimeout(timer);ctx.render();}
    if(a==='start'||a==='stop')await configure(a==='start');
    if(a==='refresh'){try{await refresh();}catch(e){message=errorText(e);ctx.render();}}
    if(a==='fullscreen'){try{await document.getElementById('qr-checkin-display')?.requestFullscreen();}catch{ctx.toast('此裝置不支援全螢幕',true);}}
    if(a==='retry')await scan(true);
    if(a==='dismiss'){scanResult=null;ctx.render();}
  },true);
  window.BXHQrCheckin={
    bind(context){
      ctx=context;
      const nextKey=key();
      if(boundKey!==nextKey){modal=false;settings=null;scanStarted='';scanResult=null;clearTimeout(timer);boundKey=nextKey;}
      if(entry()&&identity()&&!scanBusy)setTimeout(()=>scan(),0);
    },
    button(){return '<button class="btn btn-primary" data-qr-checkin="open">現場報到 QR／紀錄</button>';},
    renderEntry,renderModal,manual,
    managed(){return ctx?.state().qrCheckinManaged===true;}
  };
})();

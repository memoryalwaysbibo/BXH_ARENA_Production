(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reasonText={
    'not-deferred':'未處於 PASS 等待','players-waiting':'等待晉級，雙方選手尚未確定','offline-pending':'原裝置有離線資料待同步','match-paused':'比賽暫停或等待接管','pass-waiting':'等待 PASS 前置場次完成','legacy-recovery-pending':'等待雲端恢復舊 PASS 排程','previous-round-waiting':'上一輪仍有待打場次','no-pass-alternative':'本輪無其他可延後場次，請使用暫停比賽'
  };
  function reason(st,m,bindings){
    if(m.completed)return '已完成';
    if(!m.a||!m.b)return reasonText['players-waiting'];
    if(m.offlinePendingSync)return reasonText['offline-pending'];
    if(m.status==='paused'||m.forceDetached)return reasonText['match-paused'];
    if(m.skippedAt){const r=root.BXHPassReturn.readiness(st,m);if(!r.ok)return reasonText[r.reason]||'等待回補條件';}
    else if(m.status==='in_progress'||Object.values(st.courtAssignments||{}).some(c=>c.currentMatchId===m.id))return '已在其他台安排／進行中';
    if(bindings.blocked(m))return reasonText['previous-round-waiting'];
    return m.skippedAt?'可回補':'尚不可接手';
  }
  function idle(st,n,b){
    if(!root.BXHPassReturn.supported(st)||!st.startedAt||!b.canOperate(n))return '';
    if(st.courtAssignments?.['court'+n]?.status==='paused')return '<div class="hint">本台已暫停，恢復後才能接手場次。</div>';
    const available=new Set(b.candidates(n).map(m=>m.id));
    const matches=(st.matches||[]).filter(m=>!m.isBye&&!m.completed).sort((a,c)=>Number(a.seq||0)-Number(c.seq||0));
    const readyPass=m=>m.skippedAt&&root.BXHPassReturn.readiness(st,m,{manual:true}).ok&&!b.blocked(m);
    const ordered=matches.slice().sort((a,c)=>Number(available.has(c.id)||readyPass(c))-Number(available.has(a.id)||readyPass(a))||Number(a.seq||0)-Number(c.seq||0));
    const rows=ordered.slice(0,12).map(m=>{
      const ok=available.has(m.id)||readyPass(m);
      const names=m.a&&m.b?b.name(m.a.playerId)+' vs '+b.name(m.b.playerId):'選手待定';
      const disabled=ok?'':'disabled';
      return `<div class="pass-return-candidate"><span><b>${esc(b.label(m))}</b> ${esc(names)}</span><small>${esc(ok?(m.skippedAt?'可回補':'可接手'):reason(st,m,b))}</small><button type="button" class="btn btn-ghost btn-sm" data-action="${m.skippedAt?'claim-skipped-match':'idle-court-claim'}" data-id="${esc(m.id)}" data-station="${n}" ${disabled}>${m.skippedAt?'指定回補台':'接手至台'+n}</button></div>`;
    }).join('');
    return `<details class="pass-return-tools panel"><summary>可接手場次（${available.size+matches.filter(readyPass).length}）</summary><div class="hint">依序列出可接手場次，最多顯示 12 場。</div>${rows||'<div class="empty-state">目前沒有待打場次</div>'}</details>`;
  }
  function skipped(st,b){
    const matches=(st.matches||[]).filter(m=>!m.isBye&&!m.completed&&m.skippedAt).sort((a,c)=>Number(a.passReturn?.readyAt||Infinity)-Number(c.passReturn?.readyAt||Infinity)||Number(a.skippedAt)-Number(c.skippedAt));
    if(!matches.length)return '';
    const targets=Array.from({length:b.courtCount},(_,i)=>i+1).filter(n=>b.accepts(n)&&b.canOperate(n));
    const rows=matches.map(m=>{
      const p=m.passReturn,ready=root.BXHPassReturn.readiness(st,m).ok&&!b.blocked(m);
      const manualReady=root.BXHPassReturn.readiness(st,m,{manual:true}).ok&&!b.blocked(m);
      const origin=p?.originStation||m.station,assigned=p?.assignedStation||p?.requestedStation;
      const status=!ready?reason(st,m,b):assigned?'已安排台'+assigned:'條件已滿足，等待空台';
      const waited=Math.max(0,Math.floor((b.now-Number(p?.skippedAt||m.skippedAt))/60000));
      const controls=b.canManage?`<details><summary>指定回補台</summary><div class="btn-row">${targets.map(n=>`<button type="button" class="btn btn-ghost btn-sm" data-action="claim-skipped-match" data-id="${esc(m.id)}" data-station="${n}" ${!manualReady||b.busy?'disabled':''}>台${n}${root.BXHPassReturn.idle(st,n)?'｜空閒':'｜忙碌後回補'}</button>`).join('')}</div></details>`:'';
      return `<div class="panel pass-return-row"><strong>${esc(b.label(m))}｜${esc(m.a&&m.b?b.name(m.a.playerId)+' vs '+b.name(m.b.playerId):'等待晉級')}</strong><div class="hint">原台 ${Number(origin)}｜${assigned?'安排台 '+Number(assigned):'尚未派台'}｜等待 ${waited} 分鐘</div><div class="hint">${esc(status)}</div>${controls}</div>`;
    }).join('');
    return `<section class="panel"><div class="panel-title">PASS 自動回補（${matches.length}）</div><p class="hint">自動回補：條件滿足後原台優先。手動指定：可略過 PASS 前置等待，空台立即回補，忙碌台待目前場次結束。保留原比分與紀錄。</p>${rows}</section>`;
  }
  const notifyKey=(code,m)=>'bxh.pass-notified:'+code+':'+m.id+':'+Number(m.station)+':'+Number(m.dispatchRevision||0);
  function acknowledged(code,m){try{return root.sessionStorage?.getItem(notifyKey(code,m))==='sent';}catch{return false;}}
  function acknowledge(code,m){try{root.sessionStorage?.setItem(notifyKey(code,m),'sent');}catch{}}
  function notice(st,m,busy){
    if(!m.passReturn?.assignedAt)return '';
    const sent=acknowledged(st.cloudCode,m);
    const changed=Number(m.passReturn.originStation)!==Number(m.station);
    return `<div class="banner ${sent?'':'warn'} pass-return-notice"><span>PASS 已回補至台${Number(m.station)}${changed?'（原台'+Number(m.passReturn.originStation)+'）':''}｜${sent?'本裝置已確認叫號':'請通知選手確認台號'}</span><button type="button" class="btn btn-ghost btn-sm" data-action="court-call-notify" data-code="${esc(st.cloudCode)}" data-match="${esc(m.id)}" ${busy?'disabled':''}>重新通知選手</button></div>`;
  }
  root.BXHPassReturnUI={idle,skipped,reason,reasonText,notice,acknowledge};
})(typeof window==='undefined'?globalThis:window);

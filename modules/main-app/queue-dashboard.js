(function(root){
  'use strict';
  // Read-only projection: public courtAssignments is authoritative for current
  // and next. Public matches omit dispatchPriorityAt/retirement state, so never
  // reconstruct a longer queue from seed numbers, seq, or initial station hints.
  const text = value => String(value == null ? '' : value);
  const esc = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => text(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');
  function findPlayerId(st, registration, profile={}){
    const players=Array.isArray(st?.players)?st.players:[],r=registration||{};
    if(r.familyPlayerId){
      const rows=players.filter(p=>p.id==='family_'+r.familyPlayerId||p.familyPlayerId===r.familyPlayerId);
      return rows.length===1?rows[0].id:null;
    }
    const token=value=>text(value).replace(/[^a-zA-Z0-9_-]/g,'_');
    const ids=[r.localPlayerId,r.runtimePlayerId,r.playerId,r.participantId,r.registrationId,r.id,r.uid,
      r.registrationId?'reg_'+token(r.registrationId):null,r.uid?'reg_'+token(r.uid):null].filter(Boolean);
    const linked=players.filter(p=>ids.includes(p.id)||(r.registrationId&&p.registrationId===r.registrationId));
    if(linked.length)return linked.length===1?linked[0].id:null;
    const names=[r.displayName,r.publicName,r.participantName,r.realName].map(norm).filter(Boolean);
    const rows=players.filter(p=>names.includes(norm(p.name)));
    // Legacy public mirrors carry only id/name. Ambiguous names must never
    // claim somebody else's match or silently select the first participant.
    return rows.length===1?rows[0].id:null;
  }
  function playerNumber(st,id){
    if(!id)return '';
    const size=Number(st.bracketSize);
    if((st.meta?.formatType||'single')==='single'&&Number.isInteger(size)&&size>0&&size<=16384){
      let order=[1];
      while(order.length<size){const total=order.length*2+1;order=order.flatMap(n=>[n,total-n]);}
      for(const m of st.matches||[]){
        if(Number(m.round)!==0||m.bracket==='BZ')continue;
        const base=(Number(m.indexInRound)||0)*2;
        if(m.a?.playerId===id)return text(order[base]||'');
        if(m.b?.playerId===id)return text(order[base+1]||'');
      }
    }
    const index=(st.players||[]).findIndex(p=>p.id===id);
    return index<0?'':text(index+1);
  }
  function person(st,id,fallback='待定'){
    const p=(st?.players||[]).find(p=>p.id===id);
    return {id:id||null,name:p?.name||fallback,number:p?playerNumber(st,id):''};
  }
  function courts(st){
    if(!st)return [];
    const matches=Array.isArray(st.matches)?st.matches:[],assignments=st.courtAssignments||{};
    const n=Number(st.meta?.stations),count=Number.isInteger(n)&&n>0?n:0;
    const references=new Map();
    for(let station=1;station<=count;station++){
      const c=assignments['court'+station]||{};
      for(const id of [c.currentMatchId,c.nextMatchId])if(id)references.set(id,(references.get(id)||0)+1);
    }
    return Array.from({length:count},(_,i)=>{
      const station=i+1,c=assignments['court'+station]||{};
      const valid=id=>{
        const rows=matches.filter(m=>m.id===id),m=rows[0];
        if(rows.length!==1||references.get(id)!==1||m.completed||m.status==='completed'||m.isBye||Number(m.station)!==station||c.status==='retired')return null;
        if(st.forcedCourtExits?.[station]?.closed)return null;
        if(m.skippedAt&&m.skipManualOnly&&!m.resumeQueuedAt)return null;
        return m;
      };
      let current=valid(c.currentMatchId),next=valid(c.nextMatchId);
      // A deferred PASS cannot become current while its required predecessor
      // is still outstanding. Keep a valid assigned PASS next behind that one.
      const waiting=m=>(m?.callPass?.waitFor||m?.skipWaitFor||[]).filter(id=>{
        const rows=matches.filter(x=>x.id===id);
        return rows.length!==1||(!rows[0].completed&&rows[0].status!=='completed');
      });
      if(current&&(current.skippedAt||waiting(current).length))current=null;
      if(next&&((next.skipManualOnly&&!next.resumeQueuedAt)||['paused','in_progress'].includes(next.status)||waiting(next).some(id=>id!==current?.id)))next=null;
      const ready=m=>m?.a?.playerId&&m?.b?.playerId&&m.a.playerId!==m.b.playerId&&[m.a.playerId,m.b.playerId].every(id=>(st.players||[]).filter(p=>p.id===id).length===1);
      if(current&&!ready(current))current=null;
      if(next&&!ready(next))next=null;
      const paused=c.status==='paused'||current?.status==='paused';
      return {station,current,next,paused,assigned:!!assignments['court'+station]};
    });
  }
  function model(registration,info,profile={}){
    const r=registration||{},st=info?.parsedData,pid=findPlayerId(st,r,profile);
    const me=person(st,pid,r.displayName||r.publicName||r.realName||'參賽者');
    const base={kind:'pending',ahead:null,station:null,playerId:pid,me,opponent:null,courts:[],message:'等待賽事對戰資料同步'};
    if(info?.battleMode==='team'||st?.meta?.battleMode==='team')return {...base,message:'團體戰請查看本隊出場順序'};
    if(!st||!Array.isArray(st.matches)||!Array.isArray(st.players))return base;
    base.courts=courts(st);
    if(r.status!=='confirmed')return {...base,kind:'waitlist',message:'正取後顯示候場資訊'};
    if(info.tournamentPhase==='done'||st.archiveStatus==='completed')return {...base,kind:'done',message:'本場賽程已完成'};
    if(!pid)return {...base,message:'尚未確認你的出賽身分，請查看對戰表'};
    if(!st.startedAt&&info.tournamentPhase!=='live')return {...base,kind:'waiting',message:'等待賽事開始'};
    const mine=st.matches.filter(m=>m&&!m.completed&&m.status!=='completed'&&!m.isBye&&(m.a?.playerId===pid||m.b?.playerId===pid));
    const current=base.courts.find(c=>mine.some(m=>m.id===c.current?.id));
    const next=base.courts.find(c=>mine.some(m=>m.id===c.next?.id));
    const court=current||next,target=current?.current||next?.next||(mine.length===1?mine[0]:null);
    if(!target&&mine.length>1)return {...base,message:'等待排台，對手與順位待確認'};
    if(!target){
      const losses=st.matches.filter(m=>(m.completed||m.status==='completed')&&m.loserId===pid),lost=losses.length>0;
      const semifinalRound=Math.log2(Number(st.bracketSize))-2;
      const bronze=st.matches.find(m=>m.bracket==='BZ');
      const bronzePending=st.meta?.bronzeMatch&&losses.some(m=>Number(m.round)===semifinalRound&&m.bracket!=='BZ')&&(!bronze||(!bronze.completed&&bronze.status!=='completed'));
      const done=lost&&st.meta?.formatType==='single'&&!bronzePending;
      return {...base,kind:done?'done':'pending',message:done?'本場個人賽程已結束':'下一輪對戰尚未產生'};
    }
    const opponent=person(st,target.a?.playerId===pid?target.b?.playerId:target.a?.playerId);
    const result={...base,opponent,matchId:target.id,station:court?.station||null};
    if(info.queueSyncFailed)return {...result,message:'資料更新暫停，請重新整理'};
    if(current)return {...result,kind:current.paused?'paused':target.status==='in_progress'?'playing':'called',ahead:0,message:current.paused?'你的對戰暫停中':'輪到你了，請前往戰鬥台'};
    if(!target.a?.playerId||!target.b?.playerId)return {...result,message:'等待下一輪對手確認'};
    if(next)return {...result,kind:'soon',ahead:next.current?1:null,message:next.paused?'前場暫停，請留意現場叫號':next.current?'下一場就是你':'等待現場確認上場'};
    return {...result,message:target.skippedAt?'已延後，等待重新排台':'等待排台，順位尚未確認'};
  }
  const personText=p=>p?`${p.number?p.number+'號｜':''}${p.name}`:'待定';
  function html(r,info,m,controls=''){
    const st=info?.parsedData,numbered=typeof m.ahead==='number';
    const status={playing:'正在上場',called:'準備上場',paused:'暫停中',soon:'下一場',done:'已完成',waitlist:'備取'}[m.kind]||'候場中';
    const row=(label,match,current=false)=>`<div class="queue-court-row ${current?'is-current':''}"><span class="queue-row-label">${esc(label)}</span>${match?`<div class="queue-versus"><span class="queue-player">${esc(personText(person(st,match.a?.playerId)))}</span><span class="queue-vs">VS</span><span class="queue-player">${esc(personText(person(st,match.b?.playerId)))}</span></div>`:'<span class="queue-empty">等待安排</span>'}</div>`;
    return `<section class="queue-dashboard" data-queue-key="dashboard:${esc(r.tournamentCode)}:${esc(r.familyPlayerId||r.registrationId||m.playerId||'self')}">
      <section class="queue-self-card" aria-label="我的候場">
        <div class="queue-self-head"><h3>我的候場</h3><span class="queue-status">${esc(status)}</span></div>
        <div class="queue-player-identity">${esc(personText(m.me))}</div>
        <div class="queue-self-stats"><div><div class="queue-ahead-label">${numbered?'前面還有':'候場狀態'}</div><div class="queue-ahead-value ${numbered?'':'is-pending'}">${numbered?`<span>${m.ahead}</span><small>場</small>`:esc(m.station?'順位待確認':'等待排台')}</div></div><div class="queue-station"><span>安排台次</span><strong>${m.station?'第 '+m.station+' 台':'尚未排台'}</strong></div></div>
        <div class="queue-opponent"><span>對手</span><strong>${esc(personText(m.opponent))}</strong></div>
        <p class="queue-note" role="status">${esc(m.message)}</p>
        <p class="queue-note">${info?.queueSyncFailed?'暫時顯示上次同步的場次，請以現場叫號為準。':'場數包含進行中場次；僅顯示已確認的目前／下一場順位。其餘等待現場排台。'+(info?.queueAutoRefresh===false?' 提醒關閉時，請按重新整理更新場次。':' 約每 20 秒更新。')}</p>
        <button type="button" class="btn btn-ghost queue-bracket-button" data-action="switch-to-player-watch" data-view="bracket" data-return="registered" data-code="${esc(r.tournamentCode)}">查看對戰表 <span aria-hidden="true">›</span></button>
      </section>
      ${m.courts.length?`<div class="queue-courts-head"><h3>各台即時戰況</h3><span>${m.courts.filter(c=>c.current&&!c.paused).length} 台進行中</span></div><div class="queue-courts-list">${m.courts.map(c=>`<section class="queue-court-card ${c.station===m.station?'is-mine':''}" data-queue-key="court:${c.station}"><div class="queue-court-head"><strong>第 ${c.station} 台</strong>${c.station===m.station?'<span class="queue-court-tag">你的台次</span>':''}</div>${row(c.paused?'暫停中':c.current&&c.current.status!=='in_progress'?'準備上場':'進行中',c.current,true)}${row('下一場',c.next)}</section>`).join('')}</div>`:''}
      ${controls?`<div class="queue-call-controls">${controls}</div>`:''}
    </section>`;
  }
  // Reconcile only the registered screen. Existing nodes/buttons remain in place
  // for score/assignment updates; no whole-screen innerHTML replacement flicker.
  let mounted=null;const templates=new WeakMap();
  function key(node){return node.nodeType===1?(node.getAttribute('data-queue-key')||node.id||(node.hasAttribute('data-action')?'action:'+['data-action','data-code','data-tab','data-section','data-match','data-participant'].map(k=>node.getAttribute(k)||'').join(':'):'')):'';}
  function remember(node,template=node){templates.set(node,template.nodeType===1?template.outerHTML:template.nodeValue);[...node.childNodes].forEach((n,i)=>template.childNodes[i]&&remember(n,template.childNodes[i]));}
  function patch(node,next){
    const signature=next.nodeType===1?next.outerHTML:next.nodeValue;
    if(templates.get(node)===signature)return;
    if(node.nodeType!==1){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;templates.set(node,signature);return;}
    for(const attr of [...node.attributes])if(!next.hasAttribute(attr.name)&&!(attr.name==='open'&&node.tagName==='DETAILS'))node.removeAttribute(attr.name);
    for(const attr of [...next.attributes])if(node.getAttribute(attr.name)!==attr.value&&!(attr.name==='open'&&node.tagName==='DETAILS'))node.setAttribute(attr.name,attr.value);
    if(!['INPUT','TEXTAREA','SELECT'].includes(node.tagName))children(node,next);
    templates.set(node,signature);
  }
  function children(parent,next){
    const old=[...parent.childNodes],used=new Set(),groups=new Map();
    const token=n=>n.nodeType+':'+n.nodeName+':'+key(n);
    for(const n of old){const k=token(n);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(n);}
    let cursor=parent.firstChild;
    for(const n of [...next.childNodes]){
      const existing=groups.get(token(n))?.shift();
      const child=existing||n.cloneNode(true);used.add(child);
      if(child!==cursor)parent.insertBefore(child,cursor);
      if(existing)patch(child,n);else remember(child);
      cursor=child.nextSibling;
    }
    for(const n of old)if(!used.has(n))n.remove();
  }
  function renderStable(app,markup,context){
    if(!mounted||mounted.context!==context||mounted.root!==app.firstElementChild){app.innerHTML=markup;remember(app);mounted={context,root:app.firstElementChild};return false;}
    const fragment=document.createElement('template');fragment.innerHTML=markup;children(app,fragment.content);return true;
  }
  const api={findPlayerId,playerNumber,courts,model,html,renderStable};
  root.BXHQueueDashboard=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);

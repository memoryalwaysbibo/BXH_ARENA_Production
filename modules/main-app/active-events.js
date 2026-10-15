(function(root){
  'use strict';
  const SCHEMA=1,MAX_ROOMS=64,CONCURRENCY=4;
  const codeOK=value=>typeof value==='string'&&/^[A-Z0-9-]{4,40}$/.test(value);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const completed=m=>m?.completed===true||m?.status==='completed';
  const phase=(room)=>{
    const st=room?.parsedData;
    if(room?.systemClosed===true||(st?.systemClosure&&!st.systemClosure.restoredAt))return 'finished';
    if(room?.eventCancelled===true||room?.tournamentPhase==='cancelled'||st?.meta?.eventCancelled===true)return 'finished';
    if(room?.tournamentPhase==='done'||room?.archiveStatus==='completed'||st?.archiveStatus==='completed')return 'finished';
    if(room?.tournamentPhase==='live'||room?.tournamentPhase==='settling'||st?.startedAt)return 'current';
    if(room?.tournamentPhase==='waiting'&&!st?.startedAt)return 'waiting';
    return 'unknown';
  };
  // This is intentionally independent of the legacy queue name fallback.
  function classify(participant,room){
    const p=participant||{},st=room?.parsedData,roomPhase=phase(room);
    if(roomPhase==='finished')return {group:'finished',reason:'本場已結束或關閉'};
    if(['cancelled','not_selected'].includes(p.registrationStatus))return {group:'finished',reason:'已取消或未入選'};
    if(!['confirmed','waitlist','pending_draw'].includes(p.registrationStatus))return {group:'unknown',reason:'參賽資格尚待核對'};
    if(roomPhase==='unknown')return {group:'unknown',reason:'賽事狀態尚待核對'};
    if(p.registrationStatus!=='confirmed')return {group:'waiting',reason:p.registrationStatus==='waitlist'?'備取中':'等待抽籤'};
    if(roomPhase==='waiting')return {group:'waiting',reason:'等待實際開賽'};
    if(!st||!Array.isArray(st.matches)||!Array.isArray(st.players))return {group:'unknown',reason:'對戰資料尚未完整'};
    const pid=p.participantId;
    if(typeof pid!=='string'||!pid)return {group:'unknown',reason:'尚未確認帳號對應的參賽身分'};
    if(room.battleMode==='team'||st.meta?.battleMode==='team'){
      const team=(st.teams||[]).filter(t=>t.id===pid);
      if(team.length!==1)return {group:'unknown',reason:'隊伍身分尚待核對'};
      const open=st.matches.some(m=>!completed(m)&&!m.isBye&&Array.isArray(m.teamIds)&&m.teamIds.includes(pid));
      return open?{group:'current',reason:'隊伍賽程進行中',name:team[0].name}:{group:'unknown',reason:'隊伍後續賽程尚待核對',name:team[0].name};
    }
    const players=st.players.filter(player=>player.id===pid);
    if(players.length!==1)return {group:'unknown',reason:'公開名單尚未對上可信參賽身分'};
    const name=players[0].name;
    const mine=st.matches.filter(m=>m&&(m.a?.playerId===pid||m.b?.playerId===pid));
    if(mine.some(m=>!completed(m)&&!m.isBye))return {group:'current',reason:'仍有賽程／候場中',name};
    const losses=mine.filter(m=>completed(m)&&!m.isBye&&m.loserId===pid);
    if(st.meta?.formatType==='single'&&losses.length){
      if(typeof st.meta.bronzeMatch!=='boolean')return {group:'unknown',reason:'季軍賽設定尚待核對',name};
      const size=Number(st.bracketSize);
      if(st.meta.bronzeMatch&&(!Number.isInteger(size)||size<4||(size&(size-1))!==0))return {group:'unknown',reason:'季軍賽資格尚待核對',name};
      const semifinal=Math.log2(size)-2;
      if(st.meta.bronzeMatch&&losses.some(m=>m.bracket!=='BZ'&&(!Number.isInteger(m.round)||m.round<0||m.round>Math.log2(size)-1)))return {group:'unknown',reason:'落敗輪次尚待核對',name};
      const bronze=st.matches.find(m=>m.bracket==='BZ');
      const bronzePending=st.meta.bronzeMatch&&losses.some(m=>Number(m.round)===semifinal&&m.bracket!=='BZ')&&(!bronze||!completed(bronze));
      if(!bronzePending)return {group:'finished',reason:'本人的單淘汰賽程已結束',name};
      return {group:'current',reason:'等待季軍賽',name};
    }
    // Public mirrors do not carry every progression edge. No assigned match
    // is not proof of elimination, especially in double elimination/team play.
    return {group:'unknown',reason:'後續輪次或個人完賽狀態尚待核對',name};
  }
  function validateIndex(index){
    if(!index||index.schemaVersion!==SCHEMA)return 'unsupported-index';
    if(index.status!=='ready')return index.status==='error'?'index-error':'index-pending';
    if(!index.generation||!Number.isSafeInteger(index.revision)||index.revision<0||!Array.isArray(index.memberships))return 'invalid-index';
    if(index.memberships.length>MAX_ROOMS)return 'index-overflow';
    const seen=new Set();
    for(const m of index.memberships){
      if(m?.schemaVersion!==SCHEMA||m.generation!==index.generation||!codeOK(m.code)||seen.has(m.code)||typeof m.sourceRevision!=='string'||!m.sourceRevision||!Array.isArray(m.participants)||!m.participants.length)return 'invalid-membership';
      seen.add(m.code);
      for(const p of m.participants){
        if(!p||!['self','family','team-captain','linked-local'].includes(p.kind))return 'invalid-participant';
      }
    }
    return null;
  }
  async function mapBounded(items,fn,valid=()=>true){
    let cursor=0;const rows=new Array(items.length);
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},async()=>{
      while(valid()){
        const i=cursor++;if(i>=items.length)return;
        try{rows[i]=await fn(items[i]);}catch(error){rows[i]={error:String(error?.code||error?.message||'read-failed')};}
      }
    }));
    return rows;
  }
  function createController({owner,readIndex,readRoom,onChange=()=>{},now=Date.now,timeoutMs=10000}){
    let key='',state={status:'idle',rows:[]},request=0,inFlight=null,known=new Map();
    const ownerKey=o=>o?.uid?o.uid+'|'+o.epoch:'';
    function sync(){
      const next=ownerKey(owner());
      if(next!==key){key=next;request++;state={status:'idle',rows:[]};known=new Map();inFlight=null;}
      return key;
    }
    function snapshot(){sync();return state;}
    function invalidate(){sync();request++;state={status:'idle',rows:[]};onChange();}
    function noteKnownEvent(code,expectedSourceRevision){
      if(!sync()||!codeOK(code))return;
      known.set(code,{expectedSourceRevision:typeof expectedSourceRevision==='string'?expectedSourceRevision:null});
      invalidate();
    }
    function load(force=false){
      sync();if(!key)return Promise.resolve(state);
      if(inFlight)return inFlight;
      if(!force&&state.status!=='idle')return Promise.resolve(state);
      const context={...owner()},capturedKey=key,id=++request;
      const current=()=>ownerKey(owner())===capturedKey&&key===capturedKey&&request===id;
      state={status:'loading',rows:[],startedAt:now()};onChange();
      let timer;
      // Keep the underlying promise single-flight even after the UI deadline:
      // a timeout cannot cancel a Firestore read and must not trigger overlap.
      const work=(async()=>{
        try{
          const index=await readIndex(context);if(!current())return state;
          const problem=validateIndex(index);
          if(problem){state={status:problem==='index-pending'?'syncing':'error',reason:problem,rows:[]};return state;}
          const memberships=index.memberships;
          const rooms=await mapBounded(memberships,m=>readRoom(m.code,context),current);
          if(!current())return state;
          const rows=[];
          memberships.forEach((m,i)=>{
            const room=rooms[i];
            if(!room||room.error||room.visibility!=='public'){
              rows.push({code:m.code,group:'unknown',reason:'這場資料暫時無法讀取或未公開',accessible:false});return;
            }
            let familyNumber=0;
            for(const p of m.participants)rows.push({code:m.code,title:room.name||m.code,participant:p,participantLabel:p.kind==='family'?'家庭選手 '+(++familyNumber):p.kind==='team-captain'?'本人代表的隊伍':'本人',...classify(p,room),accessible:true});
          });
          for(const [code,pending] of known){
            const m=memberships.find(item=>item.code===code);
            if(pending.expectedSourceRevision&&m?.sourceRevision===pending.expectedSourceRevision){known.delete(code);continue;}
            rows.push({code,group:'unknown',reason:'剛才的參賽變更仍待索引核對',accessible:false});
          }
          state={status:'ready',rows,generation:index.generation,revision:index.revision,loadedAt:now(),confirmedEmpty:rows.every(r=>r.group!=='current'&&r.group!=='unknown')};
        }catch(error){if(current())state={status:'error',reason:String(error?.code||error?.message||'read-failed'),rows:[]};}
        finally{clearTimeout(timer);if(current())onChange();}
        return state;
      })();
      const flight=work.finally(()=>{
        if(inFlight===flight){
          inFlight=null;
          if(key===capturedKey&&ownerKey(owner())===capturedKey){
            if(state.retryBlocked){state={...state,retryBlocked:false};onChange();}
            else if(state.status==='idle')onChange();
          }
        }
      });inFlight=flight;
      timer=setTimeout(()=>{
        if(!current())return;
        request++;state={status:'error',reason:'read-timeout',rows:[],retryBlocked:true};onChange();
      },timeoutMs);
      return flight;
    }
    return {snapshot,load,invalidate,noteKnownEvent};
  }
  function html(state){
    const header='<div class="panel-title">我的目前賽事<button class="btn btn-ghost btn-sm" data-action="active-events-refresh"'+(state.retryBlocked?' disabled':'')+'>重新整理</button></div>';
    if(state.retryBlocked)return header+'<section class="panel" role="alert">資料讀取已逾時，原請求仍未結束。請重新載入頁面再試，避免重複發送。<button class="btn btn-ghost" data-action="active-events-reload">重新載入頁面</button></section>';
    if(['idle','loading'].includes(state.status))return header+'<section class="panel" role="status">正在查詢你的賽事清單……</section>';
    if(state.status==='syncing')return header+'<section class="panel" role="status">你的賽事清單仍在建立或更新，尚不能確認目前是否有賽事。</section>';
    if(state.status==='error')return header+'<section class="panel" role="alert">目前無法確認你的賽事，請稍後重新整理。這不代表你沒有賽事。</section>';
    const card=r=>'<article class="find-event-card"><strong>'+esc(r.title||r.code)+'</strong>'+(r.name||r.participantLabel?'<p>'+esc(r.name||r.participantLabel)+(r.name&&r.participant?.kind==='family'?'（家庭選手）':'')+'</p>':'')+'<p>'+esc(r.reason)+'</p>'+(r.accessible?'<button class="btn btn-ghost btn-sm" data-action="view-public-tournament" data-code="'+esc(r.code)+'">查看賽事</button>':'')+'</article>';
    let out=header;
    const current=state.rows.filter(r=>r.group==='current');
    if(current.length)out+='<section class="panel"><h3>目前進行中</h3>'+current.map(card).join('')+'</section>';
    else if(state.confirmedEmpty)out+='<section class="panel" role="status">目前已同步的賽事中，沒有進行中的個人賽程。</section>';
    for(const [group,title] of [['unknown','待核對／更新中'],['waiting','待開賽／待確認'],['finished','本次清單中已結束的賽程']]){
      const rows=state.rows.filter(r=>r.group===group);if(!rows.length)continue;
      out+='<details class="panel"'+(group==='unknown'?' open':'')+'><summary>'+title+'（'+rows.length+'）</summary>'+rows.map(card).join('')+'</details>';
    }
    return out+'<p class="hint">此清單依最近同步的本人參賽資料核對；歷史戰績另行讀取。其他裝置的新變更可能仍在同步。</p>';
  }
  const api={SCHEMA,MAX_ROOMS,CONCURRENCY,classify,validateIndex,mapBounded,createController,html};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BXHActiveEvents=api;
})(typeof window!=='undefined'?window:null);

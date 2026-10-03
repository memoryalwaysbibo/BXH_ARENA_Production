(function(){
  "use strict";

  const ROOM_CODE="BXH-C6BATA";
  const RESCUE_FIELD="c6bataRescueV1";

  function playerId(slot){return slot&&slot.type==="player"&&slot.playerId?String(slot.playerId):null;}
  function edgeList(match){
    const s=match&&match.lbSrc;
    if(!s)return null;
    if(s.type==="first")return [{side:"a",matchId:s.srcAId,kind:"loser"},{side:"b",matchId:s.srcBId,kind:"loser"}];
    if(s.type==="merge")return [{side:"a",matchId:s.survivorMatchId,kind:"winner"},{side:"b",matchId:s.dropperMatchId,kind:"loser"}];
    if(s.type==="combine")return [{side:"a",matchId:s.srcAMatchId,kind:"winner"},{side:"b",matchId:s.srcBMatchId,kind:"winner"}];
    return null;
  }
  function dead(reason,ids=[]){return {status:"dead",reason,deadSourceMatchIds:[...new Set(ids.filter(Boolean))]};}
  function player(pid,reason){return {status:"player",playerId:pid,reason,deadSourceMatchIds:[]};}
  function invalid(reason){return {status:"invalid",reason,deadSourceMatchIds:[]};}
  function hasDecisionData(m){return !!(m&&(m.completed||m.winnerId||m.loserId||Number(m.scoreA||0)!==0||Number(m.scoreB||0)!==0||m.confirmedAt||m.confirmedBy||m.resultMethod||m.hunterData||(Array.isArray(m.log)&&m.log.length)||(Array.isArray(m.faultActions)&&m.faultActions.length)));}
  function sourceFingerprint(st){
    return JSON.stringify({
      id:st&&st.id,cloudCode:st&&st.cloudCode,formatType:st&&st.meta&&st.meta.formatType,
      matches:(st&&Array.isArray(st.matches)?st.matches:[]).map(m=>({id:m.id,bracket:m.bracket,round:m.round,indexInRound:m.indexInRound,a:m.a,b:m.b,lbSrc:m.lbSrc,gfSrc:m.gfSrc,isBye:m.isBye,completed:m.completed,status:m.status,scoreA:m.scoreA,scoreB:m.scoreB,log:m.log,faultActions:m.faultActions,hunterData:m.hunterData,winnerId:m.winnerId,loserId:m.loserId,confirmedBy:m.confirmedBy,confirmedAt:m.confirmedAt,resultMethod:m.resultMethod}))
    });
  }
  function computePlan(st){
    const errors=[];
    if(!st||st.cloudCode!==ROOM_CODE)return {ok:false,errors:["room-code-mismatch"],operations:[],deadMatches:[],stopMatches:[],waiting:[]};
    if(!st.meta||st.meta.formatType!=="double")return {ok:false,errors:["not-double-elimination"],operations:[],deadMatches:[],stopMatches:[],waiting:[]};
    if(st[RESCUE_FIELD])return {ok:false,errors:["rescue-already-committed"],operations:[],deadMatches:[],stopMatches:[],waiting:[]};
    const matches=Array.isArray(st.matches)?st.matches:[];
    const byId=new Map(matches.filter(m=>m&&m.id).map(m=>[String(m.id),m]));
    const visiting=new Set(),memo=new Map();
    function output(matchId,kind){
      const key=String(matchId||"")+"|"+kind;
      if(memo.has(key))return memo.get(key);
      if(!matchId||!byId.has(String(matchId)))return invalid("missing-source:"+String(matchId||"null"));
      if(visiting.has(key))return invalid("source-cycle:"+key);
      visiting.add(key);
      const m=byId.get(String(matchId));
      let result;
      if(m.completed===true){
        const id=kind==="winner"?m.winnerId:m.loserId;
        if(id)result=player(String(id),"recorded-"+kind);
        else if(kind==="loser"&&m.isBye===true)result=dead("completed-bye-no-loser",[m.id]);
        else result=invalid("completed-without-"+kind+"-id:"+m.id);
      }else{
        const edges=edgeList(m);
        if(!edges||edges.length!==2){result=invalid("unsupported-source:"+m.id);}
        else{
          const a=output(edges[0].matchId,edges[0].kind),b=output(edges[1].matchId,edges[1].kind);
          if(a.status==="invalid"||b.status==="invalid")result=invalid("invalid-upstream:"+m.id+":"+a.reason+":"+b.reason);
          else if(a.status==="player"&&b.status==="player")result={status:"unresolved",reason:"manual-match-required:"+m.id,players:[a.playerId,b.playerId],deadSourceMatchIds:[]};
          else if(a.status==="dead"&&b.status==="dead")result=dead("both-sources-dead",[m.id,...a.deadSourceMatchIds,...b.deadSourceMatchIds]);
          else if((a.status==="player"&&b.status==="dead")||(b.status==="player"&&a.status==="dead")){
            const p=a.status==="player"?a:b,d=a.status==="dead"?a:b;
            result=kind==="winner"?{status:"bypass",playerId:p.playerId,reason:"one-player-one-dead-source:"+m.id,deadSourceMatchIds:[...new Set([m.id,...d.deadSourceMatchIds])]}:dead("no-loser-after-empty-source-bypass",[m.id,...d.deadSourceMatchIds]);
          }else result={status:"unresolved",reason:"upstream-not-terminal:"+m.id,deadSourceMatchIds:[]};
        }
      }
      visiting.delete(key);memo.set(key,result);return result;
    }
    const pending=matches.filter(m=>m&&m.bracket==="LB"&&m.completed!==true);
    const deadMatches=[],candidates=[],waiting=[],sourceReadyStops=[];
    for(const m of pending){
      if(hasDecisionData(m)){errors.push("pending-match-has-decision-data:"+m.id);continue;}
      const edges=edgeList(m);
      if(!edges){errors.push("unsupported-lb-source:"+m.id);continue;}
      const sides=edges.map(e=>Object.assign({side:e.side},output(e.matchId,e.kind)));
      if(sides.some(s=>s.status==="invalid")){errors.push("invalid-source-graph:"+m.id+":"+sides.map(s=>s.reason).join("|"));continue;}
      for(const s of sides){
        const current=playerId(m[s.side]);
        if(s.status==="player"&&current!==s.playerId)errors.push("source-slot-mismatch:"+m.id+":"+s.side);
        if(s.status==="dead"&&current)errors.push("dead-source-has-player:"+m.id+":"+s.side);
      }
      if(sides.every(s=>s.status==="player"||s.status==="bypass")){
        const ids=sides.map(s=>s.playerId);
        if(ids[0]&&ids[1]&&ids[0]!==ids[1])sourceReadyStops.push({matchId:m.id,round:m.round+1,index:m.indexInRound+1,playerA:ids[0],playerB:ids[1]});
        else if(ids[0]&&ids[0]===ids[1])errors.push("same-player-match:"+m.id);
      }
      if(sides.every(s=>s.status==="dead")){deadMatches.push({matchId:m.id,round:m.round+1,index:m.indexInRound+1,deadSourceMatchIds:[...new Set(sides.flatMap(s=>s.deadSourceMatchIds||[]))]});continue;}
      if((sides[0].status==="player"&&sides[1].status==="dead")||(sides[1].status==="player"&&sides[0].status==="dead")){
        const occupied=sides[0].status==="player"?sides[0]:sides[1];
        if(!occupied.playerId||playerId(m[occupied.side])!==occupied.playerId){errors.push("bypass-player-not-in-current-slot:"+m.id);continue;}
        candidates.push({sourceMatchId:m.id,sourceRound:m.round+1,sourceIndex:m.indexInRound+1,playerId:occupied.playerId,deadSourceMatchIds:[...new Set(sides.flatMap(s=>s.status==="dead"?(s.deadSourceMatchIds||[]):[]))]});
      }else if(sides.some(s=>s.status==="unresolved")){waiting.push({matchId:m.id,round:m.round+1,index:m.indexInRound+1,reason:"upstream-not-resolved"});}
    }
    const operations=[],stopMatches=sourceReadyStops.slice(),stopMatchIds=new Set(sourceReadyStops.map(x=>String(x.matchId))),usedTargets=new Set();
    for(const c of candidates){
      const consumers=[];
      for(const target of pending){
        const edges=edgeList(target)||[];
        for(const e of edges)if(String(e.matchId)===String(c.sourceMatchId)&&e.kind==="winner")consumers.push({target,slot:e.side});
      }
      if(consumers.length!==1){errors.push("ambiguous-bypass-destination:"+c.sourceMatchId+":"+consumers.length);continue;}
      const {target,slot}=consumers[0],slotKey=slot;
      if(target.completed||hasDecisionData(target)){errors.push("bypass-target-not-pending:"+target.id);continue;}
      if(playerId(target[slotKey])&&playerId(target[slotKey])!==c.playerId){errors.push("bypass-target-slot-conflict:"+target.id+":"+slot);continue;}
      const otherKey=slot==="a"?"b":"a",otherId=playerId(target[otherKey]);
      if(usedTargets.has(target.id+":"+slot)){errors.push("duplicate-bypass-target:"+target.id+":"+slot);continue;}
      usedTargets.add(target.id+":"+slot);
      const op=Object.assign({},c,{targetMatchId:target.id,targetRound:target.round+1,targetIndex:target.indexInRound+1,targetSlot:slot,otherPlayerId:otherId,stopForManualScore:!!otherId});
      operations.push(op);
      if(otherId&&!stopMatchIds.has(String(target.id))){stopMatchIds.add(String(target.id));stopMatches.push({matchId:target.id,round:target.round+1,index:target.indexInRound+1,playerA:slot==="a"?c.playerId:otherId,playerB:slot==="b"?c.playerId:otherId});}
    }
    const allRefs=matches.filter(m=>m&&m.bracket==="LB").flatMap(m=>edgeList(m)||[]);
    for(const e of allRefs)if(!e.matchId||!byId.has(String(e.matchId)))errors.push("dangling-source-reference:"+(e.matchId||"null"));
    const plan={ok:errors.length===0,roomCode:ROOM_CODE,playerCount:(st.players||[]).length,matchCount:matches.length,pendingLbCount:pending.length,deadMatches,operations,stopMatches,waiting,fingerprint:sourceFingerprint(st),errors:[...new Set(errors)],completedMatchCount:matches.filter(m=>m&&m.completed===true).length,protected:{completedMatchesModified:0,scoresModified:0,winnerLoserModified:0}};
    return plan;
  }
  function applyPropagationOverride(st,m,newA,newB){
    if(!st||st.cloudCode!==ROOM_CODE||!m)return {ok:true,a:newA,b:newB};
    const rescue=st[RESCUE_FIELD];
    if(!rescue||rescue.roomCode!==ROOM_CODE||!Array.isArray(rescue.operations))return {ok:true,a:newA,b:newB};
    const entries=rescue.operations.filter(x=>x&&x.targetMatchId===m.id);
    if(!entries.length)return {ok:true,a:newA,b:newB};
    let a=newA,b=newB;
    for(const op of entries){
      const current=playerId(m[op.targetSlot]),sourceValue=op.targetSlot==="a"?a:b;
      if((current&&current!==op.playerId)||(sourceValue&&sourceValue!==op.playerId))return {ok:false,skip:true};
      if(op.targetSlot==="a")a=op.playerId;else if(op.targetSlot==="b")b=op.playerId;else return {ok:false,skip:true};
    }
    const curA=playerId(m.a),curB=playerId(m.b);
    if(hasDecisionData(m)&&(a!==curA||b!==curB))return {ok:false,skip:true};
    return {ok:true,a,b};
  }
  function escapeText(v){return String(v||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
  function displayPlan(plan){
      const lines=[`房間：BXH-C6BATA｜${plan.playerCount} 位選手｜只檢查敗部 source graph`, "", "永久空缺（兩側來源均不會再產生敗者）："];
    for(const d of plan.deadMatches)lines.push(`• 敗部第 ${d.round} 輪第 ${d.index} 場：空缺繼續傳遞，不判勝、不記比分`);
    lines.push("","準備旁路：");
    for(const o of plan.operations){
      const other=o.otherPlayerId?playerName(o.otherPlayerId):"待定";
      const arrived=o.targetSlot==="a"?`${playerName(o.playerId)} vs ${other}`:`${other} vs ${playerName(o.playerId)}`;
      lines.push(`• 第 ${o.sourceRound} 輪第 ${o.sourceIndex} 場 ${playerName(o.playerId)} → 第 ${o.targetRound} 輪第 ${o.targetIndex} 場（${arrived}）${o.stopForManualScore?"｜形成對戰後停止，由你輸入比分":""}`);
    }
    lines.push("","仍需等待（來源尚未完成）：");
    for(const w of plan.waiting)lines.push(`• 敗部第 ${w.round} 輪第 ${w.index} 場：上游未完成，不旁路`);
    lines.push("","安全檢查：0 已完成場次修改｜0 分數修改｜0 winnerId／loserId 修改。Dry Run 只讀資料。","確認後才會執行本房間專用交易。");
    return lines.join("\n");
  }
  async function commitPlan(plan){
    if(!isSuperAdmin()||!state||state.cloudCode!==ROOM_CODE){showToast("僅限本房最高管理員執行救援。",true);return;}
    if(!plan||!plan.ok||!plan.operations.length){showToast("救援 Dry Run 不可執行，資料未修改。",true);return;}
    const result=await window.cloudSync?.rescueC6bataTransaction?.(plan.fingerprint,currentAuthUid());
    if(!result||!result.ok){showToast("救援未寫入："+String(result&&result.reason||"專用交易尚未就緒"),true);return;}
    if(result.state)applyRemoteState(result.state,true);
    render();
    showToast("C6BATA 結構性空缺已旁路；所有真人對戰保留待你輸入比分。");
  }
  function showCommitConfirmation(plan){
    openModal({type:"generic",title:"確認 C6BATA 救援寫入",message:"將只傳遞 3 位選手至敗部下一場。3 場形成真人對戰後立即停止。\n不寫比分、不判勝、不修改已完成比賽。",confirmLabel:"執行房間專用交易",cancelLabel:"返回 Dry Run",onConfirm:()=>commitPlan(plan)});
  }
  function openDryRun(){
    if(!isSuperAdmin()||!state||state.cloudCode!==ROOM_CODE)return;
    const plan=computePlan(state);
    if(!plan.ok){showToast("Dry Run 停止："+plan.errors.join("、"),true);return;}
    openModal({type:"generic",title:"C6BATA 敗部救援 Dry Run",message:displayPlan(plan),confirmLabel:"查看寫入確認",cancelLabel:"取消",onConfirm:()=>showCommitConfirmation(plan)});
  }
  let suppressId="",suppressUntil=0;
  function bindLongPress(){
    if(typeof document==="undefined"||typeof MutationObserver==="undefined"||!document.body)return;
    const bind=()=>{
      if(!isSuperAdmin()||!state||state.cloudCode!==ROOM_CODE||state[RESCUE_FIELD])return;
      const plan=computePlan(state);if(!plan.ok)return;
      const candidates=new Set(plan.operations.map(x=>x.sourceMatchId));
      document.querySelectorAll('.match-box[data-action="open-match"][data-id]:not(.done)').forEach(box=>{
        const id=box.getAttribute("data-id")||"";if(!candidates.has(id)||box.dataset.c6bataRescueBound==="1")return;
        box.dataset.c6bataRescueBound="1";box.classList.add("long-press-correctable");
        let timer=null,startX=0,startY=0,pointerId=null,triggered=false;
        const clear=()=>{if(timer){clearTimeout(timer);timer=null;}box.classList.remove("long-press-armed");};
        box.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"&&e.button!==0)return;pointerId=e.pointerId;startX=e.clientX;startY=e.clientY;triggered=false;clear();box.classList.add("long-press-armed");timer=setTimeout(()=>{timer=null;triggered=true;box.classList.remove("long-press-armed");suppressId=id;suppressUntil=Date.now()+1200;try{navigator.vibrate?.(25);}catch(_){}openDryRun();},1500);});
        box.addEventListener("pointermove",e=>{if(pointerId===e.pointerId&&timer&&Math.hypot(e.clientX-startX,e.clientY-startY)>14)clear();});
        box.addEventListener("pointerup",e=>{if(pointerId===e.pointerId&&!triggered)clear();});
        box.addEventListener("pointercancel",clear);box.addEventListener("contextmenu",e=>e.preventDefault());
      });
    };
    if(!window.__bxhC6BataRescueClickGuard){window.__bxhC6BataRescueClickGuard=true;document.addEventListener("click",e=>{if(!suppressId||Date.now()>suppressUntil)return;const box=e.target&&e.target.closest&&e.target.closest('.match-box[data-id]');if(box&&box.getAttribute("data-id")===suppressId){e.preventDefault();e.stopImmediatePropagation();suppressId="";}},true);}
    bind();new MutationObserver(bind).observe(document.body,{childList:true,subtree:true});
  }
  window.BXHC6BataRescue=Object.assign(window.BXHC6BataRescue||{},{computePlan,sourceFingerprint,applyPropagationOverride,openDryRun,RESCUE_FIELD,ROOM_CODE});
  if(typeof module!=="undefined"&&module.exports)module.exports={computePlan,sourceFingerprint,applyPropagationOverride,RESCUE_FIELD,ROOM_CODE};
  bindLongPress();
})();

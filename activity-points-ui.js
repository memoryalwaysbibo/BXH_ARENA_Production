"use strict";
(function installActivityPointsUI(){
 if(window.__BXH_ACTIVITY_POINTS_UI_INSTALLED__)return;
 window.__BXH_ACTIVITY_POINTS_UI_INSTALLED__=true;
 const state={snapshot:null,rows:[],mode:"records",loading:false,error:"",open:false,nextSnapshotAt:0,snapshotFailures:0,visible:{records:10,daily:10,cumulative:10}};
 const headerRowState={row:null,moved:[]};
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const labels={daily_checkin:"每日簽到",cumulative_checkin:"累積簽到",match_completed:"完成真實對戰",tournament_completed:"完成賽事",host_completed:"我是房主",online_time:"在線時間",mood_message:"心情小棧留言",ladder_points:"天梯積分",ladder_migration:"既有天梯積分補發",inactivity_penalty:"未簽到扣分",redemption:"商品兌換"};
 function runtime(){try{return Function('return {profile:userProfile}')()}catch(e){return null}}
 let activityCallable=null;
 async function api(payload){
  if(!activityCallable){
   const [apps,functions]=await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js")
   ]);
   const app=apps.getApps()[0];
   if(!app)throw Object.assign(Error("firebase-app-not-ready"),{code:"app-not-ready"});
   activityCallable=functions.httpsCallable(functions.getFunctions(app,"asia-east1"),"activityPoints",{timeout:25000});
  }
  const response=await activityCallable(payload);
  return response?.data||{ok:false};
 }
 function playerId(){const p=runtime()?.profile||{};return p.playerId||p.gameId||"尚未設定玩家 ID"}
 function activityCacheKey(){const id=playerId();return id&&id!=="尚未設定玩家 ID"?"bxh:activity-points:balance:"+id:""}
 function readCachedBalance(){try{const k=activityCacheKey();if(!k)return null;const raw=localStorage.getItem(k);if(raw===null)return null;const n=Number(raw);return Number.isFinite(n)?n:null}catch(e){return null}}
 function writeCachedBalance(value){try{const k=activityCacheKey();const n=Number(value);if(k&&Number.isFinite(n))localStorage.setItem(k,String(n))}catch(e){}}
 function restoreHeaderBottomRow(){
  for(const item of headerRowState.moved.splice(0)){try{item.placeholder?.replaceWith(item.node)}catch(e){}}
  headerRowState.row?.remove();
  headerRowState.row=null;
 }
 function ensureHeaderBottomRow(controls){
  let row=headerRowState.row;
  if(!row||!row.isConnected){
   row=document.createElement("div");
   row.className="bxh-header-bottom-row";
   row.setAttribute("data-bxh-header-bottom-row","");
   controls.appendChild(row);
   headerRowState.row=row;
  }else if(row.parentElement!==controls){controls.appendChild(row)}
  const move=(node,key)=>{
   if(!node||node.parentElement===row)return;
   if(!headerRowState.moved.some(x=>x.node===node)){
    const placeholder=document.createComment("bxh-header-row-"+key);
    node.parentNode?.insertBefore(placeholder,node);
    headerRowState.moved.push({node,placeholder});
   }
   row.appendChild(node);
  };
  move(controls.querySelector(".mailbox-trigger"),"mailbox");
  move(controls.querySelector(".account-badge"),"account");
  return row;
 }
 function date(ms){try{return new Date(Number(ms)||Date.now()).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}catch(e){return "—"}}
 async function snapshot(){if(state.loading)return;state.loading=true;state.error="";paint();try{const r=await api({action:"snapshot"});if(!r?.ok)throw Error();state.snapshot=r;writeCachedBalance(r?.wallet?.balance);state.snapshotFailures=0;state.nextSnapshotAt=0;}catch(e){state.snapshotFailures=Math.min(state.snapshotFailures+1,5);state.nextSnapshotAt=Date.now()+Math.min(300000,15000*(2**(state.snapshotFailures-1)));const code=String(e?.code||e?.message||"unknown").replace(/^functions\//,"");state.error="活躍積分載入失敗（"+code+"）";console.error("[activityPoints snapshot]",e)}finally{state.loading=false;paint();summary()}}
 async function board(mode){if(state.loading)return;state.mode=mode;state.visible[mode]=10;state.loading=true;state.error="";paint();try{const r=await api({action:"leaderboard",mode});state.rows=r?.rows||[]}catch(e){const code=String(e?.code||e?.message||"unknown").replace(/^functions\//,"");state.error="活躍榜載入失敗（"+code+"）";console.error("[activityPoints leaderboard]",e)}finally{state.loading=false;paint()}}
 function task(name,key,max,note){const n=Math.max(0,Number(state.snapshot?.today?.bySource?.[key]||0)),limited=Number.isFinite(Number(max))&&Number(max)>0;return `<div class="ap-task"><div><b>${name}</b><small>${limited?`${n}／${Number(max)} 分`:`${n} 分`}</small></div>${limited?`<div class="ap-bar"><i style="width:${Math.min(100,n/Number(max)*100)}%"></i></div>`:""}<span>${note}</span></div>`}
 function paint(){
  let root=document.getElementById("activity-points-overlay");if(!state.open){root?.remove();return}if(!root){root=document.createElement("div");root.id="activity-points-overlay";document.body.appendChild(root)}
  const w=state.snapshot?.wallet||{},records=state.snapshot?.records||[];
  const limit=Math.max(10,Number(state.visible[state.mode]||10));
  const visibleRecords=records.slice(0,limit),visibleRows=state.rows.slice(0,limit);
  const history=visibleRecords.map(x=>`<tr><td>${date(x.occurredAt)}</td><td>${esc(x.label||labels[x.source]||x.source)}</td><td class="${Number(x.delta)>=0?'ap-plus':'ap-minus'}">${Number(x.delta)>0?'+':''}${Number(x.delta||0)}</td><td>${Number(x.balanceAfter||0)}</td></tr>`).join("");
  const ranking=visibleRows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.name||"玩家")}</b><small>${esc(r.playerId||"")}</small></td><td>${Number(r.points||0)}</td></tr>`).join("");
  const total=state.mode==="records"?records.length:state.rows.length,shown=Math.min(limit,total),remaining=Math.max(0,total-shown);
  const more=remaining>0?`<div class="ap-more"><button class="btn btn-ghost" data-activity="more">展開更多（${Math.min(20,remaining)} 筆）</button><span>已顯示 ${shown}／${total}</span></div>`:(total>10?`<div class="ap-more ap-more-done"><span>已顯示全部 ${total} 筆</span></div>`:"");
  const table=(state.mode==="records"?`<table class="ap-table"><thead><tr><th>日期</th><th>來源／原因</th><th>異動</th><th>餘額</th></tr></thead><tbody>${history||'<tr><td colspan="4">目前沒有積分紀錄</td></tr>'}</tbody></table>`:`<table class="ap-table"><thead><tr><th>名次</th><th>玩家</th><th>積分</th></tr></thead><tbody>${ranking||'<tr><td colspan="3">目前沒有排行資料</td></tr>'}</tbody></table>`)+more;
  root.innerHTML=`<section class="ap-shell"><div class="ap-head"><div><div class="hint">玩家 ID｜${esc(playerId())}</div><h2>我的活躍積分</h2></div><button class="btn btn-ghost" data-activity="close">關閉</button></div><div class="ap-balance">${Number(w.balance||0)} <small>分</small></div><p class="hint">累積獲得 ${Number(w.lifetimeEarned||0)}｜累積扣除 ${Number(w.lifetimeDeducted||0)}</p>${w.testAccount?'<p class="hint">封測帳號可完整體驗活躍積分；移轉正式環境時將清除封測積分資料，只保留「開拓者」稱號。</p>':""}${state.error?`<p class="auth-error">${esc(state.error)}</p>`:""}<h3>我的任務</h3>${task("每日簽到","daily_checkin",15,"每日一次 +15")}${task("完成賽事","tournament_completed",null,"每場完賽 +10")}${task("我是房主","host_completed",null,"每場完賽 +10")}${task("在線時間","online_time",30,"每 30 分鐘 +5｜每日上限 +30")}${task("累積簽到","cumulative_checkin",5,"每日簽到後 +5")}${task("心情小棧留言","mood_message",15,"每則 +5｜每日上限 +15")}<div class="ap-tabs"><button class="btn ${state.mode==='records'?'btn-primary':'btn-ghost'}" data-activity="records">我的積分紀錄</button><button class="btn ${state.mode==='daily'?'btn-primary':'btn-ghost'}" data-activity="daily">每日活躍榜</button><button class="btn ${state.mode==='cumulative'?'btn-primary':'btn-ghost'}" data-activity="cumulative">累積活躍榜</button><button class="btn btn-ghost" data-activity="refresh">重新整理</button></div>${state.loading?'<p>讀取中…</p>':table}</section>`;
 }
 function signedIn(){try{return !!Function('return firebaseUser&&firebaseUser.uid&&userProfile&&appPhase==="player-center"')()}catch(e){return false}}
 function summary(){
  if(!signedIn())return;
  const controls=document.querySelector(".player-shell header.topbar");if(!controls)return;
  const directive=document.documentElement?.dataset?.bxhTheme==="directive";
  const brand=controls.querySelector(".brandtext");
  const accountControls=controls.querySelector(".header-account-controls");
  const compactMobile=!!accountControls&&window.matchMedia("(max-width:899px)").matches;
  const mount=compactMobile?accountControls:((directive&&brand)?brand:controls);
  let box=document.getElementById("activity-points-summary");
  if(!box){
   box=document.createElement("button");
   box.type="button";
   box.id="activity-points-summary";
   box.dataset.activity="open";
   box.setAttribute("aria-label","查看我的活躍積分");
  }
  if(box.parentElement!==mount){
   if(compactMobile)mount.insertBefore(box,mount.firstChild);
   else mount.appendChild(box);
  }else if(compactMobile&&mount.firstElementChild!==box){
   mount.insertBefore(box,mount.firstChild);
  }
  box.classList.toggle("activity-points-directive",directive);
  box.classList.toggle("activity-points-account-row",compactMobile);
  const cached=readCachedBalance();
  const displayBalance=state.snapshot?Number(state.snapshot.wallet?.balance||0):(cached!==null?cached:"…");
  const key=playerId()+"|"+displayBalance+"|"+(directive?"directive":"default")+"|"+(compactMobile?"account-row":"stack");
  if(box.dataset.renderKey===key)return;
  box.dataset.renderKey=key;
  box.innerHTML=`<span>活躍積分</span><strong>${displayBalance} 分</strong>`;
 }
 document.addEventListener("click",e=>{const t=e.target.closest?.("[data-activity]");if(!t)return;const a=t.dataset.activity;if(a==="open"){state.open=true;state.mode="records";state.rows=[];state.visible={records:10,daily:10,cumulative:10};state.nextSnapshotAt=0;paint();snapshot()}else if(a==="close"){state.open=false;paint()}else if(a==="refresh"){state.visible[state.mode]=10;state.nextSnapshotAt=0;if(state.mode==="records"){state.rows=[];snapshot()}else board(state.mode)}else if(a==="records"){state.mode="records";state.rows=[];state.visible.records=10;paint()}else if(a==="daily"||a==="cumulative")board(a);else if(a==="more"){state.visible[state.mode]=Math.max(10,Number(state.visible[state.mode]||10))+20;paint()}});
 const style=document.createElement("style");style.textContent=`.player-shell header.topbar{position:relative}.player-shell header.topbar #activity-points-summary{position:absolute;z-index:5;right:14px;top:14px;width:164px;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;padding:7px 13px;border:1px solid #879500;border-radius:999px;background:#171a12;color:#d7d9d0;font:inherit;cursor:pointer;box-sizing:border-box}.player-shell header.topbar #activity-points-summary span{font-size:12px;white-space:nowrap}.player-shell header.topbar #activity-points-summary strong,.ap-balance{color:#eaff16;font-weight:900}.player-shell header.topbar #activity-points-summary strong{font-size:18px;white-space:nowrap}:root[data-bxh-theme="directive"] .player-shell header.topbar .brandtext #activity-points-summary{position:relative!important;inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;display:flex!important;flex:0 0 auto!important;align-self:flex-start!important;width:142px!important;min-width:142px!important;max-width:142px!important;height:32px!important;min-height:32px!important;max-height:32px!important;margin:8px 0 0 0!important;padding:4px 9px!important;gap:6px!important;overflow:hidden!important;white-space:nowrap!important;border:1px solid rgba(var(--accent-rgb),.34)!important;border-radius:8px!important;background:rgba(15,17,23,.40)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.045)!important;backdrop-filter:blur(12px) saturate(1.08)!important;-webkit-backdrop-filter:blur(12px) saturate(1.08)!important;transform:none!important;z-index:4!important}:root[data-bxh-theme="directive"] .player-shell header.topbar .brandtext #activity-points-summary span{font-size:9.5px!important;line-height:1!important;white-space:nowrap!important}:root[data-bxh-theme="directive"] .player-shell header.topbar .brandtext #activity-points-summary strong{font-size:14px!important;line-height:1!important;white-space:nowrap!important}@media(max-width:380px){:root[data-bxh-theme="directive"] .player-shell header.topbar .brandtext #activity-points-summary{width:132px!important;min-width:132px!important;max-width:132px!important;height:31px!important;min-height:31px!important;max-height:31px!important;padding:4px 8px!important}:root[data-bxh-theme="directive"] .player-shell header.topbar .brandtext #activity-points-summary span{font-size:9px!important}:root[data-bxh-theme="directive"] .player-shell header.topbar .brandtext #activity-points-summary strong{font-size:13.5px!important}}@media(max-width:899px){.player-shell header.topbar .header-account-controls{display:flex!important;align-items:center!important;justify-content:flex-end!important;flex-wrap:nowrap!important;width:100%!important;min-width:0!important;gap:5px!important}.player-shell header.topbar .header-account-controls #activity-points-summary.activity-points-account-row{position:relative!important;inset:auto!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;display:flex!important;align-items:center!important;justify-content:space-between!important;order:-1!important;flex:0 0 142px!important;width:142px!important;min-width:142px!important;max-width:142px!important;height:38px!important;min-height:38px!important;max-height:38px!important;margin:0 auto 0 0!important;padding:5px 9px!important;gap:6px!important;overflow:hidden!important;white-space:nowrap!important;box-sizing:border-box!important;border:1px solid rgba(196,214,43,.58)!important;border-radius:999px!important;background:rgba(16,19,13,.90)!important;box-shadow:0 0 10px rgba(190,214,34,.08),inset 0 1px 0 rgba(255,255,255,.025)!important;transform:none!important;z-index:5!important}.player-shell header.topbar .header-account-controls #activity-points-summary.activity-points-account-row span{font-size:9.5px!important;line-height:1!important;white-space:nowrap!important}.player-shell header.topbar .header-account-controls #activity-points-summary.activity-points-account-row strong{font-size:14px!important;line-height:1!important;white-space:nowrap!important}.player-shell header.topbar .header-account-controls #activity-points-summary.activity-points-account-row:hover,.player-shell header.topbar .header-account-controls #activity-points-summary.activity-points-account-row:focus-visible{outline:none!important;border-color:var(--accent-color)!important;background:rgba(var(--accent-rgb),.055)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 16px var(--accent-glow)!important}.player-shell header.topbar .header-account-controls .mailbox-trigger{flex:0 0 auto!important;margin:0!important}.player-shell header.topbar .header-account-controls .account-menu-wrap{flex:0 1 auto!important;min-width:0!important;max-width:calc(100% - 187px)!important}.player-shell header.topbar .header-account-controls .account-badge{max-width:100%!important;overflow:hidden!important}}@media(max-width:360px){.player-shell header.topbar #activity-points-summary{width:142px;right:10px}.player-shell header.topbar #activity-points-summary span{font-size:11px}.player-shell header.topbar #activity-points-summary strong{font-size:17px}}#activity-points-overlay{position:fixed;inset:0;z-index:2600;background:#000d;padding:14px;overflow:auto;color:#f4f4f4}#activity-points-overlay .ap-shell{max-width:760px;margin:auto;background:#15171a;border:1px solid #5c6678;border-radius:20px;padding:18px}.ap-head,.ap-task>div:first-child{display:flex;justify-content:space-between;gap:12px;align-items:center}.ap-balance{font-size:42px}.ap-task{background:#202329;border-radius:14px;padding:12px;margin:10px 0}.ap-task small,.ap-task span{color:#9ca3af}.ap-bar{height:8px;background:#343942;border-radius:9px;margin:8px 0}.ap-bar i{display:block;height:100%;background:#eaff16;border-radius:9px}.ap-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.ap-table{width:100%;border-collapse:collapse}.ap-table th,.ap-table td{padding:10px 6px;border-bottom:1px solid #30343b;text-align:left}.ap-table td small{display:block;color:#999}.ap-more{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:14px 0 2px}.ap-more span{color:#9ca3af;font-size:12px}.ap-more-done{justify-content:flex-end;padding-top:10px}.ap-plus{color:#78df9b}.ap-minus{color:#ff7474}`;document.head.appendChild(style);
 // Do not observe the whole application DOM: that can compete with the login renderer.
 // A low-frequency, post-authentication check is sufficient because the player shell is persistent.
 function activityTick(){
  if(document.hidden||!signedIn())return;
  if(!document.querySelector(".player-main"))return;
  summary();
  if(!state.snapshot&&!state.loading&&Date.now()>=state.nextSnapshotAt)snapshot();
 }
 setInterval(activityTick,5000);
 // Fast bootstrap: render the control as soon as the player shell exists instead of waiting for the 5s maintenance tick.
 let bootstrapTries=0;
 const bootstrapTimer=setInterval(()=>{
  activityTick();
  bootstrapTries++;
  if((signedIn()&&document.querySelector(".player-main"))||bootstrapTries>=40)clearInterval(bootstrapTimer);
 },250);
 setTimeout(activityTick,0);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)activityTick();});
 window.addEventListener("resize",()=>{if(signedIn())summary();},{passive:true});
})();


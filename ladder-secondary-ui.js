"use strict";
(function installLadderSecondaryUI(){
  if(window.__BXH_LADDER_SECONDARY_UI__) return;
  window.__BXH_LADDER_SECONDARY_UI__=true;
  if(typeof renderLadderLeaderboardPage!=="function") return;

  var originalRenderLadderLeaderboardPage=renderLadderLeaderboardPage;
  var originalLoadLadderAdminLogs=typeof loadLadderAdminLogs==="function"?loadLadderAdminLogs:null;
  var ladderSecondaryView="ranking";
  var ladderHistorySort="date-desc";
  var ladderHistoryLoading=false;
  var ladderHistoryError="";

  var strokeCollator=(function(){
    try{return new Intl.Collator("zh-Hant-u-co-stroke",{sensitivity:"base",numeric:true});}
    catch(e){return new Intl.Collator("zh-TW",{sensitivity:"base",numeric:true});}
  })();

  function rerender(){
    try{
      if(typeof renderPreservingScroll==="function") renderPreservingScroll();
      else if(typeof render==="function") render();
    }catch(e){ console.warn("[ladder-secondary] render failed",e); }
  }

  function escLocal(value){
    if(typeof esc==="function") return esc(value);
    return String(value==null?"":value).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function deltaOf(row){
    if(row&&row.delta!=null) return Number(row.delta)||0;
    return Number(row&&row.pointsEarned||0)||0;
  }

  function sortedLogs(logs){
    var rows=Array.isArray(logs)?logs.slice():[];
    rows.sort(function(a,b){
      if(ladderHistorySort==="points-asc") return deltaOf(a)-deltaOf(b);
      if(ladderHistorySort==="points-desc") return deltaOf(b)-deltaOf(a);
      if(ladderHistorySort==="name-asc") return strokeCollator.compare(String(a&&a.playerName||""),String(b&&b.playerName||""));
      if(ladderHistorySort==="name-desc") return strokeCollator.compare(String(b&&b.playerName||""),String(a&&a.playerName||""));
      if(ladderHistorySort==="date-asc") return Number(a&&a.createdAtMs||0)-Number(b&&b.createdAtMs||0);
      return Number(b&&b.createdAtMs||0)-Number(a&&a.createdAtMs||0);
    });
    return rows;
  }

  function ensureHistory(force){
    if(ladderHistoryLoading) return;
    if(typeof ladderAdminLogsLoaded!=="undefined"&&ladderAdminLogsLoaded&&!force) return;
    if(!window.cloudSync||typeof window.cloudSync.getLadderTransactions!=="function"){
      ladderHistoryError="近期積分紀錄服務尚未就緒。";
      rerender();
      return;
    }
    ladderHistoryLoading=true;
    ladderHistoryError="";
    Promise.resolve(window.cloudSync.getLadderTransactions()).then(function(rows){
      if(typeof ladderAdminLogs!=="undefined") ladderAdminLogs=Array.isArray(rows)?rows:[];
      if(typeof ladderAdminLogsLoaded!=="undefined") ladderAdminLogsLoaded=true;
    }).catch(function(error){
      console.warn("[ladder-secondary] history load failed",error);
      ladderHistoryError="近期積分紀錄讀取失敗，請稍後再試。";
      if(typeof ladderAdminLogsLoaded!=="undefined") ladderAdminLogsLoaded=false;
    }).finally(function(){
      ladderHistoryLoading=false;
      rerender();
    });
  }

  if(originalLoadLadderAdminLogs){
    loadLadderAdminLogs=function(force){
      ensureHistory(!!force);
    };
  }

  function subnavHtml(){
    return '<nav class="ladder-secondary-nav" aria-label="天梯二階選單">'+
      '<button type="button" class="'+(ladderSecondaryView==="ranking"?"active":"")+'" data-ladder-subview="ranking" aria-pressed="'+(ladderSecondaryView==="ranking"?"true":"false")+'"><span class="ladder-secondary-icon">🏆</span><span><strong>天梯積分排行</strong><small>排名・地區・牌位</small></span></button>'+
      '<button type="button" class="'+(ladderSecondaryView==="history"?"active":"")+'" data-ladder-subview="history" aria-pressed="'+(ladderSecondaryView==="history"?"true":"false")+'"><span class="ladder-secondary-icon">◷</span><span><strong>近期積分紀錄</strong><small>異動・玩家・日期</small></span></button>'+
    '</nav>';
  }

  function option(value,label){
    return '<option value="'+value+'" '+(ladderHistorySort===value?"selected":"")+'>'+label+'</option>';
  }

  function historyTableHtml(adminMode){
    var logs=typeof ladderAdminLogs!=="undefined"&&Array.isArray(ladderAdminLogs)?ladderAdminLogs:[];
    var rows=sortedLogs(logs).slice(0,100);
    var actorHead=adminMode?"<th>操作人</th>":"";
    var actorCell=function(row){return adminMode?"<td>"+escLocal(row.actorName||row.actorUid||"—")+"</td>":"";};
    var body=rows.map(function(row){
      var delta=deltaOf(row);
      var type=row.type==="event"?"賽事積分":row.type==="adjustment"?"手動更正":String(row.type||"—");
      var reason=escLocal(row.reason||row.eventName||"—");
      if(row.scoring){
        reason+='<br><small>V1｜'+(Number(row.scoring.effectiveCount)||0)+' 人 ×'+(Number(row.scoring.multiplier)||0).toFixed(3)+'｜'+(Number(row.scoring.basePoints)||0)+'＋'+(Number(row.scoring.weightedBonus)||0)+' 分</small>';
      }
      return "<tr>"+
        "<td>"+(row.createdAtMs?new Date(row.createdAtMs).toLocaleString("zh-TW"):"—")+"</td>"+
        "<td>"+escLocal(row.playerName||"—")+"</td>"+
        "<td>"+escLocal(type)+"</td>"+
        '<td class="'+(delta>=0?"ladder-history-plus":"ladder-history-minus")+'">'+(delta>0?"+":"")+delta+"</td>"+
        "<td>"+escLocal(row.seasonId||"—")+"</td>"+
        "<td>"+reason+"</td>"+
        actorCell(row)+
      "</tr>";
    }).join("");

    if(ladderHistoryLoading&&!rows.length) body='<tr><td colspan="'+(adminMode?7:6)+'">正在讀取近期積分紀錄…</td></tr>';
    else if(!rows.length) body='<tr><td colspan="'+(adminMode?7:6)+'">目前沒有積分紀錄</td></tr>';

    return '<section class="panel ladder-history-panel">'+
      '<div class="panel-title"><span>近期積分紀錄</span><button type="button" class="btn btn-ghost btn-sm" data-ladder-history-refresh '+(ladderHistoryLoading?"disabled":"")+'>'+(ladderHistoryLoading?"讀取中…":"重新整理")+'</button></div>'+
      '<div class="ladder-history-toolbar"><label><span>排序方式</span><select data-ladder-history-sort aria-label="近期積分紀錄排序">'+
        option("date-desc","日期｜晚 → 早")+
        option("date-asc","日期｜早 → 晚")+
        option("points-desc","積分｜大 → 小")+
        option("points-asc","積分｜小 → 大")+
        option("name-desc","姓名筆畫｜多 → 少")+
        option("name-asc","姓名筆畫｜少 → 多")+
      '</select></label></div>'+
      (ladderHistoryError?'<div class="auth-error">'+escLocal(ladderHistoryError)+'</div>':"")+
      '<div class="rank-scroll"><table class="rank-table ladder-history-table"><thead><tr><th>時間</th><th>玩家</th><th>類型</th><th>異動</th><th>賽季</th><th>原因／賽事</th>'+actorHead+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
      '<div class="hint ladder-history-note">最多顯示最近 100 筆；切換排序不會修改任何積分資料。</div>'+
    '</section>';
  }

  renderLadderLeaderboardPage=function(adminMode){
    if(ladderSecondaryView==="history") ensureHistory(false);
    var html=originalRenderLadderLeaderboardPage(!!adminMode);
    var template=document.createElement("template");
    template.innerHTML=html;

    Array.prototype.slice.call(template.content.querySelectorAll(".panel-title")).forEach(function(title){
      if((title.textContent||"").trim()==="最近積分紀錄"){
        var panel=title.closest(".panel");
        if(panel) panel.remove();
      }
    });

    var hero=template.content.querySelector(".ladder-hero");
    if(ladderSecondaryView==="ranking"){
      if(hero) hero.insertAdjacentHTML("afterend",subnavHtml());
      return template.innerHTML;
    }

    var output=document.createElement("div");
    var testPanel=template.content.querySelector(".test-ladder-panel");
    if(testPanel) output.appendChild(testPanel.cloneNode(true));
    if(hero) output.appendChild(hero.cloneNode(true));
    var navTemplate=document.createElement("template");
    navTemplate.innerHTML=subnavHtml()+historyTableHtml(!!adminMode);
    output.appendChild(navTemplate.content.cloneNode(true));
    return output.innerHTML;
  };

  document.addEventListener("click",function(event){
    var tab=event.target&&event.target.closest?event.target.closest("[data-ladder-subview]"):null;
    if(tab){
      event.preventDefault();
      event.stopPropagation();
      var next=tab.getAttribute("data-ladder-subview");
      if(next!=="ranking"&&next!=="history") return;
      ladderSecondaryView=next;
      if(next==="history") ensureHistory(false);
      rerender();
      return;
    }
    var refresh=event.target&&event.target.closest?event.target.closest("[data-ladder-history-refresh]"):null;
    if(refresh){
      event.preventDefault();
      event.stopPropagation();
      if(typeof ladderAdminLogsLoaded!=="undefined") ladderAdminLogsLoaded=false;
      ensureHistory(true);
    }
  },true);

  document.addEventListener("change",function(event){
    var select=event.target&&event.target.matches&&event.target.matches("[data-ladder-history-sort]")?event.target:null;
    if(!select) return;
    ladderHistorySort=select.value||"date-desc";
    rerender();
  },true);

  var style=document.createElement("style");
  style.textContent=
    ".ladder-secondary-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0;}"+
    ".ladder-secondary-nav button{min-width:0;min-height:64px;padding:10px 12px;border:1px solid rgba(217,185,92,.2);border-radius:11px;background:rgba(18,19,21,.88);color:var(--metal);display:flex;align-items:center;justify-content:center;gap:9px;text-align:left;font:inherit;}"+
    ".ladder-secondary-nav button.active{border-color:var(--gold);background:linear-gradient(145deg,rgba(217,185,92,.16),rgba(217,185,92,.05));color:var(--ivory);box-shadow:0 0 0 1px rgba(217,185,92,.08) inset;}"+
    ".ladder-secondary-nav strong{display:block;color:inherit;font-size:14px;line-height:1.25;}"+
    ".ladder-secondary-nav small{display:block;margin-top:3px;color:var(--metal);font-size:10px;white-space:nowrap;}"+
    ".ladder-secondary-icon{font-size:19px;color:var(--gold);flex:0 0 auto;}"+
    ".ladder-history-toolbar{display:flex;justify-content:flex-end;margin:2px 0 12px;}"+
    ".ladder-history-toolbar label{display:flex;align-items:center;gap:8px;color:var(--metal);font-size:12px;font-weight:700;}"+
    ".ladder-history-toolbar select{min-width:210px;min-height:40px;padding:7px 34px 7px 11px;border:1px solid rgba(217,185,92,.32);border-radius:9px;background:#17181b;color:var(--ivory);font:inherit;}"+
    ".ladder-history-plus{color:#d9b95c;font-weight:800}.ladder-history-minus{color:#ff7474;font-weight:800}.ladder-history-note{margin-top:10px;}"+
    "@media(max-width:520px){.ladder-secondary-nav{gap:7px}.ladder-secondary-nav button{min-height:58px;padding:9px 8px;gap:7px}.ladder-secondary-nav strong{font-size:13px}.ladder-secondary-nav small{font-size:9px}.ladder-secondary-icon{font-size:17px}.ladder-history-toolbar{justify-content:stretch}.ladder-history-toolbar label{width:100%;justify-content:space-between}.ladder-history-toolbar select{flex:1;min-width:0;max-width:72%;}}";
  document.head.appendChild(style);
})();
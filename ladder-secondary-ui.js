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
  var ladderScoreMode="season";

  function ladderScoreLabel(){
    return ladderScoreMode==="career"?"生涯":"季賽";
  }

  function ladderCareerTieKey(p){
    return [
      Number(p&&p.careerPoints||0),
      Number(p&&p.championCount||0),
      Number(p&&p.runnerUpCount||0),
      Number(p&&p.thirdPlaceCount||0),
      Number(p&&p.fourthPlaceCount||0),
      Number(p&&p.seasonPoints||0)
    ].join("|");
  }

  function rankCareerRows(players){
    var rows=(Array.isArray(players)?players:[]).map(function(p){return Object.assign({},p);});
    rows.sort(function(a,b){
      return (Number(b&&b.careerPoints||0)-Number(a&&a.careerPoints||0))
        || (Number(b&&b.championCount||0)-Number(a&&a.championCount||0))
        || (Number(b&&b.runnerUpCount||0)-Number(a&&a.runnerUpCount||0))
        || (Number(b&&b.thirdPlaceCount||0)-Number(a&&a.thirdPlaceCount||0))
        || (Number(b&&b.fourthPlaceCount||0)-Number(a&&a.fourthPlaceCount||0))
        || (Number(b&&b.seasonPoints||0)-Number(a&&a.seasonPoints||0));
    });
    var lastKey=null,lastRank=0;
    rows.forEach(function(p,i){
      var key=ladderCareerTieKey(p);
      if(i===0||key!==lastKey) lastRank=i+1;
      p.__rank=lastRank;
      lastKey=key;
    });
    return rows;
  }

  function ladderActiveRankingRows(){
    var source=(typeof ladderPublicData!=="undefined"&&ladderPublicData&&Array.isArray(ladderPublicData.players))
      ?ladderPublicData.players:[];
    var eligible=source.filter(function(p){
      return ladderScoreMode==="career"
        ?Number(p&&p.careerPoints||0)>0
        :Number(p&&p.seasonPoints||0)>0;
    });
    var local=typeof ladderLocationRows==="function"?ladderLocationRows(eligible):eligible;
    return ladderScoreMode==="career"
      ?rankCareerRows(local)
      :(typeof rankLadderRows==="function"?rankLadderRows(local):local);
  }

  function ladderTierVisual(p){
    var points=Number(p&&p.seasonPoints||0);
    var base=typeof ladderTierFromPoints==="function"?ladderTierFromPoints(points):String(p&&p.rankTier||"未定級");
    var display=typeof ladderDisplayTier==="function"?ladderDisplayTier(p):base;
    var idx=(typeof LADDER_TIER_INDEX!=="undefined"&&LADDER_TIER_INDEX[base]!=null)?Number(LADDER_TIER_INDEX[base]):0;
    var legend=display==="BXH 傳說";
    var glyphs=["—","銅","銀","金","鉑","鑽","師","宗"];
    return {base:base,display:display,index:idx,legend:legend,glyph:legend?"★":(glyphs[idx]||"—")};
  }

  function ladderTierEmblemHtml(p){
    var tier=ladderTierVisual(p);
    return '<div class="ladder-tier-display" title="'+escLocal(tier.display)+'">'+
      '<span class="ladder-tier-emblem ladder-tier-emblem-'+tier.index+(tier.legend?' is-legend':'')+'" aria-hidden="true"><span>'+escLocal(tier.glyph)+'</span></span>'+
      '<span class="ladder-tier-name">'+escLocal(tier.display)+'</span>'+
    '</div>';
  }

  function ladderScoreSwitchHtml(){
    return '<div class="ladder-score-switch" role="tablist" aria-label="天梯積分類型">'+
      '<button type="button" role="tab" data-ladder-score-mode="season" class="'+(ladderScoreMode==="season"?"active":"")+'" aria-selected="'+(ladderScoreMode==="season"?"true":"false")+'">季賽</button>'+
      '<button type="button" role="tab" data-ladder-score-mode="career" class="'+(ladderScoreMode==="career"?"active":"")+'" aria-selected="'+(ladderScoreMode==="career"?"true":"false")+'">生涯</button>'+
    '</div>';
  }

  function ladderRankingTableHtml(adminMode){
    var rows=ladderActiveRankingRows();
    if(!rows.length){
      return '<div class="empty-state"><strong>排行尚未產生</strong><br>'+(ladderScoreMode==="career"?'目前尚無玩家取得生涯積分。':'目前尚無玩家取得賽季積分。完成第一場積分賽後，排名將自動顯示。')+'</div>';
    }
    var scoreKey=ladderScoreMode==="career"?"careerPoints":"seasonPoints";
    var body=rows.map(function(p){
      var rank=Number(p.__rank||0);
      var topClass=rank>=1&&rank<=3?" ladder-rank-top-"+rank:"";
      var title=p&&p.equippedBadge
        ?'<span class="title-chip rarity-'+escLocal(p.equippedBadge.rarity||"common")+'" title="'+escLocal(p.equippedBadge.name||"")+'">'+escLocal(p.equippedBadge.name||"")+'</span>'
        :"";
      var adminActions=adminMode
        ?'<div class="ladder-rank-admin-actions">'+
          '<button class="btn btn-ghost btn-sm" data-action="ladder-player-history" data-uid="'+escLocal(p.uid||"")+'">賽季歷史</button>'+
          ((typeof isAdminTierOrAbove==="function"&&isAdminTierOrAbove())?'<button class="btn btn-ghost btn-sm" data-action="ladder-adjust-select" data-uid="'+escLocal(p.uid||"")+'">更正積分</button>':"")+
        '</div>'
        :"";
      return '<article class="ladder-rank-grid ladder-rank-row-v2'+topClass+'">'+
        '<div class="ladder-rank-position">NO.'+rank+'</div>'+
        '<div class="ladder-player-block">'+
          '<button class="ladder-player-link" data-action="card-open" data-uid="'+escLocal(p.uid||"")+'" title="'+escLocal(p.playerName||p.publicName||"—")+'">'+escLocal(p.playerName||p.publicName||"—")+'</button>'+
          title+
        '</div>'+
        '<div class="ladder-tier-cell">'+ladderTierEmblemHtml(p)+'</div>'+
        '<div class="ladder-points-cell"><strong>'+Number(p&&p[scoreKey]||0)+'</strong><span>PT</span></div>'+
        adminActions+
      '</article>';
    }).join("");
    return '<div class="rank-scroll ladder-rank-scroll-v2"><div class="ladder-rank-board-v2">'+
      '<div class="ladder-rank-grid ladder-rank-head-v2"><div>排名</div><div>玩家</div><div>位階</div><div title="'+(ladderScoreMode==="career"?"生涯積分":"季賽積分")+'">積分</div></div>'+
      body+
    '</div></div>';
  }

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

  var originalLadderLeaderboardTable=typeof ladderLeaderboardTable==="function"?ladderLeaderboardTable:null;
  if(originalLadderLeaderboardTable){
    ladderLeaderboardTable=function(_rows,adminMode){
      return ladderRankingTableHtml(!!adminMode);
    };
  }

  function decorateRankingTemplate(template){
    var filter=template.content.querySelector(".ladder-location-filter");
    if(filter&&!template.content.querySelector(".ladder-score-switch")){
      filter.insertAdjacentHTML("afterend",ladderScoreSwitchHtml());
    }
    var board=template.content.querySelector(".ladder-rank-board-v2");
    if(board){
      var panel=board.closest(".panel");
      var title=panel&&panel.querySelector(".panel-title");
      if(title){
        var location=typeof ladderLocationLabel==="function"?ladderLocationLabel():"全區總榜";
        var season=(typeof ladderPublicData!=="undefined"&&ladderPublicData&&ladderPublicData.control&&ladderPublicData.control.currentSeason)||"S1";
        title.textContent=(ladderScoreMode==="career"?"生涯":season+" 季賽")+"｜"+location;
      }
    }
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
      decorateRankingTemplate(template);
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
    var scoreTab=event.target&&event.target.closest?event.target.closest("[data-ladder-score-mode]"):null;
    if(scoreTab){
      event.preventDefault();
      event.stopPropagation();
      var scoreMode=scoreTab.getAttribute("data-ladder-score-mode");
      if(scoreMode!=="season"&&scoreMode!=="career") return;
      if(ladderScoreMode!==scoreMode){
        ladderScoreMode=scoreMode;
        rerender();
      }
      return;
    }
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

  var rankingStyle=document.createElement("style");
  rankingStyle.textContent=
    ".ladder-score-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin:10px 0 14px;padding:4px;border:1px solid rgba(217,185,92,.2);border-radius:10px;background:rgba(10,11,13,.72);}"+
    ".ladder-score-switch button{min-height:40px;border:0;border-radius:7px;background:transparent;color:var(--metal);font:700 13px/1 var(--font-d);letter-spacing:.5px;}"+
    ".ladder-score-switch button.active{background:linear-gradient(145deg,rgba(217,185,92,.2),rgba(217,185,92,.07));color:var(--gold);box-shadow:inset 0 0 0 1px rgba(217,185,92,.28);}"+
    ".ladder-rank-scroll-v2{overflow:visible;}"+
    ".ladder-rank-board-v2{width:100%;min-width:0;}"+
    ".ladder-rank-grid{display:grid;grid-template-columns:52px minmax(0,1fr) 96px 78px;gap:8px;align-items:center;min-width:0;}"+
    ".ladder-rank-head-v2{padding:0 8px 9px;color:var(--metal);font-size:11px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);text-align:center;}"+
    ".ladder-rank-head-v2>div:nth-child(2){text-align:left;}"+
    ".ladder-rank-row-v2{position:relative;padding:11px 8px;border-bottom:1px solid rgba(255,255,255,.065);min-height:58px;}"+
    ".ladder-rank-row-v2:last-child{border-bottom:0;}"+
    ".ladder-rank-position{font-family:var(--font-d);font-size:12px;font-weight:900;color:var(--gold);text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums;}"+
    ".ladder-rank-top-1 .ladder-rank-position{color:#f4cf67;text-shadow:0 0 10px rgba(244,207,103,.18);}"+
    ".ladder-rank-top-2 .ladder-rank-position{color:#d8dde5;}"+
    ".ladder-rank-top-3 .ladder-rank-position{color:#d9a574;}"+
    ".ladder-player-block{min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;}"+
    ".ladder-player-link{display:block;max-width:100%;padding:0;border:0;background:transparent;color:var(--ivory);font:800 13px/1.25 var(--font-d);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;}"+
    ".ladder-player-link:focus-visible{outline:1px solid var(--gold);outline-offset:3px;border-radius:3px;}"+
    ".ladder-player-block .title-chip{display:block;max-width:100%;margin:0;padding:2px 7px;font-size:9px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"+
    ".ladder-tier-cell{min-width:0;display:flex;justify-content:center;}"+
    ".ladder-tier-display{min-width:0;display:flex;align-items:center;justify-content:center;gap:6px;}"+
    ".ladder-tier-emblem{--tier-color:#a9adb5;--tier-edge:#545861;position:relative;display:grid;place-items:center;width:32px;height:36px;flex:0 0 32px;clip-path:polygon(50% 0,92% 15%,86% 72%,50% 100%,14% 72%,8% 15%);background:linear-gradient(155deg,var(--tier-color),#111 72%);filter:drop-shadow(0 3px 5px rgba(0,0,0,.34));}"+
    ".ladder-tier-emblem:before{content:'';position:absolute;inset:2px;clip-path:inherit;background:linear-gradient(155deg,rgba(255,255,255,.18),rgba(0,0,0,.58));border:1px solid var(--tier-edge);}"+
    ".ladder-tier-emblem span{position:relative;z-index:1;color:var(--tier-color);font:900 11px/1 var(--font-d);text-shadow:0 1px 3px #000;}"+
    ".ladder-tier-emblem-0{--tier-color:#a9adb5;--tier-edge:#545861}.ladder-tier-emblem-1{--tier-color:#d9a574;--tier-edge:#96653c}.ladder-tier-emblem-2{--tier-color:#d8dde5;--tier-edge:#9ca3ad}.ladder-tier-emblem-3{--tier-color:#ffd85b;--tier-edge:#a98a1e}.ladder-tier-emblem-4{--tier-color:#7de5d8;--tier-edge:#3e9188}.ladder-tier-emblem-5{--tier-color:#75d7ff;--tier-edge:#3588aa}.ladder-tier-emblem-6{--tier-color:#d69cff;--tier-edge:#8254a3}.ladder-tier-emblem-7{--tier-color:#ff6d77;--tier-edge:#ad3038}.ladder-tier-emblem.is-legend{--tier-color:#f4cf67;--tier-edge:#d9b95c;filter:drop-shadow(0 0 7px rgba(217,185,92,.28));}"+
    ".ladder-tier-name{min-width:0;color:var(--ivory);font-size:11px;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}"+
    ".ladder-points-cell{display:flex;align-items:baseline;justify-content:center;gap:3px;white-space:nowrap;font-variant-numeric:tabular-nums;}"+
    ".ladder-points-cell strong{font-family:var(--font-d);font-size:13px;color:var(--gold);}"+
    ".ladder-points-cell span{font-size:9px;color:var(--metal);}"+
    ".ladder-rank-admin-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:6px;padding-top:7px;margin-top:1px;border-top:1px dashed rgba(255,255,255,.055);}"+
    "@media(max-width:430px){.ladder-rank-grid{grid-template-columns:44px minmax(0,1fr) 78px 64px;gap:6px}.ladder-rank-head-v2{padding-left:3px;padding-right:3px;font-size:10px}.ladder-rank-row-v2{padding:9px 3px;min-height:54px}.ladder-rank-position{font-size:11px}.ladder-player-link{font-size:12px}.ladder-tier-display{gap:4px}.ladder-tier-emblem{width:28px;height:32px;flex-basis:28px}.ladder-tier-emblem span{font-size:10px}.ladder-tier-name{font-size:10px}.ladder-points-cell strong{font-size:12px}.ladder-points-cell span{font-size:8px}.ladder-rank-admin-actions{justify-content:stretch}.ladder-rank-admin-actions .btn{flex:1;min-width:0;}}";
  document.head.appendChild(rankingStyle);
})();
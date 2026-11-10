(function (root) {
  'use strict';
  const keys = ['A', 'B', 'C', 'D', 'runners-up', 'champions'];
  const labels = { A: 'A 組', B: 'B 組', C: 'C 組', D: 'D 組', 'runners-up': '第 5～8 名', champions: '第 1～4 名' };
  const statuses = { unpublished: '尚未公布', 'not-applicable': '本場不適用', scheduled: '已抽籤 · 待開賽', ready: '已公布', 'in-progress': '進行中', completed: '已完成', 'needs-review': '資料待核對' };
  const published = stage => stage && ['scheduled', 'ready', 'in-progress', 'completed', 'needs-review'].includes(stage.status);
  const verifiedStage = stage => published(stage) && stage.needsReview !== true && stage.status !== 'needs-review';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const codeValid = code => /^BXH-[A-Z0-9]{6}$/.test(code || '');
  const list = value => Array.isArray(value) ? value : [];
  function stageFor(data, key) { return list(data?.stages).find(stage => stage?.key === key); }
  function stageLabel(data, key) { return stageFor(data, key)?.label || labels[key] || '分組'; }
  function slot(code, mode = 'preview', auto = true) {
    if (mode !== 'own' && !codeValid(code)) return '';
    return '<section id="bxh-group-history" class="panel group-history" data-group-history-mode="' +
      (mode === 'own' ? 'own' : 'preview') + '" data-code="' + esc(code || '') + '" data-auto="' + (auto ? 'true' : 'false') +
      '" aria-label="' + (mode === 'own' ? '我的分組賽紀錄' : '分組賽對戰表') + '"></section>';
  }
  function matchCard(match, players, ownIds, stageStatus) {
    const names = new Map(list(players).map(player => [player.id, player.name]));
    const side = (entry, score) => {
      const id = entry?.playerId;
      const name = id ? names.get(id) || '選手資料待核對' : match.isBye ? '輪空' : '待定';
      const winner = !!id && match.completed && match.winnerId === id;
      return '<div class="group-history-side' + (winner ? ' is-winner' : '') + (ownIds.has(id) ? ' is-own' : '') + '"><span>' +
        esc(name) + (ownIds.has(id) ? '<small>本人／代報名</small>' : '') + '</span><b>' +
        (stageStatus !== 'scheduled' && stageStatus !== 'ready' && Number.isFinite(score) ? esc(score) : '—') + '</b></div>';
    };
    const result = match.isBye ? '輪空' : match.completed ? (match.forfeit ? '棄權判定' : '已完成') : '尚未完成';
    return '<article class="group-history-match' + (match.completed ? ' is-complete' : '') + '" data-index="' +
      esc(match.indexInRound ?? 0) + '" data-bye="' + !!match.isBye + '"><div class="group-history-match-meta">' +
      result + '</div>' + side(match.a, match.scoreA) + side(match.b, match.scoreB) + '</article>';
  }
  function tree(data, key) {
    const stage = stageFor(data, key);
    // Never render a roster or match in a draft/unknown stage, even on a malformed response.
    if (!published(stage)) return '<div class="group-history-placeholder" role="status">' +
      (stage?.status === 'not-applicable' ? '本場不使用這個組別。' : '尚未公布對戰表，公布後可在此查看。') + '</div>';
    if (!verifiedStage(stage)) return '<div class="group-history-placeholder" role="status">已回收賽果與目前資料尚待核對，暫不顯示對戰結果及名次。</div>';
    if (!list(stage.matches).length) return '<div class="group-history-placeholder">目前沒有可顯示的對戰；請稍後更新。</div>';
    const rounds = new Map();
    for (const match of list(stage.matches)) {
      const round = Number.isSafeInteger(match.round) && match.round >= 0 ? match.round : 0;
      const bracket = match.bracket === 'BZ' || match.bracket === 'B' || match.bracket === 'BRONZE' ? 'bronze' : 'main';
      const id = bracket + ':' + round;
      if (!rounds.has(id)) rounds.set(id, { round, bracket, matches: [] });
      rounds.get(id).matches.push(match);
    }
    const ownIds = new Set(list(data.ownPlayerIds));
    return (stage.needsReview ? '<p class="hint" role="status">此階段資料尚待核對，暫不據此確認名次。</p>' : '') +
      '<p class="group-history-scroll-hint">← 左右滑動查看各輪 →</p><div class="group-history-tree" tabindex="0" aria-label="' + esc(stageLabel(data, key)) + '對戰樹，可左右捲動">' +
      [...rounds.values()].sort((a, b) => (a.bracket === b.bracket ? 0 : a.bracket === 'main' ? -1 : 1) || a.round - b.round).map(round =>
        '<section class="group-history-round" data-round="' + round.round + '" data-bracket="' + round.bracket + '"><h4>' + (round.bracket === 'bronze' ? '季軍賽' : round.matches.length === 1 ? '冠亞' : '第 ' + (round.round + 1) + ' 輪') +
        '</h4><div class="group-history-round-matches">' + round.matches.sort((a, b) => (a.indexInRound || 0) - (b.indexInRound || 0))
          .filter(match => !match.isBye).map(match => matchCard(match, stage.players, ownIds, stage.status)).join('') + '</div></section>').join('') + '</div>';
  }
  function previews(data, selected = 'A') {
    if (!keys.includes(selected)) selected = 'A';
    const assigned = list(data?.assignedGroups).filter(key => ['A', 'B', 'C', 'D'].includes(key));
    const assignment = assigned.length ? '<div class="group-history-assignment" role="status"><span>你的抽籤組別</span><strong>' +
      assigned.map(key => esc(stageLabel(data, key))).join('、') + '</strong><small>可先查看對位；開賽及裁判台依主辦安排。</small></div>' : '';
    return assignment + '<div class="group-history-tabs" role="tablist" aria-label="選擇分組對戰表">' + keys.map(key => {
      const stage = stageFor(data, key);
      return '<button type="button" class="btn ' + (selected === key ? 'btn-primary' : 'btn-ghost') + '" role="tab"' +
        ' id="group-history-tab-' + key + '" aria-selected="' + (selected === key) + '" aria-controls="group-history-tree-panel"' +
        ' tabindex="' + (selected === key ? '0' : '-1') + '" data-group-history-stage="' + key + '"><strong>' +
        esc(stageLabel(data, key)) + '</strong><small>' + esc(statuses[stage?.status] || '尚未公布') + '</small></button>';
    }).join('') + '</div><section id="group-history-tree-panel" role="tabpanel" aria-labelledby="group-history-tab-' + selected +
      '"><div class="group-history-board-heading"><span>對戰表</span><h3>' + esc(stageLabel(data, selected)) + '</h3></div>' + tree(data, selected) + '</section>' +
      '<details class="group-history-disclaimer"><summary>比分資料說明</summary><p>舊版回收紀錄未保存比分快照，本頁比分為目前伺服器資料；回收結果不一致時暫停顯示並標示待核對。</p></details>';
  }
  function ownHistory(data) {
    const ids = new Set(list(data?.ownPlayerIds).filter(id => typeof id === 'string' && id));
    if (!ids.size) return '<p class="hint">沒有可核對的本人參賽紀錄。請確認使用報名時的帳號及主房代碼。</p>';
    const cards = [...ids].map(id => {
      const names = list(data.stages).filter(verifiedStage).flatMap(stage => list(stage.players));
      const name = names.find(player => player.id === id)?.name || '本人';
      const placement = !data.needsReview && !list(data.stages).some(stage => stage.needsReview || stage.status === 'needs-review') && list(data.placements).find(row => row.playerId === id && Number.isSafeInteger(row.placement) && row.placement > 0);
      const matches = list(data.ownMatches).filter(match => keys.includes(match.stageKey) && verifiedStage(stageFor(data, match.stageKey)) &&
        (match.a?.playerId === id || match.b?.playerId === id || match.isBye && match.winnerId === id));
      return '<article class="group-history-own"><h3>' + esc(name) + '</h3><p><strong>' +
        (placement ? '第 ' + placement.placement + ' 名' : '名次待核對') + '</strong></p>' +
        (matches.length ? '<ol>' + matches.map(match => {
          const stage = stageFor(data, match.stageKey);
          const opponentId = match.a?.playerId === id ? match.b?.playerId : match.a?.playerId;
          const opponent = list(stage.players).find(player => player.id === opponentId)?.name || '待定';
          const outcome = match.isBye ? '輪空' : !match.completed ? '尚未完成' : match.winnerId === id ? '勝' : match.loserId === id ? '敗' : '結果待核對';
          const scoreVisible = stage.status !== 'scheduled' && stage.status !== 'ready';
          return '<li><strong>' + esc(stageLabel(data, match.stageKey)) + ' · ' + (match.bracket === 'BZ' ? '季軍賽' : '第 ' + ((Number(match.round) || 0) + 1) + ' 輪') + ' · ' + outcome +
            '</strong><span>' + (match.isBye ? '輪空不計勝敗' : '對手：' + esc(opponent)) + '</span><span>比分 ' +
            (scoreVisible && Number.isFinite(match.scoreA) ? esc(match.scoreA) : '—') + '：' + (scoreVisible && Number.isFinite(match.scoreB) ? esc(match.scoreB) : '—') + '</span></li>';
        }).join('') + '</ol>' : '<p class="hint">尚無已公布的本人對戰。</p>') + '</article>';
    }).join('');
    const assigned = list(data.assignedGroups).filter(key => ['A', 'B', 'C', 'D'].includes(key));
    return (assigned.length ? '<div class="group-history-assignment" role="status"><span>你的抽籤組別</span><strong>' +
      assigned.map(key => esc(stageLabel(data, key))).join('、') + '</strong><small>組別已確定；等待主辦依序開賽。</small></div>' : '') +
      '<p class="hint">積分尚未核對入帳；子房不另計天梯積分。舊版回收紀錄未保存比分快照，比分依目前伺服器資料顯示。</p>' + cards;
  }
  function content(model) {
    const own = model.mode === 'own';
    const header = '<div class="panel-title">' + (own ? '我的分組賽紀錄' : '分組賽對戰表') + '</div>';
    const disabled = model.busy ? ' disabled' : '';
    const form = own ? '<form data-group-history-search><label for="group-history-parent-code">主房代碼</label><div class="group-history-search">' +
      '<input id="group-history-parent-code" name="parentCode" maxlength="10" placeholder="BXH-ABC123" value="' + esc(model.input || '') +
      '" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn btn-primary" type="submit"' + disabled + '>查詢</button></div></form>' : '';
    const discovery = own && model.canDiscover ? '<button type="button" class="btn btn-ghost" data-group-history-action="discover"' + disabled +
      '>尋找我的分組賽</button><p class="hint">只查詢目前設定的少量主房；較早賽事請輸入主房代碼。</p>' +
      list(model.discovered).map(code => '<button type="button" class="btn btn-ghost" data-group-history-code="' + esc(code) + '"' + disabled + '>' + esc(code) + '</button>').join('') : '';
    const notice = model.error ? '<p role="status" class="hint">' + esc(model.error) + '</p>' : '';
    const loading = model.busy ? '<p role="status">正在讀取分組賽紀錄…</p>' : '';
    const refresh = codeValid(model.code) ? '<button type="button" class="btn btn-ghost" data-group-history-action="refresh"' + disabled + '>' +
      (model.data ? '更新紀錄' : '查看分組賽紀錄') + '</button>' : '';
    const title = model.data ? '<h3>' + esc(model.data.parent?.name || model.code) + '</h3>' +
      (model.data.needsReview ? '<p class="hint" role="status">部分資料待核對，名次尚未確認。</p>' : '') : '';
    return header + form + discovery + notice + loading + title +
      (model.data ? (own ? ownHistory(model.data) : previews(model.data, model.selected)) : !own && model.started ? previews(null, model.selected) : '') + refresh;
  }
  const api = { keys, slot, codeValid, content, previews, ownHistory, esc };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BXHGroupHistoryView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

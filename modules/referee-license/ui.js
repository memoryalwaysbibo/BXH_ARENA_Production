/* BXH referee certificates. Server snapshots own totals, recognition and awards. */
(function (root) {
  'use strict';
  const D = root.BXHRefereeLicenseDomain;
  if (!D) throw new Error('referee-license-domain-required');
  const esc = D.escape, num = D.number;
  let session = null;
  const limits = Object.freeze({sourcePhotoBytes: 8 * 1024 * 1024, photoDataUrl: 600000, photoBytes: 450000});

  function stamp(ctx) { return String(ctx?.uid || '') + ':' + String(ctx?.epoch ?? 0); }
  function current(s) {
    if (session !== s) return false;
    if (typeof s.ctx.currentSession !== 'function') return true;
    const live = s.ctx.currentSession();
    return stamp(live) === s.key;
  }
  function allowedAdmin(s) {
    if (!current(s) || s.ctx.isSuperAdmin !== true) return false;
    return typeof s.ctx.currentSession !== 'function' || s.ctx.currentSession().isSuperAdmin === true;
  }
  function allowedMutation(s, payload) {
    return current(s) && !!payload?.targetUid && (allowedAdmin(s) || payload.action === 'photo' && payload.targetUid === s.ctx.uid);
  }
  function context(ctx) {
    if (!session || session.key !== stamp(ctx)) {
      session = {key: stamp(ctx), ctx, cache: new Map(), targetUid: '', query: '', items: null, searching: false,
        searchGeneration: 0, searchIncomplete: false, error: '', success: '', busy: false, pending: null, editor: null,
        editorRevision: null, photoDraft: null, photoRevision: null, photoTargetUid: '', photoGeneration: 0, photoBusy: false, selfView: 'duty', recordLimit: 20};
    } else session.ctx = ctx;
    return session;
  }
  function redraw(s) { if (current(s)) s.ctx.rerender?.(); }
  function record(s, uid) {
    if (!s.cache.has(uid)) s.cache.set(uid, {snapshot: null, loading: false, error: '', generation: 0});
    return s.cache.get(uid);
  }
  function message(error) {
    const raw = [error?.code, error?.message, error?.details?.reason, error?.details?.error].filter(Boolean).join(' ');
    const meanings = [
      [/initialization-preview-only/, '原18人目前僅排序預覽，尚未核准執行初始化。'],
      [/initial-sequence-not-ready|initial-certificate-missing/, '請依核准順序處理原18人；既有序列衝突須先核對，不會跳號發證。'],
      [/known-alias|person-already-bound|alias-already-bound/, '此人員或帳號已綁定其他證件身份，不可另發證。'],
      [/duplicate-recognition-source|duplicate-source-key/, '此來源已認列，請修改原筆，不能重複加總。'],
      [/cross-account-link-unverified/, '跨帳號來源尚未完成明確身份核實與關聯。'],
      [/feature-disabled|referee-certificates-disabled/, '裁判證功能尚未開放，請待管理者啟用後再試。'],
      [/sources-incomplete|ledger-incomplete|stored-backfill-invalid/, '資料仍待完整核對，暫時無法授予或變更；既有授予保留。'],
      [/chief-target-inactive|target-test-account/, '此帳號目前無法新增裁判長指定；既有歷史資料仍可查看。'],
      [/revision-conflict|version-conflict|stale-revision|aborted/, '資料已被更新。請重新整理、核對最新數量後再送出。'],
      [/chief-conflict|chief-revision/, '裁判長指定已更新，請重新整理後確認目前指定。'],
      [/not-eligible|requirements-not-met|ineligible|level-not-eligible/, '尚未符合這一階的全部晉升條件。'],
      [/already-awarded|rank-not-higher|level-not-higher|downgrade/, '這個階級已授予；既有授予不會因本次操作降低。'],
      [/super-admin-required|permission-denied|forbidden/, '目前帳號沒有這項管理權限。'],
      [/auth-required|unauthenticated|login-required/, '請重新登入後查看裁判資料。'],
      [/not-found|user-unavailable|account-not-found/, '找不到這位裁判，請確認搜尋結果或 UID。'],
      [/invalid-photo|photo-too-large|invalid-image/, '照片格式或大小不符，請重新選擇 JPG、PNG 或 WebP 照片。'],
      [/invalid-argument|invalid-entry|invalid-number|invalid-period/, '輸入內容不符合格式，請核對後重新送出。'],
      [/operation-conflict|idempotency-conflict/, '這筆操作的內容已變更，請重新整理後再送出。'],
      [/account-inactive|test-account|inactive-user/, '此帳號目前不適用正式裁判授證。'],
      [/service-unavailable|unimplemented/, '裁判資料服務尚未就緒，請稍後重試。'],
      [/snapshot-invalid/, '伺服器資料格式尚未完整，請重新整理後再試。'],
      [/photo-source-too-large/, '照片原始檔請選擇 8 MB 以內。'],
      [/photo-format/, '請選擇 JPG、PNG 或 WebP 照片。'],
      [/photo-decode|photo-dimensions/, '無法讀取這張照片，請換一張一般尺寸的照片。'],
      [/photo-output-too-large/, '這張照片壓縮後仍超過限制，請換一張較小的照片。'],
      [/failed-precondition/, '目前尚未符合這項操作條件，請重新整理後核對資料。']
    ];
    for (const [pattern, label] of meanings) if (pattern.test(raw)) return label;
    return '連線尚未確認，請稍後重試。畫面會保留最後已確認的資料。';
  }
  const definitive = error => /invalid-|not-eligible|ineligible|requirements-not-met|level-not-|already-awarded|downgrade|permission-denied|unauthenticated|auth-required|super-admin|forbidden|not-found|user-unavailable|account-|test-account|revision-conflict|version-conflict|stale-revision|aborted|chief-conflict|chief-revision|operation-conflict|idempotency-conflict|feature-disabled|failed-precondition|unimplemented/.test([error?.code, error?.message, error?.details?.reason].join(' '));
  async function call(payload) {
    if (!root.engagementService?.refereeLicense) throw new Error('service-unavailable');
    const result = await root.engagementService.refereeLicense(payload);
    if (!result?.ok) throw Object.assign(new Error(result?.error || result?.reason || 'request-failed'), {code: result?.code, details: result?.details});
    return result;
  }
  function validateSnapshot(snapshot, uid) {
    if (!snapshot || snapshot.uid !== uid || D.count(snapshot.revision) === null || !snapshot.stats ||
        D.count(snapshot.stats.decisions) === null || D.count(snapshot.stats.eventCount) === null ||
        !snapshot.stats.scales || !snapshot.stats.milestones ||
        [64,96,128].some(size => D.count(snapshot.stats.scales[size]) === null) ||
        D.MILESTONES.some(item => D.count(snapshot.stats.milestones[item.threshold]) === null) ||
        snapshot.certificate && (!D.rank(snapshot.certificate.awardedLevel) || !snapshot.certificate.number)) {
      throw new Error('snapshot-invalid');
    }
    return snapshot;
  }
  async function load(s, uid, force) {
    if (!uid || !current(s) || uid !== s.ctx.uid && !allowedAdmin(s)) return;
    const item = record(s, uid);
    if (item.loading || !force && (item.snapshot || item.error)) return;
    const generation = ++item.generation;
    item.loading = true; item.error = '';
    try {
      const result = await call({action: 'get', ...(uid === s.ctx.uid ? {} : {targetUid: uid})});
      if (!current(s) || item.generation !== generation || uid !== s.ctx.uid && !allowedAdmin(s)) return;
      item.snapshot = validateSnapshot(result.snapshot, uid);
      if (force && uid === s.targetUid && s.editor && !s.pending) s.editorRevision = item.snapshot.revision;
      if (force && uid === s.photoTargetUid && s.photoDraft && !s.pending) s.photoRevision = item.snapshot.revision;
    } catch (error) {
      if (current(s) && item.generation === generation) item.error = message(error);
    } finally {
      if (current(s) && item.generation === generation) { item.loading = false; redraw(s); }
    }
  }
  function ensure(s, uid) {
    const item = record(s, uid);
    if (!item.snapshot && !item.loading && !item.error) void load(s, uid, false);
    return item;
  }
  function button(label, action, extra, disabled) {
    return '<button type="button" class="btn btn-ghost rl-button" data-action="referee-license-' + action + '" ' + (extra || '') + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }
  function errorHtml(text) { return text ? '<p class="rl-message rl-error" role="alert">' + esc(text) + '</p>' : ''; }
  function feedback(s) {
    return errorHtml(s.error) + (s.success ? '<p class="rl-message rl-success" role="status">' + esc(s.success) + '</p>' : '') +
      (s.pending && allowedMutation(s, s.pending.payload) ? '<div class="rl-notice" role="status">有一筆變更尚待確認。' + button('重試原操作', 'retry', '', s.busy) + '</div>' : '');
  }
  function loadingHtml(item, uid) {
    if (!item.snapshot) return '<section class="panel rl-section"><p role="status">' + (item.loading ? '正在讀取裁判資料…' : '裁判資料尚未讀取。') + '</p>' + errorHtml(item.error) + (item.error ? button('重新整理', 'refresh', 'data-uid="' + esc(uid) + '"') : '') + '</section>';
    return errorHtml(item.error) + (item.loading ? '<p class="rl-small" role="status">正在更新，以下為最後已確認資料。</p>' : item.error ? '<p class="rl-small">以下保留最後已確認資料。</p>' : '');
  }
  function rankHtml(level, className) {
    const rank = D.rank(level);
    if (!rank) return '<span class="rl-small">尚未授證</span>';
    return '<span class="rl-rank ' + (className || '') + '" style="--rl-rank-light:' + rank.light + ';--rl-rank-dark:' + rank.dark + '"><span class="rl-level">L' + rank.level + '</span><span class="rl-kai">' + rank.name + '</span></span>';
  }
  function notices(snapshot) {
    const stats = snapshot.stats, pieces = [];
    if(stats.pendingBackfills)pieces.push(num(stats.pendingBackfills)+' 筆舊回補待明確類型與依據核實。');
    if(stats.auxiliaryCount)pieces.push('輔助經驗 '+num(stats.auxiliaryCount)+' 次（不加正式判決）。');
    if (snapshot.incomplete) pieces.push('部分資料尚未完整核對；以下顯示已確認的累積。');
    if (stats.pendingLogCount > 0) pieces.push(num(stats.pendingLogCount) + ' 筆判決待認列。');
    if (stats.pendingEvents > 0) pieces.push(num(stats.pendingEvents) + ' 場執勤尚待賽事完成；已確認判決照常累積。');
    if (stats.unknownScaleEvents > 0) pieces.push(num(stats.unknownScaleEvents) + ' 場已認列執勤的規模待確認。');
    if ((snapshot.certificate?.awardedLevel || 0) > snapshot.eligibleLevel) pieces.push('既有授予保留，經歷資料待核對。');
    return pieces.length ? '<div class="rl-notice" role="status">' + pieces.map(esc).join('<br>') + '</div>' : '';
  }
  function titleHtml(title, uid) {
    return '<div class="rl-heading"><h2>' + esc(title) + '</h2>' + button('重新整理', 'refresh', 'data-uid="' + esc(uid) + '"') + '</div>';
  }
  function highest(snapshot) {
    return D.MILESTONES.slice().reverse().find(item => snapshot.stats.milestones[item.threshold] > 0) || null;
  }
  function photoHtml(value, label) {
    const src = D.photo(value);
    return '<div class="rl-photo">' + (src ? '<img src="' + esc(src) + '" alt="' + esc(label || '裁判照片') + '">' : '<span>裁判照片<br><small>3：4</small></span>') + '</div>';
  }
  function savedPhoto(snapshot) { return snapshot.certificate?.photoDataUrl || snapshot.photoDataUrl || ''; }
  function certificateHtml(snapshot) {
    const certificate = snapshot.certificate, stats = snapshot.stats, milestone = highest(snapshot), isChief = snapshot.isChief === true || certificate?.isChief === true;
    const realName = snapshot.person?.realName || '本名待確認', nickname = snapshot.person?.nickname || '';
    return '<article class="rl-certificate" aria-label="個人裁判證"><header class="rl-certificate-header"><span class="rl-brand">BXH</span><div><h3>裁判證</h3><span>ARENA · REFEREE LICENSE</span></div></header>' +
      '<div class="rl-person">' + photoHtml(savedPhoto(snapshot), realName + '的裁判照片') + '<div><div class="rl-name">' + esc(realName) + '</div>' + (nickname ? '<p class="rl-small">暱稱｜' + esc(nickname) + '</p>' : '') +
      (isChief ? '<div class="rl-chief">裁判長</div><p class="rl-chief-label">唯一指定</p><div class="rl-underlying">' + (certificate ? '原授予 ' + rankHtml(certificate.awardedLevel) : '裁判證尚未發行') + '</div>' : rankHtml(certificate?.awardedLevel, 'rl-main-rank')) + '</div></div>' +
      (!certificate ? '<p class="rl-certificate-note">' + '由最高管理員核定後取得 L1 萌新裁判；零經驗亦可核准，讀取及執勤不會自行發證。' + '</p>' : '') +
      (certificate ? '<p class="rl-certificate-note">證件狀態：' + esc(certificate.status==='active'?'有效':certificate.status==='disabled'?'已停用':'待核定') + '</p>' : '') + '<div class="rl-certificate-body"><div class="rl-metrics"><div><span>累積判決</span><strong>' + num(stats.decisions) + '<small>場</small></strong></div><div><span>參與賽事</span><strong>' + num(stats.eventCount) + '<small>場</small></strong></div></div>' +
      '<div class="rl-scales" aria-label="大型賽事經歷，向下累計">' + [64,96,128].map(size => '<div><span>' + size + ' 人以上</span><strong>' + num(stats.scales[size]) + '<small>次</small></strong></div>').join('') + '</div>' +
      '<div class="rl-milestone-strip"><div><p class="rl-small">最高規模成就</p><strong>' + (milestone ? esc(milestone.name) + '｜' + num(stats.milestones[milestone.threshold]) + ' 次' : '尚待解鎖') + '</strong></div>' + button('查看成就', 'show-achievements') + '</div></div>' +
      '<footer class="rl-certificate-footer"><div><span>裁判編號</span><b>' + esc(certificate?.number || '尚未配號') + '</b></div><div><span>核發日期</span><b>' + (certificate?.issuedAt ? esc(D.date(certificate.issuedAt)) : '尚未核發') + '</b></div></footer></article>';
  }
  function progressHtml(snapshot) {
    const p = D.progress(snapshot), awarded = snapshot.certificate?.awardedLevel || 0;
    if (!p.target) return '<section class="panel rl-section"><h3>已達 L9 傳奇裁判</h3><p class="rl-small">判決與賽事經歷持續累積。</p></section>';
    if (!awarded) return '<section class="panel rl-section"><h3>首次授證</h3><p>最高管理員核定即可取得 L1 萌新裁判，無最低判決場數；尚未核准不配號。</p></section>';
    const decisions = snapshot.stats.decisions;
    return '<section class="panel rl-section"><div class="rl-heading"><h3>' + (awarded ? '下一階晉升進度' : '首次授證條件') + '</h3>' + rankHtml(p.target.level) + '</div>' +
      '<div class="rl-progress" role="progressbar" aria-label="本階判決場數進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round((p.fraction || 0) * 100) + '"><div style="width:' + Math.round((p.fraction || 0) * 100) + '%"></div></div>' +
      '<div class="rl-spread rl-small"><span>本階 ' + num(Math.max(0, Math.min(decisions - p.start, p.target.decisions - p.start))) + '／' + num(p.target.decisions - p.start) + '</span><span>' + (p.decisionGap ? '尚差 ' + num(p.decisionGap) + ' 場判決' : '判決場數已達標') + '</span></div>' +
      '<ul class="rl-gates"><li><span>累積判決</span><span>' + num(decisions) + '／' + num(p.target.decisions) + '</span></li>' + p.gates.filter(g => g.required > 0).map(g => '<li><span>' + g.size + ' 人以上賽事</span><span>' + num(g.current) + '／' + g.required + ' 次 ' + (g.current !== null && g.current >= g.required ? '✓' : '') + '</span></li>').join('') + '</ul>' +
      (snapshot.eligibleLevel > awarded ? '<p class="rl-notice">' + (snapshot.incomplete ? '依已核對資料已達 ' : '已符合 ') + esc(D.rank(snapshot.eligibleLevel)?.name || '較高階級') + (snapshot.incomplete ? ' 門檻；完整資料核對後才可授予。' : ' 條件，等待官方授予。') + '</p>' : '') + '</section>';
  }
  function rulesHtml() {
    return '<details class="panel rl-section rl-fold"><summary>九階晉升條件</summary><p class="rl-small">終身累積；判決與所有賽事經歷條件須同時達成。</p><ol class="rl-rules">' + D.RANKS.map(rank => '<li><div class="rl-heading">' + rankHtml(rank.level) + '<span>' + num(rank.decisions) + ' 場判決</span></div><p class="rl-small">' + [64,96,128].filter(size => rank.scales[size] > 0).map(size => size + ' 人以上 ' + rank.scales[size] + ' 次').join(' · ').replace(/^$/, '無大型賽事經歷要求') + '</p></li>').join('') + '</ol></details>';
  }
  function sourceHtml(snapshot, s) {
    const stats = snapshot.stats, allRows = Array.isArray(snapshot.systemRecords) ? snapshot.systemRecords : [], rows = allRows.slice(0, s.recordLimit);
    const backfills = (snapshot.backfills || []).filter(entry => entry.status === 'active');
    return '<details class="panel rl-section rl-fold"><summary>數據來源與執勤紀錄</summary><div class="rl-source-counts"><span>系統判決 <b>' + num(stats.systemDecisions) + '</b></span><span>官方回補 <b>' + num(stats.backfillDecisions) + '</b></span></div>' +
      '<p class="rl-small">賽事經歷在活動完成後認列；規模門檻向下累計，同一場賽事只計一次參與。</p>' +
      rows.map(row => '<div class="rl-record"><strong>' + esc(row.tournamentName || row.eventName || row.tournamentCode || row.eventCode || '執勤紀錄') + '</strong><p class="rl-small">' + esc(D.date(row.confirmedAt || row.completedAt || row.eventDate)) + (row.station ? ' · 第 ' + esc(row.station) + ' 台' : '') + '</p>' + (row.playerA || row.playerB ? '<p>' + esc(row.playerA || '—') + ' vs ' + esc(row.playerB || '—') + '</p>' : '') + recordStatusHtml(row) + '</div>').join('') +
      (allRows.length > rows.length ? button('顯示更多紀錄', 'records-more') : '') +
      (backfills.length ? '<h3 class="rl-subheading">歷史回補</h3>' + backfills.map(entry => '<div class="rl-record"><strong>' + esc(entry.period) + '</strong><p>' + num(entry.decisions) + ' 場判決 · ' + num(entry.events) + ' 場賽事</p><p class="rl-small">' + esc(D.entryScale(entry)) + ' · 官方明確認列／依據留存</p></div>').join('') : '') +
      (!rows.length && !backfills.length ? '<p class="rl-small">目前沒有可展開的執勤明細。</p>' : '') + '</details>';
  }
  function recordStatusHtml(row) {
    const reasons = {'responsibility-unverified':'操作帳號不代表責任裁判，待明確認列','current-result-not-completed': '判決已撤回或尚未完成', 'different-confirming-referee': '目前由其他裁判確認', 'test-event': '測試賽事', 'cancelled-event': '賽事已取消或關閉', 'duplicate-source-key': '重複紀錄', bye: '輪空', 'non-official-event': '非正式賽事', 'event-authority-unresolved': '活動官方屬性待核對', 'invalid-log-identity': '紀錄身分待核對', 'room-not-read': '賽事資料待讀取', 'source-room-unavailable': '原賽事資料待核對', 'source-matches-unavailable': '對戰資料待核對', 'match-unresolved': '對戰尚無法確認', 'current-result-invalid': '判決結果待核對', 'confirming-identity-unresolved': '確認裁判身分待核對'};
    if (row.status === 'pending_event') return '<p class="rl-small">判決已計入，賽事經歷待活動完成。</p>';
    if (row.status === 'recognized_manual') return '<p class="rl-small">已經明確責任認列（計入官方認列，不重複算系統判決）。</p>';
    if (row.status === 'verified') return '<p class="rl-small">已計入</p>';
    return '<p class="rl-small">' + (row.status === 'excluded' ? '未計入' : '待認列') + (reasons[row.reason] ? ' · ' + esc(reasons[row.reason]) : '') + '</p>';
  }
  function fontCredit() { return '<p class="rl-font-credit">稱號使用標楷體；未安裝時以正楷體備援。字型來源：<a href="https://www.cns11643.gov.tw/" target="_blank" rel="noopener noreferrer">數位發展部 CNS11643 全字庫</a>。</p>'; }
  function duty(s) {
    const uid = s.ctx.uid;
    if (!uid) return '<section class="panel rl-section"><p>請先登入後查看自己的裁判證。</p></section>';
    const item = ensure(s, uid);
    return '<div class="rl-root" data-referee-view="duty">' + titleHtml('我的執勤', uid) + feedback(s) + loadingHtml(item, uid) + (item.snapshot ? notices(item.snapshot) + certificateHtml(item.snapshot) + photoSection(item.snapshot, s) + progressHtml(item.snapshot) + rulesHtml() + sourceHtml(item.snapshot, s) + fontCredit() : '') + '</div>';
  }
  function achievements(s, fromDuty) {
    const uid = s.ctx.uid;
    if (!uid) return '<section class="panel rl-section"><p>請先登入後查看裁判成就。</p></section>';
    const item = ensure(s, uid), snapshot = item.snapshot;
    const body = snapshot ? (() => {
      const stats = snapshot.stats, earned = D.MILESTONES.filter(m => stats.milestones[m.threshold] > 0).length;
      return notices(snapshot) + '<section class="panel rl-section"><div class="rl-heading"><div><h3>裁判成就</h3><p class="rl-small">100～1,000 人賽事 · 實際裁判執勤</p></div><strong class="rl-achievement-count">' + earned + '／10</strong></div><p class="rl-small">首次達成解鎖，之後繼續累積次數。大型賽事同時累積較低門檻。</p><div class="rl-achievements">' +
        D.MILESTONES.map(m => { const n = D.count(stats.milestones[m.threshold]), unlocked = n !== null && n > 0; return '<article class="rl-achievement ' + (unlocked ? 'is-unlocked' : '') + '"><div class="rl-achievement-top"><strong>' + m.threshold.toLocaleString('zh-TW') + '</strong><span>' + (n === null ? '待確認' : unlocked ? '已解鎖' : '未解鎖') + '</span></div><h4>' + esc(m.name) + '</h4><p>' + (n === null ? '資料待確認' : unlocked ? num(n) + ' 次執勤' : '至少完成 1 場') + '</p><small>' + num(m.threshold) + ' 人以上</small></article>'; }).join('') + '</div>' +
        '<p class="rl-small rl-max-size">最高已知規模：' + (D.count(stats.knownMaxSize) === null || !stats.knownMaxSize ? '尚待確認' : (stats.maxPrecision === 'at_least' ? '至少 ' : '') + num(stats.knownMaxSize) + ' 人') + '</p></section>';
    })() : '';
    return '<div class="rl-root" data-referee-view="achievements">' + titleHtml('我的成就', uid) + '<div class="rl-actions">' + (fromDuty ? button('返回裁判證', 'show-duty') : '') + (typeof s.ctx.onHunterAchievements === 'function' ? button('查看獵人成就', 'hunter-achievements') : '') + '</div>' + loadingHtml(item, uid) + body + '</div>';
  }

  /* Administrative forms and shared owner/admin photo editing. */
  function blankEditor() { return {kind:'decision',sourceKey:'',sourceKeysText:'',sourceUid:'',basis:'',auxiliary:0,decisions: '1', events: '0', size: '', precision: 'unknown', period: '系統開始記錄前', note: ''}; }
  function input(name, label, value, options) {
    options = options || {};
    return '<label class="rl-field"><span>' + esc(label) + '</span><input class="rl-input" name="' + name + '" data-referee-field="' + name + '" type="' + (options.numeric ? 'number' : 'text') + '" ' +
      (options.numeric ? 'min="' + (options.positive ? '1' : '0') + '" max="1000000" step="1" inputmode="numeric" ' : '') + 'value="' + esc(value ?? '') + '" ' + (options.placeholder ? 'placeholder="' + esc(options.placeholder) + '" ' : '') +
      (options.max ? 'maxlength="' + options.max + '" ' : '') + (options.disabled ? 'disabled' : '') + '></label>';
  }
  function entryFromEditor(editor) {
    const events = editor.events === '' ? 0 : Number(editor.events);
    return {
      ...(editor.id ? {id: editor.id} : {}),...(editor.kind==='decision'&&editor.sourceKeysText?.trim()?{sourceKeys:editor.sourceKeysText.split(/[,\n]+/).map(x=>x.trim()).filter(Boolean)}:{}),kind:editor.kind,sourceKey:String(editor.sourceKey||'').trim(),sourceUid:String(editor.sourceUid||'').trim()||null,basis:String(editor.basis||'').trim(),auxiliary:Number(editor.auxiliary||0),
      decisions: editor.decisions === '' ? 0 : Number(editor.decisions), events,
      size: events > 0 && editor.precision !== 'unknown' ? Number(editor.size) : null,
      precision: editor.precision, period: String(editor.period || '').trim(), note: String(editor.note || '').trim()
    };
  }
  function impactHtml(snapshot, editor) {
    const entry = entryFromEditor(editor), impact = D.impact(snapshot, entry);
    if (!impact) return '<p class="rl-small">填入要新增的數量，即可預覽調整後累積。</p>';
    return '<div class="rl-impact"><p class="rl-small">目前 → 調整後</p><div class="rl-spread"><span>累積判決</span><strong>' + num(impact.decisions.current) + ' → ' + num(impact.decisions.after) + '</strong></div><div class="rl-spread"><span>參與賽事</span><strong>' + num(impact.eventCount.current) + ' → ' + num(impact.eventCount.after) + '</strong></div>' +
      (impact.thresholds.length ? '<p class="rl-small">門檻變化：' + impact.thresholds.map(item => item.size + ' 人以上 ' + (item.delta > 0 ? '＋' : '−') + Math.abs(item.delta)).join('、') + '</p>' : '') +
      (entry.events && entry.precision === 'unknown' ? '<p class="rl-small">先計入參與次數，規模經歷留待補充。</p>' : '') + '</div>';
  }
  function backfillForm(s, snapshot) {
    if (!s.editor) { s.editor = blankEditor(); s.editorRevision = snapshot.revision; }
    const entry = s.editor, disabled = s.busy || !!s.pending, noSize = Number(entry.events || 0) <= 0 || entry.precision === 'unknown';
    return '<section class="panel rl-section"><div class="rl-heading"><h3>' + (entry.id ? '修改歷史回補' : '歷史回補') + '</h3>' + (entry.id ? button('取消修改', 'edit-cancel', '', disabled) : '') + '</div>' +
      '<p class="rl-small">每筆明確認列責任與依據；操作帳號不等於責任裁判。相同來源不得重複計入。</p>' +
      '<form class="rl-form" data-referee-form="backfill"><fieldset ' + (disabled ? 'disabled' : '') + '><div class="rl-form-grid">' +
      '<label class="rl-field"><span>認列類型</span><select name="kind" data-referee-field="kind" class="rl-input">' + [['decision','正式責任判決'],['event','活動經歷'],['auxiliary','輔助經驗（不加判決）']].map(([k,v])=>'<option value="'+k+'" '+(entry.kind===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label>' +
      '<label class="rl-field"><span>批次正式判決來源鍵（選填，每行一個，最多200個；場數必須相等）</span><textarea name="sourceKeysText" data-referee-field="sourceKeysText" class="rl-input" maxlength="32200">'+esc(entry.sourceKeysText||'')+'</textarea></label>' + input('auxiliary','輔助次數',entry.auxiliary,{numeric:true}) + input('sourceKey','唯一來源（match:賽事碼:對戰ID／event:賽事碼／historical:核實編號）',entry.sourceKey,{max:160}) + input('sourceUid','來源帳號UID（跨帳號需先核實關聯；不自動移轉）',entry.sourceUid,{max:128}) + input('basis','責任／經歷認列依據（必填）',entry.basis,{max:500}) +
      input('decisions', '回補判決場數', entry.decisions, {numeric: true, placeholder: '0'}) + input('events', '回補參與賽事次數', entry.events, {numeric: true, placeholder: '0'}) +
      '<label class="rl-field"><span>賽事規模</span><select name="precision" data-referee-field="precision" class="rl-input">' + [['exact','記得確切人數'],['at_least','至少達到此規模'],['unknown','規模未確認']].map(([key, label]) => '<option value="' + key + '" ' + (entry.precision === key ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
      input('size', '每場賽事人數', entry.size, {numeric: true, positive: true, disabled: noSize, placeholder: '例如 148'}) + '</div>' +
      '<p class="rl-small">正式判決逐一來源鍵認列（每筆最多200場）、活動經歷每筆1場；輔助不得加入正式判決或活動經歷。原生活動規模以後端核對為準。</p>' + input('period', '涵蓋期間', entry.period, {max: 100, placeholder: '例如 2026 年 1～9 月'}) +
      '<label class="rl-field"><span>備註（選填）</span><textarea class="rl-input" name="note" data-referee-field="note" rows="3" maxlength="500" placeholder="例如：依過往執勤印象認列">' + esc(entry.note) + '</textarea></label>' +
      '<div data-referee-impact aria-live="polite">' + impactHtml(snapshot, entry) + '</div><div class="rl-actions"><button class="btn btn-primary rl-button" type="submit">' + (s.busy ? '正在確認…' : entry.id ? '儲存本筆修改' : '認列回補') + '</button></div></fieldset></form></section>';
  }
  function historyHtml(entry) {
    const history = Array.isArray(entry.history) ? entry.history : [];
    if (!history.length) return '';
    const labels = {create: '新增回補', created: '新增回補', saveBackfill: '儲存回補', update: '修改回補', updated: '修改回補', revoke: '撤銷回補', revoked: '撤銷回補', revokeBackfill: '撤銷回補', restore: '恢復回補', restored: '恢復回補', restoreBackfill: '恢復回補'};
    return '<details class="rl-audit"><summary>修改紀錄（' + history.length + '）</summary>' + history.map(item => '<div><strong>' + esc(labels[item.action] || labels[item.type] || '資料調整') + '</strong><span>' + esc(D.date(item.at || item.updatedAt || item.createdAt)) + '</span>' +
      (item.actorUid || item.updatedBy ? '<small>操作人：' + esc(item.actorUid || item.updatedBy) + '</small>' : '') +
      (item.before && item.after ? '<small>判決 ' + num(item.before.decisions) + ' → ' + num(item.after.decisions) + '；賽事 ' + num(item.before.events) + ' → ' + num(item.after.events) + '</small>' : '') + '</div>').join('') + '</details>';
  }
  function backfillsHtml(snapshot, s) {
    const entries = Array.isArray(snapshot.backfills) ? snapshot.backfills : [], disabled = s.busy || !!s.pending;
    return '<section class="panel rl-section"><h3>回補紀錄</h3>' + (snapshot.historyTruncated ? '<p class="rl-small">顯示最近的修改紀錄；較早歷程未全部展示，認列累積不受影響。</p>' : '') + (entries.length ? entries.map(entry => '<article class="rl-backfill ' + (entry.status === 'revoked' ? 'is-revoked' : '') + '"><div class="rl-heading"><strong>' + esc(entry.period || '期間未記錄') + '</strong><span class="rl-small">' + (entry.status === 'revoked' ? '已撤銷' : entry.recognitionValid ? '已認列' : '待重新核實') + '</span></div><p>' + num(entry.decisions) + ' 場判決 · ' + num(entry.events) + ' 場賽事</p><p class="rl-small">' + esc(D.entryScale(entry)) + ' · 類型與依據留存</p>' + (entry.note ? '<p class="rl-small">' + esc(entry.note) + '</p>' : '') +
      '<p class="rl-small">更新於 ' + esc(D.date(entry.updatedAt)) + (entry.updatedBy ? ' · ' + esc(entry.updatedBy) : '') + '</p><div class="rl-actions">' +
      (entry.status === 'revoked' ? button('恢復認列', 'restore', 'data-entry-id="' + esc(entry.id) + '"', disabled) : button('修改', 'edit', 'data-entry-id="' + esc(entry.id) + '"', disabled) + button('撤銷認列', 'revoke', 'data-entry-id="' + esc(entry.id) + '"', disabled)) + '</div>' + historyHtml(entry) + '</article>').join('') : '<p class="rl-small">尚無歷史回補。</p>') + '</section>';
  }
  function awardHtml(snapshot, s) {
    const currentLevel = snapshot.certificate?.awardedLevel || 0;
    const eligible = D.count(snapshot.eligibleLevel) ?? 0;
    const options = D.RANKS.filter(rank => rank.level > currentLevel && rank.level >= 1 && rank.level <= (currentLevel?eligible:1));
    const disabled = s.busy || !!s.pending, grantDisabled = disabled || currentLevel>0 && (snapshot.incomplete === true || snapshot.certificate.status!=='active');
    if (!options.some(rank => rank.level === s.grantLevel)) s.grantLevel = options.at(-1)?.level || null;
    return '<section class="panel rl-section"><h3>正式授予</h3><p>資格與帳號角色／active獨立。核定、停用與恢復不改單場三席權限；永久號不回收。</p>' +
      '<label class="rl-field">核定人員識別碼<input class="rl-input" data-referee-approval="personId" value="'+esc(s.approvalPersonId||snapshot.identityPersonId||'')+'"></label><label class="rl-field">核實／變更依據（必填）<input class="rl-input" data-referee-approval="basis" value="'+esc(s.approvalBasis||'')+'"></label>' +
      (snapshot.certificate ? button(snapshot.certificate.status==='disabled'?'恢復資格':'停用資格','qualification','',disabled) + '<label class="rl-field">已核實同人小號UID<input class="rl-input" data-referee-approval="aliasUid" value="'+esc(s.aliasUid||'')+'"></label>'+button('核實帳號關聯（不移轉經歷）','link-account','',disabled) : '') + '<div class="rl-award-current"><span>目前授予</span>' + rankHtml(currentLevel) + '</div><p class="rl-small">' + (snapshot.incomplete ? '依已核對資料推估資格：' : '系統判定資格：') + (eligible ? 'L' + eligible + ' ' + esc(D.rank(eligible)?.name || '') : '尚未符合 L1') + '</p>' +
      (snapshot.incomplete ? '<p class="rl-notice">資料待完整核對，暫停授予 L2 以上階級；L1 仍可明確核定。</p>' : '') +
      (currentLevel > eligible ? '<p class="rl-notice">目前經歷資料與既有授予不一致，請核對回補或待認列資料。既有授予仍保留。</p>' : '') +
      (options.length ? '<label class="rl-field"><span>選擇授予階級</span><select class="rl-input" data-referee-grant-level ' + (grantDisabled ? 'disabled' : '') + '>' + options.map(rank => '<option value="' + rank.level + '" ' + (rank.level === s.grantLevel ? 'selected' : '') + '>L' + rank.level + ' ' + rank.name + '</option>').join('') + '</select></label>' + button('授予選定階級', 'grant', '', grantDisabled) : '<p class="rl-small">' + (currentLevel === 9 ? '已授予最高階級。' : '尚無待授予的更高階級。') + '</p>') +
      '<details class="rl-fold rl-admin-role"><summary>裁判長指定</summary><p class="rl-small">全體僅保留一位指定裁判長；原授予階級另行保留。</p>' + (snapshot.isChief && !snapshot.certificate ? '<p class="rl-small">裁判長已指定，裁判證尚未發行。</p>' : '') + button(snapshot.isChief || snapshot.certificate?.isChief ? '解除裁判長指定' : '指定為唯一裁判長', 'chief', '', disabled) + '</details><details><summary>資格核定歷程</summary>'+(snapshot.qualificationHistory||[]).map(h=>'<p>'+esc(h.action)+' · '+esc(D.date(h.updatedAt))+' · '+esc(h.updatedBy)+' · '+esc(h.basis||'')+'</p>').join('')+'</details></section>';
  }
  function photoSection(snapshot, s) {
    const disabled = s.busy || !!s.pending || s.photoBusy, ownDraft = s.photoTargetUid === snapshot.uid ? s.photoDraft : null;
    const ownBusy = s.photoTargetUid === snapshot.uid && s.photoBusy, attr = 'data-uid="' + esc(snapshot.uid) + '"';
    return '<details class="panel rl-section rl-fold" ' + (ownDraft || ownBusy ? 'open' : '') + '><summary>裁判照片</summary><div class="rl-photo-editor">' + photoHtml(ownDraft || savedPhoto(snapshot)) + '<div><label class="rl-field"><span>選擇一張照片</span><input class="rl-photo-input" type="file" accept="image/jpeg,image/png,image/webp" data-referee-photo-input ' + attr + ' ' + (disabled ? 'disabled' : '') + '></label><p class="rl-small">JPG／PNG／WebP，8 MB 以內。照片會置中裁成 3：4，確認預覽後儲存。</p>' + (ownBusy ? '<p class="rl-small" role="status">正在準備照片預覽…</p>' : '') + '<div class="rl-actions">' +
      (ownDraft ? button('儲存照片', 'photo-save', attr, disabled) + button('取消更換', 'photo-cancel', attr, disabled) : '') +
      (savedPhoto(snapshot) && !ownDraft ? button('移除照片', 'photo-remove', attr, disabled) : '') + '</div></div></div></details>';
  }
  function admin(s) {
    if (!allowedAdmin(s)) return '<section class="panel rl-section"><p role="alert">只有具裁判管理權限的最高管理員可以開啟此頁。</p></section>';
    const selected = s.targetUid ? ensure(s, s.targetUid) : null, snapshot = selected?.snapshot;
    return '<div class="rl-root" data-referee-view="admin"><div class="rl-heading"><h2>裁判管理</h2>' + (s.targetUid ? button('重新整理', 'refresh', 'data-uid="' + esc(s.targetUid) + '"', s.busy) : '') + '</div>' +
      '<section class="panel rl-section"><form class="rl-search" data-referee-form="search"><label class="rl-field"><span>搜尋姓名、暱稱或 UID</span><input class="rl-input" type="search" name="query" data-referee-query value="' + esc(s.query) + '" maxlength="80" placeholder="輸入裁判資料" ' + (s.searching || s.busy || s.pending ? 'disabled' : '') + '></label><button type="submit" class="btn btn-primary rl-button" ' + (s.searching || s.busy || s.pending ? 'disabled' : '') + '>' + (s.searching ? '搜尋中…' : '搜尋') + '</button></form>' +
      (s.items ? '<div class="rl-search-results">' + (s.items.length ? s.items.map(person => '<button type="button" class="rl-person-result" data-action="referee-license-select" data-uid="' + esc(person.uid) + '" ' + (s.busy || s.pending ? 'disabled' : '') + '><strong>' + esc(person.realName || '本名未填') + '</strong><span>' + esc(person.nickname || '未填暱稱') + '</span>' + (person.active === false ? '<span class="rl-small">' + (person.accountStatus === 'deleted' ? '已刪除帳號' : person.accountStatus === 'test' ? '測試帳號' : '已停用帳號') + ' · 歷史資料</span>' : '') + '<small>' + esc(person.uid) + '</small></button>').join('') : '<p class="rl-small">找不到符合的裁判。</p>') + '</div>' : '') + (s.searchIncomplete ? '<p class="rl-small">結果較多，請輸入更完整姓名／UID。</p>' : '') + '</section>' +
      feedback(s) + (selected ? loadingHtml(selected, s.targetUid) : '<p class="rl-small">先搜尋並選擇要管理的裁判。</p>') +
      (snapshot ? '<section class="panel rl-section"><div class="rl-heading"><div><h3>' + esc(snapshot.person?.realName || '本名待確認') + '</h3><p class="rl-small">' + esc(snapshot.person?.nickname || '') + '</p></div>' + rankHtml(snapshot.certificate?.awardedLevel) + '</div><p class="rl-small rl-uid">UID：' + esc(snapshot.uid) + '</p><div class="rl-admin-totals"><span>累積判決 <strong>' + num(snapshot.stats.decisions) + '</strong></span><span>參與賽事 <strong>' + num(snapshot.stats.eventCount) + '</strong></span></div>' + notices(snapshot) + '</section>' + awardHtml(snapshot, s) + backfillForm(s, snapshot) + photoSection(snapshot, s) + backfillsHtml(snapshot, s) + sourceHtml(snapshot, s) : '') + '</div>';
  }
  async function search(s) {
    if (!allowedAdmin(s) || s.searching || s.busy || s.pending) return;
    const query = s.query.trim();
    if (!query || query.length > 80) {s.error = '請輸入 80 字以內的姓名、暱稱或 UID。'; redraw(s); return;}
    const generation = ++s.searchGeneration;
    s.searching = true; s.error = ''; s.success = ''; redraw(s);
    try {
      const result = await call({action: 'search', query});
      if (!allowedAdmin(s) || generation !== s.searchGeneration) return;
      s.items = Array.isArray(result.items) ? result.items.filter(person => person && typeof person.uid === 'string') : [];
      s.searchIncomplete = result.incomplete === true;
    } catch (error) {
      if (current(s) && generation === s.searchGeneration) s.error = message(error);
    } finally {
      if (current(s) && generation === s.searchGeneration) {s.searching = false; redraw(s);}
    }
  }
  const successText = {saveBackfill: '歷史回補已認列，累積與資格已更新。', revokeBackfill: '這筆回補已撤銷，修改紀錄保留。', restoreBackfill: '這筆回補已恢復認列。', grant: '正式階級已授予。', setChief: '裁判長指定已更新。', photo: '裁判照片已更新。'};
  async function performPending(s) {
    if (!s.pending || !allowedMutation(s, s.pending.payload) || s.busy) return;
    const pending = s.pending, uid = pending.payload.targetUid;
    s.busy = true; s.error = ''; s.success = ''; redraw(s);
    try {
      const result = await call(pending.payload);
      if (!allowedMutation(s, pending.payload) || s.pending !== pending) return;
      const snapshot = validateSnapshot(result.snapshot, uid);
      const item = record(s, uid); item.generation++; item.loading = false; item.error = ''; item.snapshot = snapshot;
      s.pending = null;
      if (s.targetUid === uid) {
        if (pending.payload.action === 'saveBackfill') s.editor = blankEditor();
        if(s.editor) s.editorRevision = snapshot.revision;
      }
      if (pending.payload.action === 'photo' && s.photoTargetUid === uid) {s.photoDraft = null; s.photoRevision = null; s.photoTargetUid = '';}
      if (pending.payload.action === 'setChief') {
        // The chief is global: other cached certificates must be re-read after an appointment.
        for (const [otherUid, other] of s.cache) if (otherUid !== uid) {other.snapshot = null; other.error = ''; other.loading = false; other.generation++;}
      }
      s.success = successText[pending.payload.action] || '變更已確認。';
    } catch (error) {
      if (!current(s) || s.pending !== pending) return;
      s.error = message(error);
      if (definitive(error)) {
        s.pending = null;
        if (/aborted|revision-conflict|chief-revision/.test([error?.code, error?.message, error?.details?.reason].join(' '))) {
          await load(s, uid, true);
          if (current(s) && !record(s, uid).error) s.error = '資料已更新。請核對最新累積或照片預覽，再重新送出；本次未自動重送。';
        }
      }
    } finally {
      if (current(s)) {s.busy = false; redraw(s);}
    }
  }
  function mutation(s, payload, revision, targetUid) {
    const uid = targetUid || s.targetUid;
    if (!allowedMutation(s, {...payload, targetUid: uid}) || s.busy || s.pending) return;
    const snapshot = record(s, uid).snapshot;
    if (!snapshot || D.count(revision ?? snapshot.revision) === null) return;
    if (!root.crypto?.randomUUID) {s.error = '瀏覽器尚未支援安全操作識別，請更新瀏覽器後再試。'; redraw(s); return;}
    s.pending = {payload: {...payload, targetUid: uid, expectedRevision: revision ?? snapshot.revision, operationId: root.crypto.randomUUID()}};
    void performPending(s);
  }

  async function preparePhoto(s, file, uid) {
    if (!allowedMutation(s, {action: 'photo', targetUid: uid}) || s.busy || s.pending || !file) return;
    const snapshot = record(s, uid).snapshot;
    if (!snapshot) return;
    const generation = ++s.photoGeneration;
    s.error = ''; s.success = ''; s.photoDraft = null; s.photoRevision = null; s.photoTargetUid = uid;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {s.error = message(new Error('photo-format')); redraw(s); return;}
    if (file.size > limits.sourcePhotoBytes) {s.error = message(new Error('photo-source-too-large')); redraw(s); return;}
    s.photoBusy = true; redraw(s);
    let url;
    try {
      url = URL.createObjectURL(file);
      const image = new Image();
      await new Promise((resolve, reject) => {image.onload = resolve; image.onerror = () => reject(new Error('photo-decode')); image.src = url;});
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('photo-dimensions');
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
      const painter = canvas.getContext('2d'); if (!painter) throw new Error('photo-decode');
      painter.fillStyle = '#ffffff'; painter.fillRect(0, 0, 600, 800);
      const scale = Math.max(600 / image.naturalWidth, 800 / image.naturalHeight);
      painter.drawImage(image, (600 - image.naturalWidth * scale) / 2, (800 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      let dataUrl = '';
      for (const quality of [.86,.76,.65,.55]) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        const body = candidate.slice(candidate.indexOf(',') + 1);
        const bytes = body.length * 3 / 4 - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
        if (candidate.length <= limits.photoDataUrl && bytes <= limits.photoBytes) {dataUrl = candidate; break;}
      }
      if (!dataUrl) throw new Error('photo-output-too-large');
      if (!allowedMutation(s, {action: 'photo', targetUid: uid}) || s.photoGeneration !== generation) return;
      s.photoDraft = dataUrl; s.photoRevision = snapshot.revision;
    } catch (error) { if (current(s) && s.photoGeneration === generation) s.error = message(error); }
    finally {if (url) URL.revokeObjectURL(url); if (current(s) && s.photoGeneration === generation) {s.photoBusy = false; redraw(s);}}
  }
  function selectAdminTarget(s, uid) {
    if (!allowedAdmin(s) || s.busy || s.pending || !/^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) return false;
    s.targetUid = uid; s.editor = null; s.editorRevision = null; s.photoDraft = null; s.photoRevision = null; s.photoTargetUid = ''; s.photoGeneration++; s.photoBusy = false;
    s.grantLevel = null; s.approvalPersonId='';s.approvalBasis='';s.aliasUid=''; s.error = ''; s.success = ''; s.recordLimit = 20;
    ensure(s, s.targetUid); redraw(s); return true;
  }
  function handleAction(action, element, ctx) {
    if (!String(action).startsWith('referee-license-')) return false;
    const s = context(ctx), key = action.slice('referee-license-'.length), data = element?.dataset || {};
    if (key === 'refresh') {
      const uid = data.uid || s.targetUid || s.ctx.uid;
      if (!s.busy && !s.pending) {s.error = ''; s.success = ''; void load(s, uid, true); redraw(s);}
      return true;
    }
    if (key === 'show-achievements') {if (s.ctx.onRefereeAchievements?.() === true) {s.selfView = 'duty'; return true;} s.selfView = 'achievements'; redraw(s); return true;}
    if (key === 'show-duty') {s.selfView = 'duty'; redraw(s); return true;}
    if (key === 'hunter-achievements') {s.ctx.onHunterAchievements?.(); return true;}
    if (key === 'records-more') {s.recordLimit += 20; redraw(s); return true;}
    if (key === 'retry') {void performPending(s); return true;}
    if (key.startsWith('photo-')) {
      const uid = data.uid || s.photoTargetUid || s.ctx.uid;
      if (!allowedMutation(s, {action: 'photo', targetUid: uid}) || s.busy || s.pending) return true;
      if (key === 'photo-save' && s.photoDraft && s.photoTargetUid === uid) mutation(s, {action: 'photo', dataUrl: s.photoDraft}, s.photoRevision, uid);
      else if (key === 'photo-remove') mutation(s, {action: 'photo', dataUrl: ''}, undefined, uid);
      else if (key === 'photo-cancel' && s.photoTargetUid === uid) {s.photoGeneration++; s.photoBusy = false; s.photoDraft = null; s.photoRevision = null; s.photoTargetUid = ''; redraw(s);}
      return true;
    }
    if (!allowedAdmin(s)) {s.error = '目前沒有裁判管理權限。'; redraw(s); return true;}
    if (s.busy || s.pending) return true;
    if (key === 'search') {void search(s); return true;}
    if (key === 'select') {
      if (!(s.items || []).some(person => person.uid === data.uid)) return true;
      return selectAdminTarget(s, data.uid);
    }
    const snapshot = record(s, s.targetUid).snapshot;
    if (!snapshot) return true;
    if (key === 'edit') {
      const entry = (snapshot.backfills || []).find(item => item.id === data.entryId && item.status === 'active');
      if (entry) {s.editor = {kind:entry.kind||'decision',sourceKey:entry.sourceKey||'',sourceKeysText:(entry.sourceKeys||[]).join('\n'),sourceUid:entry.sourceUid||'',basis:entry.basis||'',auxiliary:entry.auxiliary||0,id: entry.id, decisions: entry.decisions, events: entry.events, size: entry.size ?? '', precision: entry.precision, period: entry.period, note: entry.note || ''}; s.editorRevision = snapshot.revision; s.error = ''; s.success = ''; redraw(s);}
    } else if (key === 'edit-cancel') {s.editor = blankEditor(); s.editorRevision = snapshot.revision; s.error = ''; redraw(s);}
    else if (key === 'save-backfill') {
      const entry = entryFromEditor(s.editor || blankEditor()), errors = D.validateEntry(entry);
      if (errors.length) {s.error = errors.join(' '); redraw(s);} else mutation(s, {action: 'saveBackfill', entry}, s.editorRevision);
    } else if (key === 'revoke' || key === 'restore') {
      const entry = (snapshot.backfills || []).find(item => item.id === data.entryId);
      if (entry) mutation(s, {action: key === 'revoke' ? 'revokeBackfill' : 'restoreBackfill', entryId: entry.id});
    } else if (key === 'grant') {
      const level = Number(s.grantLevel);
      if ((level===1 || !snapshot.incomplete) && D.rank(level) && level >= 1 && level > (snapshot.certificate?.awardedLevel || 0) && level <= snapshot.eligibleLevel) mutation(s, {action: 'grant', level,...(level===1?{personId:s.approvalPersonId||snapshot.identityPersonId,basis:s.approvalBasis||''}:{})});
    } else if (key==='qualification') {
      mutation(s,{action:snapshot.certificate?.status==='disabled'?'restoreQualification':'disable',basis:s.approvalBasis||''});
    } else if (key==='link-account') {
      mutation(s,{action:'linkAccount',aliasUid:s.aliasUid||'',basis:s.approvalBasis||''});
    } else if (key === 'chief') {
      if (D.count(snapshot.chiefRevision) === null) {s.error = '裁判長指定資料待確認，請重新整理。'; redraw(s);}
      else mutation(s, {action: 'setChief', appointed: !(snapshot.isChief || snapshot.certificate?.isChief), expectedChiefRevision: snapshot.chiefRevision});
    }
    return true;
  }
  function updateEditor(element) {
    const s = session;
    if (!s || !allowedAdmin(s) || s.busy || s.pending) return;
    const form = element.closest?.('[data-referee-form="backfill"]');
    if (!form || !s.editor) return;
    const key = element.dataset.refereeField;
    if (!['decisions','events','size','precision','period','note','kind','auxiliary','sourceKey','sourceKeysText','sourceUid','basis'].includes(key)) return;
    s.editor[key] = element.value;
    const size = form.querySelector('[name="size"]');
    if (size) size.disabled = Number(s.editor.events || 0) <= 0 || s.editor.precision === 'unknown';
    const impact = form.querySelector('[data-referee-impact]'), snapshot = record(s, s.targetUid).snapshot;
    if (impact && snapshot) impact.innerHTML = impactHtml(snapshot, s.editor);
  }
  document.addEventListener('input', event => {
    const el = event.target, s = session;
    if (!el?.dataset || !s || !allowedAdmin(s)) return;
    if ('refereeQuery' in el.dataset && !s.busy && !s.pending) s.query = el.value;
    if ('refereeApproval' in el.dataset) {const keys={personId:'approvalPersonId',basis:'approvalBasis',aliasUid:'aliasUid'};const key=keys[el.dataset.refereeApproval];if(key)s[key]=el.value;}
    if ('refereeField' in el.dataset) updateEditor(el);
  });
  document.addEventListener('change', event => {
    const el = event.target, s = session;
    if (!el?.dataset || !s) return;
    if ('refereePhotoInput' in el.dataset) {void preparePhoto(s, el.files?.[0], el.dataset.uid || s.ctx.uid); return;}
    if (!allowedAdmin(s)) return;
    if ('refereeApproval' in el.dataset) {const keys={personId:'approvalPersonId',basis:'approvalBasis',aliasUid:'aliasUid'};const key=keys[el.dataset.refereeApproval];if(key)s[key]=el.value;}
    if ('refereeField' in el.dataset) updateEditor(el);
    if ('refereeGrantLevel' in el.dataset) s.grantLevel = Number(el.value);
  });
  document.addEventListener('submit', event => {
    const form = event.target, kind = form?.dataset?.refereeForm;
    if (!kind || !session) return;
    event.preventDefault();
    if (kind === 'search') {
      session.query = form.querySelector('[name="query"]')?.value || session.query;
      void search(session);
    } else if (kind === 'backfill') handleAction('referee-license-save-backfill', form, session.ctx);
  });
  root.BXHRefereeLicense = Object.freeze({
    renderDuty(ctx) {const s = context(ctx); return s.selfView === 'achievements' ? achievements(s, true) : duty(s);},
    renderAchievements(ctx) {return achievements(context(ctx), false);},
    renderAdmin(ctx) {return admin(context(ctx));},
    handleAction,
    openAdminTarget(uid, ctx) {return root.BXH_REFEREE_CERTIFICATES_V1 === true && selectAdminTarget(context(ctx), uid);},
    resetSession() {session = null;}
  });
})(window);

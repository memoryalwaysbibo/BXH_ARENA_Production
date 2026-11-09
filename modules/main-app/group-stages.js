(function (root) {
  'use strict';

  const groupKeys = ['A', 'B', 'C', 'D'];
  const groupCounts = [2, 4];
  const roomCode = /^BXH-[A-Z0-9]{6}$/;
  const errors = {
    'group-parent-roster-changed': '報到名單已變動，請先確認名單。',
    'group-registration-mismatch': '分組名單和報名紀錄不同步，請先核對。',
    'group-stage-not-complete': '這一階段尚未打完或尚未封存。',
    'group-stage-score-unavailable': '目前無法確認子房的分桶比分，請更新進度後再試。',
    'group-draw-not-ready': '名次賽尚未抽籤，請先到子房產生對戰表。',
    'group-draw-not-published': '請先公布名次賽籤表。',
    'group-room-disabled': '這間房尚未啟用分組。',
    'group-parent-unavailable': '請確認房間類型、公開狀態與賽事進度。',
    'group-rehearsal-linked-roster': '分組測試房只接受未綁定帳號的現場訪客。',
    'group-invalid-count': '請選擇 2 組或 4 組。',
    'group-count-locked': '這場已完成分組。請更新進度查看結果。',
    'group-stage-already-open': '這場已有分組開賽，無法重新抽籤。',
    'group-roster-size': '有效參賽人數超出所選組數的範圍，請確認名單與組數。',
    'group-court-busy': '這台仍有目前場次、已安排的下一場或待同步比分，暫時無法釋出。',
    'group-court-last': '這組還有場次，至少需要保留 1 台。',
    'group-court-stale': '台號歸屬已變動，請更新進度後再操作。',
    'group-court-state-changed': '子房的裁判台狀態已變動，請更新進度並核對。',
    'group-court-unavailable': '這組目前無法調整實體裁判台。',
  };

  let rehearsalUid = null;
  let rehearsalNode = null;
  const rehearsalAccess = new Map();

  function enabled(code, parentCode, uid) {
    if (parentCode || !roomCode.test(code || '')) return false;
    return (Array.isArray(root.BXH_GROUP_STAGE_PARENT_CODES) && root.BXH_GROUP_STAGE_PARENT_CODES.includes(code)) ||
      (!!uid && uid === rehearsalUid && rehearsalAccess.get(code)?.allowed === true);
  }

  function rehearsalProbe(state) {
    const m = state.meta;
    if (!roomCode.test(state.cloudCode || '') || state.groupStage || state.testMode || state.startedAt ||
      state.matches?.length || state.archiveStatus === 'completed' || m?.eventCancelled ||
      m?.registrationVisibility !== 'private' || m.registrationEnabled !== false || m.ladderMode !== 'general' ||
      (m.eventAuthority && m.eventAuthority !== 'official') || m.formatType !== 'single' ||
      m.battleMode !== 'individual' || m.playMode !== 'standard') return '';
    return '<span id="bxh-group-rehearsal-probe" data-code="' + state.cloudCode + '" hidden></span>';
  }

  function discover(node, uid, request, refresh) {
    if (uid !== rehearsalUid) {
      rehearsalAccess.clear();
      rehearsalUid = uid;
    }
    rehearsalNode = node;
    const code = node?.dataset.code;
    if (!uid || !roomCode.test(code || '') || enabled(code, null, uid)) return;
    const existing = rehearsalAccess.get(code);
    if (existing?.pending || existing?.retryAfter > Date.now()) return;
    const attempt = { pending: true };
    rehearsalAccess.set(code, attempt);
    void Promise.resolve().then(() => request({ action: 'status', parentCode: code })).then(status => {
      if (rehearsalAccess.get(code) !== attempt) return;
      attempt.allowed = status?.rehearsal === true && (status.unprepared === true || Array.isArray(status.groups));
      if (attempt.allowed && rehearsalNode?.isConnected && rehearsalNode.dataset.code === code) refresh();
    }).catch(() => {}).finally(() => {
      attempt.pending = false;
      attempt.retryAfter = Date.now() + 30000;
    });
  }

  function slot(code, role, parentCode, uid, childStage) {
    if (role === 'operator' && roomCode.test(parentCode || '') && groupKeys.includes(childStage)) {
      return '<div class="panel">' + roomButton(parentCode, 'operator', '返回主房分組管理') + '</div>' +
        '<section id="bxh-group-stage-panel" class="panel" data-code="' + parentCode +
        '" data-view="child" data-stage="' + childStage + '" aria-label="實體裁判台管理"></section>';
    }
    if (role === 'operator' && enabled(parentCode, null, uid) && parentCode !== code) {
      return '<div class="panel">' + roomButton(parentCode, 'operator', '返回主房分組管理') + '</div>';
    }
    if (!enabled(code, parentCode, uid)) return '';
    const view = role === 'operator' ? 'operator' : 'player';
    return '<section id="bxh-group-stage-panel" class="panel" data-code="' + code +
      '" data-view="' + view + '" aria-label="分組賽進度"></section>';
  }

  function drawButton(code, blocked, uid) {
    if (!enabled(code, null, uid)) return '';
    return '<span data-group-stage-draw-controls class="btn-row">' +
      '<label>組數 <select aria-label="分組組數" disabled>' +
      '<option value="">請選擇組數</option>' + groupCounts.map(count =>
        '<option value="' + count + '">' + count + ' 組（' + groupKeys.slice(0, count).join('、') + '）</option>'
      ).join('') + '</select></label>' +
      '<button type="button" id="bxh-group-stage-draw" class="btn btn-ghost"' +
      ' data-blocked="' + (blocked ? 'true' : 'false') + '" disabled>分組抽籤</button></span>';
  }

  function roomButton(code, view, label) {
    if (!roomCode.test(code || '')) return '';
    const action = view === 'operator' ? 'cloud-admin-open-tournament' : 'switch-to-player-watch';
    return '<button type="button" class="btn btn-ghost" data-action="' + action + '" data-code="' +
      code + '">' + label + '</button>';
  }

  function commandButton(action, label, busy) {
    return '<button type="button" class="btn btn-primary" data-group-stage-action="' + action +
      '"' + (busy ? ' disabled' : '') + '>' + label + '</button>';
  }

  function courtControls(status, busy, onlyGroup) {
    const groups = (status.runningGroups || []).map(item => item.key).filter(key => groupKeys.includes(key));
    if (!status.courts || (onlyGroup && !groups.includes(onlyGroup))) return '';
    const button = (action, number, revision, group, label) =>
      '<button type="button" class="btn btn-ghost btn-sm" data-group-stage-action="' + action +
      '" data-stage="' + group + '" data-court="' + number + '" data-revision="' + revision +
      '"' + (busy ? ' disabled' : '') + '>' + label + '</button>';
    const rows = Array.from({ length: 12 }, (_, i) => i + 1).map(number => {
      const court = status.courts[number];
      if (!Number.isSafeInteger(court?.revision) || (court.group !== null && !groups.includes(court.group))) return '';
      if (onlyGroup && court.group && court.group !== onlyGroup) return '';
      const controls = court.group
        ? button('release-court', number, court.revision, court.group, '釋出 ' + number + ' 號台')
        : groups.filter(key => !onlyGroup || key === onlyGroup).map(key =>
          button('claim-court', number, court.revision, key, key + ' 組接管')).join('');
      return '<li><strong>' + number + ' 號台｜' + (court.group ? court.group + ' 組' : '可接管') +
        '</strong><div class="btn-row">' + controls + '</div></li>';
    }).join('');
    return rows ? '<details data-group-court-pool' + (onlyGroup ? ' open' : '') + '><summary>實體裁判台 1～12</summary>' +
      '<p class="hint">有場次或下一場安排的台需先打完。回收組別賽果時，該組的台會一併釋出。</p><ul>' + rows + '</ul></details>' : '';
  }

  function content(view, status, { loaded = true, busy = false, error = '', stage: childStage } = {}) {
    const child = view === 'child';
    const operator = child || view === 'operator';
    const header = '<div class="panel-title">' + (child ? '實體裁判台管理' : operator ? '主房分組管理' : '我的分組賽') + '</div>';
    const refresh = commandButton('refresh', busy ? '處理中…' : '更新進度', busy);
    const notice = error ? '<p class="hint" role="status">' + error + '</p>' : '';
    if (!loaded) return header + (error ? notice + refresh : '<p class="hint" role="status">正在讀取分組進度…</p>');
    if (child) return header + notice + (status ? courtControls(status, busy, childStage) : '') + refresh;
    if (!status) {
      const message = operator ? '選擇組數後按一次分組抽籤，系統會分配名單並產生 A～D 組對戰表。' : '等待主辦確認分組。';
      return header + '<p class="hint">' + message + '</p>' + notice + refresh;
    }

    const completed = Array.isArray(status.completed) ? status.completed : [];
    const key = operator ? status.current?.key : status.current;
    const drawPending = operator ? status.current?.drawPending : status.drawPending;
    const countByGroup = new Map((status.groups || []).map(group => [group.key, group.count]));
    const groups = groupKeys.filter(group => countByGroup.has(group));
    const groupCount = groups.length;
    const stages = [...groups, 'champions', 'runners-up'];
    const running = operator ? (status.runningGroups || []).filter(item => groups.includes(item.key) && roomCode.test(item.code)) : [];
    const titles = Object.fromEntries(groups.map(group => [group, group + ' 組']));
    titles.champions = '第 1～' + groupCount + ' 名賽';
    titles['runners-up'] = '第 ' + (groupCount + 1) + '～' + (groupCount * 2) + ' 名賽';
    const next = titles[status.next];
    const progress = '<ol class="hint">' + stages.map(stage => {
      const count = countByGroup.get(stage);
      const label = completed.includes(stage) ? '已完成' : key === stage ?
        (drawPending ? '待抽籤' : '進行中') : running.some(item => item.key === stage) ? '已開放' : '待開放';
      return '<li>' + titles[stage] + (Number.isInteger(count) ? '（' + count + ' 人）' : '') + ' · ' + label + '</li>';
    }).join('') + '</ol>';
    const waitingForFinals = groups.every(stage => completed.includes(stage)) &&
      !completed.includes('champions') && (!key || drawPending);
    const message = status.readyForSettlement
      ? (status.rehearsal ? '測試賽果已收齊，本場不發放天梯積分。' : '各階段賽果已收齊，等待全場結算。') :
      waitingForFinals ? (groupCount * 2) + ' 位晉級者已確認｜名次賽待抽籤' :
      running.length ? '已開放：' + running.map(item => titles[item.key]).join('、') :
      titles[key] ? '目前進行：' + titles[key] + (drawPending ? '待抽籤' : '') :
      next ? '下一階段：' + next : '等待主辦開放下一階段。';
    const myGroups = (status.assignedGroups || []).filter(group => groups.includes(group));
    const assignment = !operator && myGroups.length
      ? '<p><strong>我的組別　' + myGroups.map(group => titles[group]).join('、') + '</strong></p>'
      : '';
    let actions = refresh;
    if (operator && status.drawAllPending) {
      actions = commandButton('open-all', '完成各組對戰表抽籤', busy) + refresh;
    } else if (running.length) {
      actions = running.map(item => roomButton(item.code, view, '開啟' + titles[item.key] + '房間') +
        '<button type="button" class="btn btn-primary" data-group-stage-action="collect" data-stage="' + item.key +
        '"' + (busy ? ' disabled' : '') + '>回收' + titles[item.key] + '賽果</button>').join('') + refresh;
    } else if (operator && titles[key]) {
      actions = roomButton(status.current.code, view, '開啟' + titles[key] + (drawPending ? '抽籤' : '房間')) +
        (drawPending ? commandButton('publish-draw', '公布名次賽籤表', busy) :
          commandButton('collect', '回收' + titles[key] + '賽果', busy)) + refresh;
    } else if (operator && next) {
      actions = commandButton('open', '開放' + next, busy) + refresh;
    } else if (!operator && titles[key] && !drawPending) {
      actions = roomButton(status.roomCode, view, '進入' + titles[key] + '戰場') + refresh;
    }
    const pendingRooms = operator && !status.parallel && status.preDrawnRooms
      ? groups.filter(group => group !== key && !completed.includes(group) &&
        roomCode.test(status.preDrawnRooms[group] || ''))
        .map(group => roomButton(status.preDrawnRooms[group], 'operator',
          '查看' + group + '組對戰表（待開放）')).join('') : '';
    const previews = pendingRooms
      ? '<div class="panel"><strong>已抽好的後續組別</strong><p class="hint">可先查看對戰表；依序回收前一組後才開放下一組。</p>' +
        '<div class="btn-row">' + pendingRooms + '</div></div>' : '';
    return header + assignment + '<p class="hint" role="status">' + message + '</p>' +
      progress + notice + '<div class="btn-row">' + actions + '</div>' + previews +
      (running.length ? courtControls(status, busy) : '');
  }

  let active = null;
  let timer = null;

  function schedule(model) {
    clearTimeout(timer);
    if (model.view === 'player' && !model.busy) {
      timer = setTimeout(() => {
        if (active !== model) return;
        if (root.document.hidden) schedule(model);
        else void send(model, 'refresh');
      }, 12000 + Math.random() * 4000);
    }
  }

  function render(model) {
    if (active !== model || !model.node.isConnected) return;
    const pool = model.node.querySelector('[data-group-court-pool]');
    const poolOpen = pool?.open;
    model.node.innerHTML = content(model.view, model.status, model);
    const nextPool = model.node.querySelector('[data-group-court-pool]');
    if (nextPool && poolOpen !== undefined) nextPool.open = poolOpen;
    const button = model.drawButton;
    if (button) {
      const blocked = button.dataset.blocked === 'true' || !model.loaded || model.busy || !!model.status;
      button.disabled = blocked || !groupCounts.includes(model.groupCount);
      button.textContent = model.status ? '已完成分組抽籤' : '一次抽好各組';
      if (model.groupSelect) {
        model.groupSelect.disabled = blocked;
        model.groupSelect.value = String(model.status?.groups.length ?? model.groupCount ?? '');
      }
    }
  }

  async function send(model, action, target) {
    if (active !== model || model.busy) return;
    const current = target?.stage && action === 'collect'
      ? model.status?.runningGroups?.find(item => item.key === target.stage) : model.status?.current;
    const payload = { action, parentCode: model.code };
    if (action === 'refresh') payload.action = model.view === 'player' ? 'routing' : 'status';
    if (action === 'prepare') payload.groupCount = model.groupCount;
    if (action === 'open') payload.stage = model.status?.next;
    if (action === 'collect' || action === 'publish-draw') {
      payload.stage = current?.key;
      payload.roomCode = current?.code;
    }
    if (action === 'release-court' || action === 'claim-court') {
      payload.stage = target.stage;
      payload.court = Number(target.court);
      payload.revision = Number(target.revision);
    }
    model.busy = true;
    model.error = '';
    render(model);
    try {
      let status = await model.request(payload);
      if (action === 'prepare' && Array.isArray(status?.groups) && status.drawAllPending) {
        status = await model.request({ action: 'open-all', parentCode: model.code });
      }
      if (status?.unprepared === true || status === null) model.status = null;
      else if (Array.isArray(status?.groups)) model.status = status;
      else throw new Error('group-invalid-response');
      model.loaded = true;
    } catch (error) {
      const reason = Object.keys(errors).find(code => String(error?.message || '').includes(code));
      model.error = errors[reason] || '無法更新分組進度，請稍後重試。';
    } finally {
      model.busy = false;
      if (active === model) {
        render(model);
        schedule(model);
      }
    }
  }

  function bind(node, uid, request, groupDrawButton) {
    if (!node || !uid || (node.dataset.view !== 'child' && !enabled(node.dataset.code, null, node.dataset.view === 'operator' ? uid : null)) || typeof request !== 'function') {
      clearTimeout(timer);
      active = null;
      return;
    }
    const { code, view, stage } = node.dataset;
    const key = uid + ':' + code + ':' + view + ':' + (stage || '');
    if (active?.key !== key) {
      clearTimeout(timer);
      active = { key, code, view, stage, status: null, loaded: false, busy: false, error: '', groupCount: null, request };
    }
    const model = active;
    if (model.node === node) return;
    model.node = node;
    model.drawButton = view === 'operator' ? groupDrawButton : null;
    model.groupSelect = model.drawButton?.closest('[data-group-stage-draw-controls]')?.querySelector('select');
    model.groupSelect?.addEventListener('change', event => {
      if (active === model && event.currentTarget === model.groupSelect && !model.groupSelect.disabled) {
        model.groupCount = Number(model.groupSelect.value) || null;
        model.drawButton.disabled = !groupCounts.includes(model.groupCount);
      }
    });
    model.drawButton?.addEventListener('click', event => {
      if (active !== model || event.currentTarget !== model.drawButton || event.currentTarget.disabled ||
        !groupCounts.includes(model.groupCount)) return;
      if (root.confirm('確認將本場有效參賽名單平均分成 ' + model.groupCount + ' 組？')) void send(model, 'prepare');
    });
    node.addEventListener('click', event => {
      const target = event.target.closest('[data-group-stage-action]');
      const action = target?.dataset.groupStageAction;
      if (active !== model || !action || target.disabled) return;
      void send(model, action, target.dataset);
    });
    if (model.loaded || model.busy || model.error) render(model);
    else void send(model, 'refresh');
  }

  const api = { enabled, slot, drawButton, bind, content, rehearsalProbe, discover };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BXHGroupStageUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

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

  function slot(code, role, parentCode, uid) {
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

  function content(view, status, { loaded = true, busy = false, error = '' } = {}) {
    const operator = view === 'operator';
    const header = '<div class="panel-title">' + (operator ? '主房分組管理' : '我的分組賽') + '</div>';
    const refresh = commandButton('refresh', busy ? '處理中…' : '更新進度', busy);
    const notice = error ? '<p class="hint" role="status">' + error + '</p>' : '';
    if (!loaded) return header + (error ? notice + refresh : '<p class="hint" role="status">正在讀取分組進度…</p>');
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
    const playoffs = groupCount === 4 ? ['runners-up', 'champions'] : ['champions', 'runners-up'];
    const stages = [...groups, ...playoffs];
    const titles = Object.fromEntries(groups.map(group => [group, group + ' 組']));
    titles.champions = '第 1～' + groupCount + ' 名賽';
    titles['runners-up'] = '第 ' + (groupCount + 1) + '～' + (groupCount * 2) + ' 名賽';
    const next = titles[status.next];
    const progress = '<ol class="hint">' + stages.map(stage => {
      const count = countByGroup.get(stage);
      const label = completed.includes(stage) ? '已完成' : key === stage ?
        (drawPending ? '待抽籤' : '進行中') : '待開放';
      return '<li>' + titles[stage] + (Number.isInteger(count) ? '（' + count + ' 人）' : '') + ' · ' + label + '</li>';
    }).join('') + '</ol>';
    const waitingForFinals = !key && groups.every(stage => completed.includes(stage)) &&
      playoffs.every(stage => !completed.includes(stage));
    const message = status.readyForSettlement
      ? (status.rehearsal ? '測試賽果已收齊，本場不發放天梯積分。' : '各階段賽果已收齊，等待全場結算。') :
      waitingForFinals ? (groupCount * 2) + ' 位晉級者已確認｜名次賽待抽籤' :
      titles[key] ? '目前進行：' + titles[key] + (drawPending ? '待抽籤' : '') :
      next ? '下一階段：' + next : '等待主辦開放下一階段。';
    const myGroups = (status.assignedGroups || []).filter(group => groups.includes(group));
    const assignment = !operator && myGroups.length
      ? '<p><strong>我的組別　' + myGroups.map(group => titles[group]).join('、') + '</strong></p>'
      : '';
    let actions = refresh;
    if (operator && status.drawAllPending) {
      actions = commandButton('open-all', '完成各組對戰表抽籤', busy) + refresh;
    } else if (operator && titles[key]) {
      actions = roomButton(status.current.code, view, '開啟' + titles[key] + (drawPending ? '抽籤' : '房間')) +
        (drawPending ? commandButton('publish-draw', '公布名次賽籤表', busy) :
          commandButton('collect', '回收' + titles[key] + '賽果', busy)) + refresh;
    } else if (operator && status.openChoices?.length > 1) {
      actions = status.openChoices.filter(stage => playoffs.includes(stage)).map((stage, index) =>
        '<button type="button" class="btn ' + (index === 0 ? 'btn-primary' : 'btn-ghost') +
        '" data-group-stage-action="open" data-group-stage-choice="' + stage + '"' +
        (busy ? ' disabled' : '') + '>先開放' + titles[stage] + (index === 0 ? '（預設）' : '') + '</button>'
      ).join('') + refresh;
    } else if (operator && next) {
      actions = commandButton('open', '開放' + next, busy) + refresh;
    } else if (!operator && titles[key] && !drawPending) {
      actions = roomButton(status.roomCode, view, '進入' + titles[key] + '戰場') + refresh;
    }
    const pendingRooms = operator && status.preDrawnRooms
      ? groups.filter(group => group !== key && !completed.includes(group) &&
        roomCode.test(status.preDrawnRooms[group] || ''))
        .map(group => roomButton(status.preDrawnRooms[group], 'operator',
          '查看' + group + '組對戰表（待開放）')).join('') : '';
    const previews = pendingRooms
      ? '<div class="panel"><strong>已抽好的後續組別</strong><p class="hint">可先查看對戰表；依序回收前一組後才開放下一組。</p>' +
        '<div class="btn-row">' + pendingRooms + '</div></div>' : '';
    return header + assignment + '<p class="hint" role="status">' + message + '</p>' +
      progress + notice + '<div class="btn-row">' + actions + '</div>' + previews;
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
    model.node.innerHTML = content(model.view, model.status, model);
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

  async function send(model, action, choice) {
    if (active !== model || model.busy || !model.node?.isConnected) return;
    const current = model.status?.current;
    const payload = { action, parentCode: model.code };
    if (action === 'refresh') payload.action = model.view === 'operator' ? 'status' : 'routing';
    if (action === 'prepare') payload.groupCount = model.groupCount;
    if (action === 'open') payload.stage = choice || model.status?.next;
    if (action === 'collect' || action === 'publish-draw') {
      payload.stage = current?.key;
      payload.roomCode = current?.code;
    }
    model.busy = true;
    model.error = '';
    render(model);
    try {
      let status = await model.request(payload);
      if (active !== model || !model.node.isConnected) return;
      if (action === 'prepare' && Array.isArray(status?.groups) && status.drawAllPending) {
        status = await model.request({ action: 'open-all', parentCode: model.code });
        if (active !== model || !model.node.isConnected) return;
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
    if (!node || !uid || !enabled(node.dataset.code, null, node.dataset.view === 'operator' ? uid : null) || typeof request !== 'function') {
      clearTimeout(timer);
      active = null;
      return;
    }
    const { code, view } = node.dataset;
    const key = uid + ':' + code + ':' + view;
    if (active?.key !== key) {
      clearTimeout(timer);
      active = { key, code, view, status: null, loaded: false, busy: false, error: '', groupCount: null, request };
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
      const button = event.target.closest('[data-group-stage-action]');
      if (active !== model || !button || button.disabled) return;
      void send(model, button.dataset.groupStageAction, button.dataset.groupStageChoice);
    });
    if (model.loaded || model.busy || model.error) render(model);
    else void send(model, 'refresh');
  }

  root.addEventListener?.('pagehide', () => bind(null));

  const api = { enabled, slot, drawButton, bind, content, rehearsalProbe, discover };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BXHGroupStageUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

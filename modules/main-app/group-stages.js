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
    'group-roster-size': '有效參賽人數超出所選組數的範圍，請確認名單與組數。',
  };

  function enabled(code, parentCode) {
    return !parentCode && roomCode.test(code || '') && Array.isArray(root.BXH_GROUP_STAGE_PARENT_CODES) &&
      root.BXH_GROUP_STAGE_PARENT_CODES.includes(code);
  }

  function slot(code, role, parentCode) {
    if (role === 'operator' && enabled(parentCode) && parentCode !== code) {
      return '<div class="panel">' + roomButton(parentCode, 'operator', '返回主房分組管理') + '</div>';
    }
    if (!enabled(code)) return '';
    const view = role === 'operator' ? 'operator' : 'player';
    return '<section id="bxh-group-stage-panel" class="panel" data-code="' + code +
      '" data-view="' + view + '" aria-label="分組賽進度"></section>';
  }

  function drawButton(code, blocked) {
    if (!enabled(code)) return '';
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
      const message = operator ? '請先選擇組數，再按「分組抽籤」。系統會平均分配有效參賽名單。' : '等待主辦確認分組。';
      return header + '<p class="hint">' + message + '</p>' + notice + refresh;
    }

    const completed = Array.isArray(status.completed) ? status.completed : [];
    const key = operator ? status.current?.key : status.current;
    const drawPending = operator ? status.current?.drawPending : status.drawPending;
    const countByGroup = new Map((status.groups || []).map(group => [group.key, group.count]));
    const groups = groupKeys.filter(group => countByGroup.has(group));
    const groupCount = groups.length;
    const stages = [...groups, 'champions', 'runners-up'];
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
    const waitingForFinals = groups.every(stage => completed.includes(stage)) &&
      !completed.includes('champions') && (!key || drawPending);
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
    if (operator && titles[key]) {
      actions = roomButton(status.current.code, view, '開啟' + titles[key] + (drawPending ? '抽籤' : '房間')) +
        (drawPending ? commandButton('publish-draw', '公布名次賽籤表', busy) :
          commandButton('collect', '回收' + titles[key] + '賽果', busy)) + refresh;
    } else if (operator && next) {
      actions = commandButton('open', '開放' + next, busy) + refresh;
    } else if (!operator && titles[key] && !drawPending) {
      actions = roomButton(status.roomCode, view, '進入' + titles[key] + '戰場') + refresh;
    }
    return header + assignment + '<p class="hint" role="status">' + message + '</p>' +
      progress + notice + '<div class="btn-row">' + actions + '</div>';
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
      button.textContent = model.status ? '已完成分組抽籤' : '分組抽籤';
      if (model.groupSelect) {
        model.groupSelect.disabled = blocked;
        model.groupSelect.value = String(model.status?.groups.length ?? model.groupCount ?? '');
      }
    }
  }

  async function send(model, action) {
    if (active !== model || model.busy) return;
    const current = model.status?.current;
    const payload = { action, parentCode: model.code };
    if (action === 'refresh') payload.action = model.view === 'operator' ? 'status' : 'routing';
    if (action === 'prepare') payload.groupCount = model.groupCount;
    if (action === 'open') payload.stage = model.status?.next;
    if (action === 'collect' || action === 'publish-draw') {
      payload.stage = current?.key;
      payload.roomCode = current?.code;
    }
    model.busy = true;
    model.error = '';
    render(model);
    try {
      model.status = await model.request(payload);
      model.loaded = true;
    } catch (error) {
      model.error = errors[error?.message] || '無法更新分組進度，請稍後重試。';
    } finally {
      model.busy = false;
      if (active === model) {
        render(model);
        schedule(model);
      }
    }
  }

  function bind(node, uid, request, groupDrawButton) {
    if (!node || !uid || !enabled(node.dataset.code) || typeof request !== 'function') {
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
      const action = event.target.closest('[data-group-stage-action]')?.dataset.groupStageAction;
      if (active !== model || !action) return;
      void send(model, action);
    });
    if (model.loaded || model.busy || model.error) render(model);
    else void send(model, 'refresh');
  }

  const api = { enabled, slot, drawButton, bind, content };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BXHGroupStageUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

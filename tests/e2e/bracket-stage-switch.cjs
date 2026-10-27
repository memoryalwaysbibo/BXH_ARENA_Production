/* Focused real-browser coverage for stage filtering, geometry and view isolation. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch { ({ chromium } = require('playwright')); }

const root = path.resolve(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'modules/main-css/core-competition.css'), 'utf8');

// Compile candidate boundaries, so nested templates/braces cannot truncate a function.
function productionFunction(name) {
  const match = new RegExp('(?:^|\\n)((?:async )?function ' + name + '\\s*\\()').exec(core);
  assert.ok(match, 'missing production function: ' + name);
  const start = match.index + match[0].indexOf(match[1]);
  for (let end = core.indexOf('}', start); end !== -1; end = core.indexOf('}', end + 1)) {
    const candidate = core.slice(start, end + 1);
    try { new vm.Script('(' + candidate + ')'); return candidate; }
    catch { /* Continue through an incomplete nested expression. */ }
  }
  throw Error('Cannot extract production function: ' + name);
}

const functionNames = [
  'boardStageContext', 'availableBoardStage', 'selectedBoardStage', 'boardStageStartRound',
  'boardStageSummary', 'boardExportLabel', 'renderBoardStageSwitch', 'setBoardStage',
  'getMatch', 'orderedMatches', 'refereeMatches', 'displayMatchNumber', 'displayMatchLabel',
  'matchesInRound', 'numRoundsTotal', 'singleRoundTitle', 'effectiveSingleBracketLayout',
  'seMatchBoxHtml', 'renderCompactSingleElimBracket', 'renderSingleElimBracket',
  'layoutSingleElimBracket', 'positionSingleElimFinalDecorations', 'drawSingleElimConnectors',
  'singleBracketPathRoom', 'singleBracketPathPlayer', 'singleBracketPlayerHtml',
  'singleBracketPlayerHistory', 'applySingleBracketPlayerPath', 'selectSingleBracketPlayerPath',
  'showSingleBracketPathDetails',
  'scheduleSeRelayout', 'renderBoardMode', 'currentRoundLabelForBoard',
  'tournamentMatchListGroup', 'renderTournamentMatchList', 'renderPrintBracket', 'wrapPrintWatermark',
  'clearBoardModeInteractions', 'bindBoardModeInteractions', 'setBoardZoom', 'setBoardPinchZoom',
  'applyBoardTransform', 'flushBoardTransform', 'syncBoardFullscreen', 'toggleBoardFullscreen',
  'exportBoardAsImage'
];
const functions = functionNames.map(productionFunction).join('\n');
const stageGlobals = [
  core.match(/^const BOARD_STAGE_SIZES\s*=.*$/m)?.[0],
  core.match(/^let boardStageSelection\s*=.*$/m)?.[0]
];
assert.ok(stageGlobals.every(Boolean), 'production stage globals are present');

function fixture(count, { completed = false, bronze = false, code = 'BXH-STAGES' } = {}) {
  const size = 2 ** Math.ceil(Math.log2(count));
  const total = Math.log2(size);
  const state = {
    id: code, cloudCode: code, bracketSize: size,
    meta: { name: '階段切換測試', date: '2026-10-28', location: '台南', formatType: 'single', battleMode: 'individual', bronzeMatch: bronze },
    players: Array.from({ length: count }, (_, i) => ({ id: 'p' + (i + 1), name: '測試選手' + (i + 1) })),
    matches: [], championId: completed ? 'p1' : null, runnerUpId: completed ? 'p2' : null,
    thirdId: completed && bronze ? 'p3' : null, fourthId: completed && bronze ? 'p4' : null
  };
  let playerIndex = 1;
  for (let round = 0; round < total; round++) {
    const previous = state.matches.filter(m => m.round === round - 1);
    for (let index = 0; index < size / 2 ** (round + 1); index++) {
      const bye = round === 0 && index >= count - size / 2;
      const slot = source => source?.winnerId ? { playerId: source.winnerId } : null;
      const a = round === 0 ? { playerId: 'p' + playerIndex++ } : slot(previous[index * 2]);
      const b = round === 0 ? (bye ? null : { playerId: 'p' + playerIndex++ }) : slot(previous[index * 2 + 1]);
      state.matches.push({
        id: 'm' + round + '_' + index, bracket: 'SE', round, indexInRound: index,
        seq: state.matches.length, a, b, isBye: bye, completed: completed || bye,
        winnerId: completed || bye ? a?.playerId || null : null,
        scoreA: completed && !bye ? 4 : 0, scoreB: 0, station: 1 + index % 12,
        status: completed || bye ? 'completed' : 'pending'
      });
    }
  }
  if (bronze) {
    state.bronzeMatchId = 'bronze';
    state.matches.push({ id: 'bronze', bracket: 'BRONZE', round: total - 1, indexInRound: 0, seq: state.matches.length,
      a: { playerId: 'p3' }, b: { playerId: 'p4' }, completed, winnerId: completed ? 'p3' : null,
      scoreA: completed ? 4 : 0, scoreB: 0, station: 1, status: completed ? 'completed' : 'pending' });
  }
  return state;
}

const scaffold = `
  let state, bracketViewMode='board', singleBracketLayoutMode='full';
  let singleBracketPathSelection=null;
  let boardZoom=1, boardPanX=0, boardPanY=0, boardTheme='gold', boardExportBusy=false;
  let boardModeInteractionCleanup=null, __bxhBoardTransformFrame=0, __seRelayoutQueued=false;
  let boardExpanded=false, boardFullscreenFallback=false, boardExpandedRoom=null, boardBodyOverflow=null, boardFullscreenBusy=false;
  ${stageGlobals.join('\n')}
  const BOARD_THEMES={gold:{label:'金色'}}, FORMAT_LABELS={single:'單敗淘汰'};
  const LOGO_SRC='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const BOARD_ICON_EXPORT='', BOARD_ICON_SHUFFLE='', BOARD_ICON_MINUS='−', BOARD_ICON_PLUS='+';
  const BOARD_ICON_FULLSCREEN='', SHARE_ICON_SVG='';
  window.BXHFormatUtils={matchSequenceLabel:n=>n==null?'':'第 '+n+' 場'};
  window.__warnings=[]; console.warn=(...args)=>window.__warnings.push(args.map(String).join(' '));
  window.__listeners={mousemove:new Set(),mouseup:new Set(),blur:new Set()};
  window.__trackBoardListeners=false;
  const nativeAdd=window.addEventListener.bind(window),nativeRemove=window.removeEventListener.bind(window);
  window.addEventListener=(type,handler,options)=>{if(window.__trackBoardListeners)window.__listeners[type]?.add(handler);nativeAdd(type,handler,options)};
  window.removeEventListener=(type,handler,options)=>{window.__listeners[type]?.delete(handler);nativeRemove(type,handler,options)};
  function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')}
  function playerName(id){return state.players.find(p=>p.id===id)?.name||'待定'}
  function playerBracketRowHtml(id,name){return '<span class="player-line"><span class="seed-num">'+esc(id?.slice(1)||'–')+'</span><span class="nm">'+esc(name||playerName(id))+'</span></span>'}
  function matchStatusClass(m){return m.completed?'ms-card-completed':'ms-card-pending'}
  function courtSwapMatchClass(){return ''} function activeMatchCourtAtmosphereStyle(){return ''}
  function quickModeTagHtml(){return ''} function courtSwapMatchBadge(){return ''}
  function matchScoreCellHtml(m,side){return m['score'+side]||0}
  function matchStatusBarHtml(m){return '<div class="match-status-bar">'+(m.completed?'已完成':'等待中')+'</div>'}
  function matchBoxHtml(m,label){return seMatchBoxHtml(m,m.round,m.indexInRound,label)}
  function matchLabel(m){return singleRoundTitle(m.round)}
  function eventTitleBar(){return ''} function wrapBracketWatermark(html){return html}
  function trophySvg(){return ''} function matchLegendHtml(){return ''}
  function bracketCommitStatusHtml(){return ''} function isAdminTierOrAbove(){return false}
  function tournamentStatus(){return state.championId?'done':'waiting'}
  function showToast(){} function bindCompletedMatchCorrectionLongPress(){} function bindManualCourtAssignLongPress(){}
  function openModal(value){window.__pathModal=value}
  function saveBoardThemePreference(){} function render(){throw Error('stage switch unexpectedly replaced the app shell')}
  async function ensureHtml2Canvas(){}
  function downloadBoardPng(blob,filename){window.__download={filename,type:blob.type}}
  window.html2canvas=async(shell,options)=>{
    const copy=document.cloneNode(true);options.onclone(copy);
    window.__exportCopy={
      controlsHidden:copy.querySelector('.board-stage-switch').style.display==='none',
      summary:copy.getElementById('board-stage-summary').textContent,
      rounds:[...copy.querySelectorAll('#board-canvas .se-col')].map(col=>Number(col.dataset.round))
    };
    return {toBlob:callback=>callback(new Blob(['test-png'],{type:'image/png'}))};
  };
  ${functions}
  // Playwright adds mouse listeners of its own when clicking. Count only handlers
  // installed by the real board binding function; all real removals still apply.
  const productionBindBoardModeInteractions=bindBoardModeInteractions;
  bindBoardModeInteractions=function(){
    window.__trackBoardListeners=true;
    try{return productionBindBoardModeInteractions()}
    finally{window.__trackBoardListeners=false}
  };
  window.mount=(next)=>{
    clearBoardModeInteractions();state=next;
    boardZoom=1;boardPanX=boardPanY=0;
    document.getElementById('app').innerHTML=renderBoardMode();
    bindBoardModeInteractions();layoutSingleElimBracket();
    window.__originalState=JSON.stringify(state);
    window.__originalNodes={shell:document.getElementById('board-shell'),viewport:document.getElementById('board-viewport'),canvas:document.getElementById('board-canvas')};
  };
  document.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');
    if(!button||button.disabled)return;
    if(button.dataset.action==='set-board-stage')setBoardStage(Number(button.dataset.stage));
    if(button.dataset.action==='board-fullscreen')void toggleBoardFullscreen();
    if(button.dataset.action==='single-player-path')selectSingleBracketPlayerPath(button.dataset.playerId);
  });
`;

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function capture(page, filename) {
  if (!process.env.BXH_STAGE_QA_DIR) return;
  fs.mkdirSync(process.env.BXH_STAGE_QA_DIR, {recursive:true});
  await page.screenshot({path:path.join(process.env.BXH_STAGE_QA_DIR, filename)});
}

async function snapshot(page) {
  return page.evaluate(() => {
    const columns = [...document.querySelectorAll('#board-canvas .se-col[data-round]')];
    const violations = [];
    for (const col of columns) {
      const boxes = [...col.querySelectorAll('.match-box:not(.bye-placeholder)')];
      let bottom = col.querySelector('.se-col-title').getBoundingClientRect().bottom;
      for (const box of boxes) {
        const rect = box.getBoundingClientRect();
        if (rect.top + 1 < bottom) violations.push('overlap at ' + box.dataset.id);
        if (!(rect.height > 0 && rect.width > 0)) violations.push('empty card ' + box.dataset.id);
        bottom = rect.bottom;
        const match = getMatch(box.dataset.id);
        if (Number(box.dataset.matchNumber) !== displayMatchNumber(match)) violations.push('renumbered ' + box.dataset.id);
      }
    }
    const paths = [...document.querySelectorAll('#se-bracket-svg path')];
    if (paths.some(path => /NaN|undefined|Infinity/.test(path.getAttribute('d')) || path.getTotalLength() <= 0)) violations.push('invalid connector');
    for(const path of paths){
      const source=document.querySelector('.match-box[data-id="'+path.dataset.sourceMatch+'"]');
      const target=document.querySelector('.match-box[data-id="'+path.dataset.targetMatch+'"]');
      if(!source||!target){violations.push('missing route card');continue;}
      const sourceRect=source.getBoundingClientRect(),targetRect=target.getBoundingClientRect();
      const row=target.querySelector('.mb-row[data-side="'+path.dataset.targetSide+'"]');
      const rowRect=row.getBoundingClientRect();
      const matrix=path.getScreenCTM();
      const start=path.getPointAtLength(0).matrixTransform(matrix);
      const end=path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      if(Math.abs(start.x-sourceRect.right)>1||Math.abs(start.y-sourceRect.top-sourceRect.height/2)>1)violations.push('detached source '+path.dataset.sourceMatch);
      if(Math.abs(end.x-targetRect.left)>1||Math.abs(end.y-rowRect.top-rowRect.height/2)>1)violations.push('detached target '+path.dataset.targetMatch);
      const from=getMatch(path.dataset.sourceMatch),to=getMatch(path.dataset.targetMatch);
      const advanced=!!(from.completed&&from.winnerId===(path.dataset.targetSide==='A'?to.a:to.b)?.playerId&&from.winnerId);
      if(path.classList.contains('se-path-advanced')!==advanced)violations.push('unconfirmed winner route');
    }
    return {
      rounds: columns.map(col => Number(col.dataset.round)),
      count: columns.reduce((n,col)=>n+col.querySelectorAll('.match-box').length,0),
      realCount: columns.reduce((n,col)=>n+col.querySelectorAll('.match-box:not(.bye-placeholder)').length,0),
      selected: selectedBoardStage(), summary: document.getElementById('board-stage-summary')?.textContent,
      active: [...document.querySelectorAll('.board-stage-btn[aria-pressed="true"]')].map(el => Number(el.dataset.stage)),
      exportText: document.querySelector('[data-action="board-export-image"]').textContent,
      sameState: JSON.stringify(state) === window.__originalState,
      sameNodes: Object.entries(window.__originalNodes).every(([name,node]) => node === document.getElementById({shell:'board-shell',viewport:'board-viewport',canvas:'board-canvas'}[name])),
      transform: [boardZoom,boardPanX,boardPanY], listeners: Object.values(window.__listeners).map(set => set.size),
      pathCount: paths.length, violations, warnings: window.__warnings,
      bronze: !!document.querySelector('.se-bronze-match'), champion: !!document.querySelector('.se-finals-champion-card')
    };
  });
}

async function selectAndCheck(page, size, bracketSize) {
  await page.locator('.board-stage-switch [data-stage="'+size+'"]').click();
  await settle(page);
  const result = await snapshot(page);
  const total = Math.log2(bracketSize), first = size ? total - Math.log2(size) : 0;
  assert.deepEqual(result.rounds, Array.from({length:total-first},(_,i)=>first+i));
  assert.equal(result.count, (size || bracketSize) - 1);
  assert.deepEqual(result.active, [size]);
  assert.equal(result.selected, size);
  assert.ok(result.exportText.includes(size ? size+'強起對戰表' : '完整對戰表'));
  assert.ok(result.sameState, 'display change mutated tournament state');
  assert.ok(result.sameNodes, 'display change replaced fullscreen shell/viewport/canvas');
  assert.deepEqual(result.transform, [1,0,0]);
  assert.deepEqual(result.listeners, [1,1,1], 'board listeners accumulated');
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.pathCount > 0, 'visible rounds have connectors');
  return result;
}

(async () => {
  const browser = await chromium.launch({headless:true});
  let passed = 0;
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors = [];page.on('pageerror',error=>errors.push(String(error)));
    await page.setContent('<style>:root{--font-d:Arial;--metal:#d9b95c;--panel-2:#111;--border:#555;--white:#fff}*{box-sizing:border-box}body{margin:8px;background:#111;color:white}'+css+'</style><main id="app"></main>');
    await page.addScriptTag({content:scaffold});

    for (const count of [128,320,34]) {
      const model = fixture(count);
      await page.evaluate(model=>mount(model),model);
      for (const stage of [128,64,32,16,0].filter(stage=>stage<=model.bracketSize)) {
        await page.evaluate(()=>{boardZoom=1.3;boardPanX=-500;boardPanY=-800;flushBoardTransform()});
        // A no-op selection intentionally preserves pan/zoom; force a different stage first.
        if (await page.evaluate(stage=>selectedBoardStage()===stage,stage)) {
          await page.evaluate(()=>setBoardStage(16));await settle(page);
          await page.evaluate(()=>{boardZoom=1.3;boardPanX=-500;boardPanY=-800;flushBoardTransform()});
        }
        await selectAndCheck(page,stage,model.bracketSize);
      }
      if(count===34){
        assert.equal(await page.locator('.board-stage-btn[data-stage="128"]').isDisabled(),true);
        const all=await snapshot(page);assert.equal(all.realCount,33,'BYE placeholders remain excluded');
      }
      console.log('PASS '+count+' entrants: stages, original match numbering, BYEs, connectors, pan reset and state isolation');passed++;
    }

    await page.evaluate(model=>mount(model),fixture(128,{completed:true,bronze:true}));
    const finals = await selectAndCheck(page,16,128);
    assert.ok(finals.bronze && finals.champion,'bronze and champion retained');
    const collisions = await page.evaluate(()=>{
      const card=document.querySelector('.se-finals-champion-card').getBoundingClientRect();
      return [...document.querySelectorAll('.se-final-stage-col .match-box,.se-bronze-match')].some(node=>{
        const box=node.getBoundingClientRect();return card.left<box.right&&card.right>box.left&&card.top<box.bottom&&card.bottom>box.top;
      });
    });
    assert.equal(collisions,false,'champion overlaps final or bronze');
    await page.locator('.se-player-path-button[data-player-id="p1"]').last().click();
    const selected=await page.evaluate(()=>{
      return {message:document.querySelector('.se-player-path-dialog p').textContent,history:singleBracketPlayerHistory('p1').length,
        paths:document.querySelectorAll('.se-player-path-selected').length,
        buttons:document.querySelectorAll('.se-player-path-button[aria-pressed="true"]').length,
        unchanged:JSON.stringify(state)===window.__originalState};
    });
    assert.equal(selected.history,7,'history must include rounds hidden by the 16-stage filter');
    assert.ok(selected.paths>0&&selected.buttons>0,'selected confirmed route is highlighted');
    assert.ok(selected.message.includes('128強')&&selected.message.includes('冠軍賽'));
    assert.equal(selected.unchanged,true,'path selection must not mutate tournament state');
    await capture(page,'desktop-player-path-dialog.png');
    await page.getByRole('button',{name:'返回樹狀圖',exact:true}).click();
    await page.evaluate(()=>selectSingleBracketPlayerPath('p1'));
    assert.equal(await page.locator('.se-player-path-selected').count(),0,'repeat selection clears route');
    await page.evaluate(()=>selectSingleBracketPlayerPath('p1'));
    await page.getByRole('button',{name:'返回樹狀圖',exact:true}).click();
    await capture(page,'desktop-128-completed-show16.png');
    console.log('PASS completed tournament retains bronze, champion and nonoverlapping final geometry');passed++;

    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:900});await page.evaluate(model=>mount(model),fixture(128));
      const fit=await page.evaluate(()=>{
        const group=document.querySelector('.board-stage-switch'),bounds=group.getBoundingClientRect();
        return {width:window.innerWidth,groupLeft:bounds.left,groupRight:bounds.right,scrollWidth:group.scrollWidth,clientWidth:group.clientWidth,
          buttons:[...group.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height}})};
      });
      assert.ok(fit.groupLeft>=0&&fit.groupRight<=width+1,JSON.stringify(fit));
      assert.ok(fit.scrollWidth<=fit.clientWidth+1,JSON.stringify(fit));
      assert.equal(fit.buttons.length,5);
      assert.ok(fit.buttons.every(b=>b.left>=fit.groupLeft-1&&b.right<=fit.groupRight+1&&b.height>=32),JSON.stringify(fit));
      await selectAndCheck(page,16,128);
      await capture(page,'mobile-'+width+'-show16.png');
    }
    console.log('PASS 320/390/430px: all five stage buttons fit and remain operable');passed++;

    await page.setViewportSize({width:1440,height:1000});await page.evaluate(model=>mount(model),fixture(128,{completed:true}));
    await page.locator('[data-action="board-fullscreen"]').click();
    await page.waitForFunction(()=>document.fullscreenElement===document.getElementById('board-shell'));
    await selectAndCheck(page,32,128);
    assert.equal(await page.evaluate(()=>document.fullscreenElement===window.__originalNodes.shell),true);
    await page.locator('.se-player-path-button[data-player-id="p1"]').last().click();
    assert.equal(await page.locator('.se-player-path-dialog').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.fullscreenElement===window.__originalNodes.shell),true,'opening path details exited fullscreen');
    await page.getByRole('button',{name:'返回樹狀圖',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.fullscreenElement===window.__originalNodes.shell),true,'closing path details exited fullscreen');
    await capture(page,'native-fullscreen-show32.png');
    await page.evaluate(()=>document.exitFullscreen());
    console.log('PASS native fullscreen survives stage change with the same shell');passed++;

    const untouched = await page.evaluate(()=>{
      const parse=html=>new DOMParser().parseFromString(html,'text/html');
      const print=parse(renderPrintBracket()),list=parse(renderTournamentMatchList()),standard=parse(renderSingleElimBracket(false));
      return {print:print.querySelectorAll('.se-col').length,list:list.querySelectorAll('.compact-round').length,
        standard:standard.querySelectorAll('.se-col').length,selected:selectedBoardStage()};
    });
    assert.deepEqual(untouched,{print:7,list:7,standard:7,selected:32});
    const redraw = await page.evaluate(()=>{document.getElementById('board-canvas').innerHTML=renderSingleElimBracket(true);layoutSingleElimBracket();return selectedBoardStage()});
    assert.equal(redraw,32,'live redraw retains scope');
    console.log('PASS list/print/standard views retain all rounds; live board rerender retains selected scope');passed++;

    const imageScope=await page.evaluate(async()=>{
      boardExportBusy=true;setBoardStage(64);const guarded=selectedBoardStage();boardExportBusy=false;
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});
      await exportBoardAsImage();
      return {guarded,filename:window.__download?.filename,copy:window.__exportCopy,busy:boardExportBusy,warnings:window.__warnings};
    });
    assert.equal(imageScope.guarded,32,'active export must keep its selected scope');
    assert.ok(imageScope.filename.endsWith('_32強起對戰表.png'));
    assert.ok(imageScope.copy.controlsHidden);
    assert.ok(imageScope.copy.summary.includes('32 強至決賽'));
    assert.deepEqual(imageScope.copy.rounds,[2,3,4,5,6]);
    assert.equal(imageScope.busy,false);assert.deepEqual(imageScope.warnings,[]);
    console.log('PASS image export uses chosen scope in filename and caption, hides controls and guards scope during export');passed++;

    await page.evaluate(model=>mount(model),fixture(16,{code:'BXH-NEXT'}));
    assert.equal(await page.locator('.se-player-path-selected').count(),0,'player path must not leak into another room');
    assert.equal(await page.locator('.se-player-path-button[aria-pressed="true"]').count(),0);
    assert.equal(await page.evaluate(()=>selectedBoardStage()),0);
    assert.equal(await page.locator('.board-stage-btn[data-stage="128"]').isDisabled(),true);
    assert.equal(await page.locator('.board-stage-btn[data-stage="64"]').isDisabled(),true);
    assert.equal(await page.locator('.board-stage-btn[data-stage="32"]').isDisabled(),true);
    const excluded = await page.evaluate(()=>{
      state.meta.formatType='double';const double=renderBoardStageSwitch();
      state.meta.formatType='roundrobin';const roundrobin=renderBoardStageSwitch();
      state.meta.formatType='single';state.meta.battleMode='team';const team=renderBoardStageSwitch();
      return {double,roundrobin,team};
    });
    assert.deepEqual(excluded,{double:'',roundrobin:'',team:''});
    assert.deepEqual(errors,[]);
    console.log('PASS room/format changes reset scope and do not expose invalid stage controls');passed++;
    console.log('PASS '+passed+' focused bracket-stage browser groups');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});

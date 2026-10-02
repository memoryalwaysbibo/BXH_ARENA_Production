(function(){
// Core Phase 2A — Tournament Operations feature module.
// Owns raffle/maintenance feature state, rendering, backend actions, and its input bindings.
// External app services/state are intentionally consumed through the existing global runtime contract.

/* v13.29.10: tournament operations; all mutations are authorized by callable backend. */
function tournamentOpsDefaultPrize(){return {name:'',description:'',quantity:1};}
function tournamentOpsDefaultDraft(){return {mode:'general',excludePrevious:true,prizes:[tournamentOpsDefaultPrize()]};}
function operationsDraftPrizes(d){if(!Array.isArray(d.prizes)||!d.prizes.length){d.prizes=[{name:String(d.title||''),description:String(d.description||''),quantity:Math.max(1,Math.min(100,Number(d.count)||1))}];}return d.prizes;}
function operationsPrizeTotal(d){return operationsDraftPrizes(d).reduce((sum,p)=>sum+(Number.isInteger(Number(p.quantity))?Number(p.quantity):0),0);}
let tournamentOps={key:'',data:null,error:'',busy:false,preview:null,draft:tournamentOpsDefaultDraft()};
function operationsKey(code=state.cloudCode){return [currentAuthUid(),engagementSessionEpoch,currentRole,state.cloudCode||'',code||''].join(':');}
function operationsContext(){const key=operationsKey();if(tournamentOps.key!==key)tournamentOps={key,data:null,error:'',busy:false,preview:null,draft:tournamentOpsDefaultDraft()};operationsDraftPrizes(tournamentOps.draft);return tournamentOps;}
function operationsPendingKey(code){return 'bxh-raffle-pending:'+currentAuthUid()+':'+code;}
function readOperationsPending(code){try{return JSON.parse(sessionStorage.getItem(operationsPendingKey(code))||'null');}catch(e){return null;}}

function renderSystemClosureNotice(st){
 const info=st&&st.systemClosure;if(!info)return '';
 const closed=!info.restoredAt;
 return `<div class="panel"><div class="panel-title">${closed?'比賽結束（系統關閉）':'賽事已恢復'}</div><div class="hint">原因：連續 24 小時無有效操作。最後操作：${esc(operationsDate(info.lastActivityAt))}｜系統關閉：${esc(operationsDate(info.closedAt))}${info.restoredAt?'｜恢復：'+esc(operationsDate(info.restoredAt)):''}</div>${closed&&isSuperAdmin()&&st.cloudCode?`<button class="btn btn-primary" data-action="ops-restore" data-code="${esc(st.cloudCode)}">恢復賽事</button>`:closed?'<div class="hint">僅最高管理員可以恢復賽事。</div>':''}</div>`;
}
function renderOperationsPrizeDrafts(d,disabled){
 const prizes=operationsDraftPrizes(d),total=operationsPrizeTotal(d),disableAttr=disabled?'disabled':'';
 return `${prizes.map((p,i)=>`<div class="panel" style="margin:10px 0;background:rgba(255,255,255,.018)">
  <div class="panel-title"><span>品項 ${i+1}</span>${prizes.length>1?`<button class="btn btn-danger btn-sm" data-action="ops-prize-remove" data-index="${i}" ${disableAttr}>刪除品項</button>`:''}</div>
  <div class="grid grid-2">
   <div class="field"><label>獎項名稱／獎品</label><input data-ops-prize="${i}" data-ops-prize-key="name" maxlength="120" value="${esc(p.name||'')}" ${disableAttr}></div>
   <div class="field"><label>獎品內容</label><input data-ops-prize="${i}" data-ops-prize-key="description" maxlength="500" value="${esc(p.description||'')}" ${disableAttr}></div>
   <div class="field"><label>中獎人數</label><div class="btn-row" style="display:grid;grid-template-columns:44px minmax(64px,1fr) 44px;gap:8px">
    <button class="btn btn-ghost" type="button" data-action="ops-prize-dec" data-index="${i}" aria-label="品項 ${i+1} 減少中獎人數" ${disableAttr}>−</button>
    <input data-ops-prize="${i}" data-ops-prize-key="quantity" type="number" inputmode="numeric" min="1" max="100" value="${Number(p.quantity)||1}" style="text-align:center;font-weight:800" ${disableAttr}>
    <button class="btn btn-ghost" type="button" data-action="ops-prize-inc" data-index="${i}" aria-label="品項 ${i+1} 增加中獎人數" ${disableAttr}>＋</button>
   </div></div>
  </div>
 </div>`).join('')}
 <div class="btn-row"><button class="btn btn-ghost" type="button" data-action="ops-prize-add" ${disabled||prizes.length>=20?'disabled':''}>＋ 新增品項</button><span class="hint">目前 ${prizes.length} 個品項｜共抽 ${total} 人${total>100?'｜最多 100 人':''}</span></div>`;
}
function operationsRecordPrizes(r){
 if(Array.isArray(r?.prizes)&&r.prizes.length)return r.prizes.map(p=>({name:String(p.name||'獎品'),description:String(p.description||''),quantity:Number(p.quantity)||1}));
 return [{name:String(r?.title||'獎品'),description:String(r?.description||''),quantity:Number(r?.count)||Math.max(1,(r?.winners||[]).length)}];
}
function renderOperationsWinner(w,r,statuses,locked){
 return `<div class="ops-winner"><b>${esc(w.name)}</b><span>${statuses[w.status]||esc(w.status)}</span><div class="btn-row">${w.status==='pending'?`<button class="btn btn-ghost btn-sm" data-action="ops-claim" data-raffle="${esc(r.id)}" data-winner="${esc(w.key)}" ${locked?'disabled':''}>登記領獎</button><button class="btn btn-danger btn-sm" data-action="ops-forfeit" data-raffle="${esc(r.id)}" data-winner="${esc(w.key)}" ${locked?'disabled':''}>棄領</button>`:w.status==='forfeited'?`<button class="btn btn-ghost btn-sm" data-action="ops-replace" data-raffle="${esc(r.id)}" data-winner="${esc(w.key)}" ${locked?'disabled':''}>補抽一人</button>`:''}</div></div>`;
}
function renderTournamentRaffleRecord(r,modes,statuses,locked){
 const prizes=operationsRecordPrizes(r),winners=Array.isArray(r.winners)?r.winners:[];
 return `<div class="panel"><div class="panel-title">${prizes.length>1?'多品項抽獎':esc(prizes[0].name)}${r.testMode?'（測試）':''}</div><p class="hint">${esc(modes[r.mode]||r.mode)}｜${esc(operationsDate(r.createdAt))}｜${prizes.length} 品項｜共抽出 ${r.count} 人</p>
 ${prizes.map((p,i)=>{const rows=winners.filter(w=>Number.isInteger(w.prizeIndex)?w.prizeIndex===i:i===0);return `<div class="panel" style="margin:10px 0;background:rgba(255,255,255,.018)"><div class="panel-title">品項 ${i+1}｜${esc(p.name)} × ${p.quantity}</div>${p.description?`<p>${esc(p.description)}</p>`:''}${rows.map(w=>renderOperationsWinner(w,r,statuses,locked)).join('')||'<p class="hint">尚無得獎者</p>'}</div>`;}).join('')}</div>`;
}
function renderTournamentOperationsPage(){
 if(!hasAdminAccess())return '<div class="empty-state">目前身分沒有操作權限。</div>';
 if(!state.cloudCode)return '<div class="panel">請先建立或開啟雲端賽事，再設定抽獎。</div>';
 const o=operationsContext(),d=o.draft,prizes=operationsDraftPrizes(d),pending=readOperationsPending(state.cloudCode),locked=o.busy||o.data?.systemClosed===true;
 const modes={general:'一般抽獎',first_round:'一輪遊抽獎'},statuses={pending:'待領獎',claimed:'已領獎',forfeited:'已棄領',replaced:'已補抽'};
 return `<div class="panel"><div class="panel-title">抽獎與賽事維護</div><p class="hint">${esc(state.meta.name)}｜一般抽獎限本場已報到者；一輪遊限單淘汰第一輪實際淘汰者。僅抽獎品，不變更參賽名單。</p><button class="btn btn-ghost" data-action="ops-load" ${o.busy?'disabled':''}>${o.busy?'處理中…':'載入／重新整理'}</button>${o.error?`<p class="auth-error">${esc(o.error)}</p>`:''}
 ${o.data?`<p class="hint">呆滯賽事自動關閉：${o.data.enabled?'已啟用':'未啟用'}。連續 24 小時無操作才符合條件，實際於後端巡查時關閉；首次觀察與重新啟用均保留 24 小時。</p>${isSuperAdmin()?`<button class="btn btn-ghost" data-action="ops-toggle" ${o.busy?'disabled':''}>${o.data.enabled?'停用':'啟用'}呆滯偵測（全站）</button>`:''}`:'<p class="hint">請先載入設定。若服務尚未更新，會顯示錯誤並保留其他賽事功能。</p>'}</div>
 <div class="panel"><div class="panel-title">系統診斷</div><p class="hint">低頻維護工具集中於此。正常操作時只需看頁首 BXH LIVE LINK；若遇到同步異常，再使用下方測試。</p><div class="btn-row"><button class="btn btn-ghost" data-action="cloud-test-connection" ${cloudTestBusy?'disabled':''}>${cloudTestBusy?'測試中……':'測試雲端連線'}</button>${cloudStatus==="error"?'<button class="btn btn-ghost" data-action="cloud-retry-connect">重試連線</button>':''}</div></div>
 <div class="panel"><div class="panel-title">獎品抽獎</div><p class="hint">可一次新增多個獎品品項；每個品項可設定自己的中獎人數。同一次抽獎不重複得獎。</p>${renderOperationsPrizeDrafts(d,locked||!!pending)}<div class="grid grid-2"><div class="field"><label for="ops-mode">抽獎資格</label><select id="ops-mode" ${locked||pending?'disabled':''}><option value="general" ${d.mode==='general'?'selected':''}>一般抽獎：本場已報到</option><option value="first_round" ${d.mode==='first_round'?'selected':''}>一輪遊：單淘汰第一輪淘汰</option></select></div><label><input id="ops-exclude" type="checkbox" ${d.excludePrevious?'checked':''} ${locked||pending?'disabled':''}>排除本場已中獎者</label></div><div class="btn-row"><button class="btn btn-ghost" data-action="ops-preview" ${locked||pending?'disabled':''}>預覽候選名單</button><button class="btn btn-primary" data-action="ops-draw" ${locked||pending||!o.preview?'disabled':''}>確認抽獎</button>${pending?`<button class="btn btn-primary" data-action="ops-retry" ${o.busy?'disabled':''}>確認／重試上次抽獎</button>`:''}</div>${pending?'<p class="hint">上次抽獎尚未確認結果，請使用同一次請求確認，避免重複抽出。</p>':''}${o.preview?`<p>符合資格：${o.preview.count} 人｜本次設定共抽 ${operationsPrizeTotal(d)} 人</p><details><summary>查看候選名單</summary><p>${o.preview.candidates.map(x=>esc(x.name)).join('、')||'無'}</p></details>`:''}</div>
 ${(o.data?.raffles||[]).map(r=>renderTournamentRaffleRecord(r,modes,statuses,locked)).join('')}
 ${o.data?`<div class="panel"><details><summary>操作紀錄（最近 30 筆）</summary>${o.data.logs.map(x=>`<p class="hint">${esc(operationsDate(x.at))}｜${esc(({'system-close':'系統關閉',restore:'恢復賽事','raffle-draw':'抽獎','raffle-winner':'領獎／棄領／補抽'})[x.type]||x.type)}｜${esc(x.reason||x.title||'')}</p>`).join('')||'<p>尚無操作紀錄</p>'}</details></div>`:''}`;
}
function operationsError(e){const msg=String(e?.message||'');const messages={'first-round-not-complete':'第一輪尚未全部完成，暫時不能抽一輪遊獎項。','first-round-single-only':'一輪遊目前僅支援單淘汰賽。','not-enough-candidates':'符合資格人數不足，請調整人數或資格。','invalid-winner-count':'中獎人數請填 1～100 的整數。','invalid-prizes':'請確認每個獎品品項都有名稱，且中獎人數為 1～100。','too-many-winners':'同一次抽獎合計最多 100 位得獎者。','system-closed':'此賽事已由系統關閉，需由最高管理員恢復。','tournament-access-denied':'目前帳號沒有管理此場賽事的權限。','super-admin-required':'只有最高管理員可以操作。','winner-already-handled':'此人已完成領獎或棄領處理，請重新整理。','candidate-list-changed':'候選名單已改變，請重新預覽後抽獎。','pending-storage-unavailable':'此瀏覽器無法保存抽獎請求，請更換瀏覽器後再試。'};for(const [k,v]of Object.entries(messages))if(msg.includes(k))return v;return '操作未確認完成，請重新整理或重試；若服務尚未部署，請先完成 13.29.8 後端更新。';}
async function handleTournamentOperationsAction(action,target){
 if(!hasAdminAccess())return;
 const o=operationsContext();if(o.busy)return;
 const code=target.getAttribute('data-code')||state.cloudCode;if(!code){showToast('請先開啟雲端賽事',true);return;}
 const key=operationsKey(code),service=window.engagementService;let method='getTournamentOperations',payload={code};
 try{
  if(action==='ops-toggle'){if(!isSuperAdmin()||!o.data)return;if(!confirm((o.data.enabled?'停用':'啟用')+'全站呆滯偵測？啟用後首次觀察保留 24 小時，僅最高管理員可恢復系統關閉的賽事。'))return;method='setTournamentOperations';payload={enabled:!o.data.enabled};}
  else if(action==='ops-restore'){if(!isSuperAdmin())return;const reason=prompt('請填寫恢復賽事原因（至少兩字）');if(!reason||reason.trim().length<2)return;method='restoreIdleTournament';payload={code,reason};}
  else if(action==='ops-prize-add'){if(readOperationsPending(code)||o.data?.systemClosed)return;const prizes=operationsDraftPrizes(o.draft);if(prizes.length>=20){showToast('單次抽獎最多 20 個品項',true);return;}prizes.push(tournamentOpsDefaultPrize());render();return;}
  else if(action==='ops-prize-remove'){if(readOperationsPending(code)||o.data?.systemClosed)return;const prizes=operationsDraftPrizes(o.draft),i=Number(target.getAttribute('data-index'));if(prizes.length<=1||!Number.isInteger(i)||!prizes[i])return;prizes.splice(i,1);render();return;}
  else if(action==='ops-prize-inc'||action==='ops-prize-dec'){if(readOperationsPending(code)||o.data?.systemClosed)return;const prizes=operationsDraftPrizes(o.draft),i=Number(target.getAttribute('data-index'));if(!Number.isInteger(i)||!prizes[i])return;const current=Math.max(1,Math.min(100,Number(prizes[i].quantity)||1)),delta=action==='ops-prize-inc'?1:-1;prizes[i].quantity=Math.max(1,Math.min(100,current+delta));render();return;}
  else if(action==='ops-preview'){method='previewTournamentRaffle';payload={code,mode:o.draft.mode,excludePrevious:o.draft.excludePrevious};}
  else if(action==='ops-draw'||action==='ops-retry'){
   method='drawTournamentRaffle';payload=readOperationsPending(code);
   if(!payload){if(action==='ops-retry')return;const prizes=operationsDraftPrizes(o.draft).map(p=>({name:String(p.name||'').trim(),description:String(p.description||'').trim(),quantity:Number(p.quantity)})),total=prizes.reduce((sum,p)=>sum+(Number.isInteger(p.quantity)?p.quantity:0),0);if(!o.preview||prizes.some(p=>!p.name||!Number.isInteger(p.quantity)||p.quantity<1||p.quantity>100)){showToast('請完成所有獎品品項並預覽候選名單',true);return;}if(total>100){showToast('同一次抽獎合計最多 100 位得獎者',true);return;}if(total>o.preview.count){showToast(`符合資格只有 ${o.preview.count} 人，本次共設定 ${total} 位得獎者`,true);return;}const summary=prizes.map((p,i)=>`${i+1}. ${p.name} × ${p.quantity}`).join('\n');if(!confirm(`從 ${o.preview.count} 人中抽 ${prizes.length} 個品項，共 ${total} 位得獎者？\n\n${summary}`))return;payload={code,mode:o.draft.mode,excludePrevious:o.draft.excludePrevious,prizes,operationId:crypto.randomUUID(),candidateHash:o.preview.candidateHash};try{sessionStorage.setItem(operationsPendingKey(code),JSON.stringify(payload));}catch(e){throw Error('pending-storage-unavailable');}}
  }else if(['ops-claim','ops-forfeit','ops-replace'].includes(action)){
   const a=action.slice(4),reason=a==='claim'?'':prompt(a==='forfeit'?'請填寫棄領原因':'請填寫補抽原因');if(a!=='claim'&&(!reason||reason.trim().length<2))return;if(a==='claim'&&!confirm('確認此玩家已領取獎品？'))return;
   method='updateTournamentRaffleWinner';payload={code,raffleId:target.getAttribute('data-raffle'),winnerKey:target.getAttribute('data-winner'),action:a,reason,operationId:crypto.randomUUID()};
  }
  o.busy=true;o.error='';render();if(!service?.tournamentOperation)throw Error('service-unavailable');
  const result=await service.tournamentOperation(method,payload);if(key!==operationsKey(code))return;if(!result?.ok)throw Error('operation-failed');
  if(method==='previewTournamentRaffle'){o.preview=result;return;}
  if(method==='drawTournamentRaffle'){sessionStorage.removeItem(operationsPendingKey(code));o.preview=null;}
  if(method==='restoreIdleTournament'){const fresh=await window.cloudSync.joinRoom(code);if(key!==operationsKey(code))return;if(fresh?.ok){if(state.cloudCode===code)applyRemoteState(fresh.data,true);if(viewingRecordData?.cloudCode===code)viewingRecordData=fresh.data;}showToast('賽事已恢復，重新起算 24 小時。');}
  o.data=method==='getTournamentOperations'?result:await service.tournamentOperation('getTournamentOperations',{code});
  const pending=readOperationsPending(code);if(pending&&o.data.raffles?.some(r=>r.id===pending.operationId))sessionStorage.removeItem(operationsPendingKey(code));
 }catch(e){if(key===operationsKey(code)){o.error=operationsError(e);if(String(e?.message||'').includes('candidate-list-changed')){sessionStorage.removeItem(operationsPendingKey(code));o.preview=null;}}}
 finally{if(key===operationsKey(code)){o.busy=false;render();}}
}
document.addEventListener('input',event=>{
 const prizeIndex=event.target.getAttribute?.('data-ops-prize'),prizeKey=event.target.getAttribute?.('data-ops-prize-key'),o=operationsContext();
 if(prizeIndex!==null&&prizeIndex!==undefined&&prizeKey){
  const prizes=operationsDraftPrizes(o.draft),i=Number(prizeIndex);if(!Number.isInteger(i)||!prizes[i]||!['name','description','quantity'].includes(prizeKey))return;
  prizes[i][prizeKey]=prizeKey==='quantity'?Math.max(1,Math.min(100,Number(event.target.value)||1)):event.target.value;
  return;
 }
 const name=event.target.id;if(!['ops-mode','ops-exclude'].includes(name))return;
 o.draft[name==='ops-mode'?'mode':'excludePrevious']=name==='ops-exclude'?event.target.checked:event.target.value;
 o.preview=null;const b=document.querySelector('[data-action="ops-draw"]');if(b)b.disabled=true;
});

})();

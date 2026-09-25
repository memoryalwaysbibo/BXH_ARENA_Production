// Build-time source for the narrowly scoped index.html integration.
let aiCreateSuggestionReview = null;
function aiCreateSuggestionList(){
  const core=window.BxhAiReview;
  if(!aiCreateLastApplied||!core){aiCreateSuggestionReview=null;return [];}
  ensureSettingsFormDraft();ensureRegistrationFormDraft();
  const applied=aiCreateLastApplied,result=applied.result||aiCreateStructuredResult||{};
  const event=(result.events||[]).find(e=>e.key===applied.eventKey)||(result.events||[])[0]||{};
  const list=core.build(settingsFormDraft,registrationFormDraft,event,result.activity||{},result.warnings||[]);
  const fingerprint=core.signature(settingsFormDraft,registrationFormDraft),old=aiCreateSuggestionReview;
  if(!old||old.applied!==applied||old.room!==state||old.fingerprint!==fingerprint)aiCreateSuggestionSelection={};
  list.forEach(s=>{if(aiCreateSuggestionSelection[s.id]===undefined)aiCreateSuggestionSelection[s.id]=s.defaultSelected;});
  aiCreateSuggestionReview={room:state,uid:firebaseUser&&firebaseUser.uid,applied,fingerprint,list};return list;
}
function applySelectedAiCreateSuggestions(){
  const core=window.BxhAiReview,review=aiCreateSuggestionReview;if(!core||!review)return {ok:false,count:0,reason:'stale'};
  if(!aiCreateBetaActorAllowed()||review.room!==state||review.uid!==(firebaseUser&&firebaseUser.uid)||review.applied!==aiCreateLastApplied||aiCreateLastApplied.roomId!==state.id||aiCreateLastApplied.actorUid!==review.uid)return {ok:false,count:0,reason:'context'};
  if(state.cloudCode||state.meta?.publishedAt||state.startedAt||state.bracketSize||state.archiveStatus==='completed'||state.systemClosure&&!state.systemClosure.restoredAt||(state.players||[]).length||(state.matches||[]).some(m=>m&&(m.winnerId||m.completed||(m.log||[]).length)))return {ok:false,count:0,reason:'locked'};
  syncSettingsDraftFromDom();syncRegistrationDraftFromDom();
  const selected=review.list.filter(s=>aiCreateSuggestionSelection[s.id]===true).map(s=>s.id);
  const result=core.apply(settingsFormDraft,registrationFormDraft,{signature:review.fingerprint,list:review.list},selected);if(!result.ok)return result;
  settingsFormDraft=result.settings;registrationFormDraft=result.registration;
  settingsFormDraftDirty=true;registrationFormDraftDirty=true;aiCreateReviewAcknowledged=false;
  aiCreateSuggestionReview=null;aiCreateSuggestionSelection={};return {ok:true,count:result.count};
}
function aiCreateReviewFieldId(code){
  return {'name-missing':'f-name','date-missing':'f-date','location-missing':'f-venue-address','start-missing':'f-start','checkin-missing':'f-checkin','checkin-order-invalid':'f-checkin','registration-open-missing':'reg-open-at','registration-close-missing':'reg-close-at','registration-order-invalid':'reg-close-at','capacity-missing':'reg-capacity'}[code]||'';
}
function aiCreateFocusReviewField(code){
  const id=aiCreateReviewFieldId(code),el=id&&document.getElementById(id);
  const field=el&&(el.closest('.field')||el),target=field||document.getElementById('ai-create-review-panel');if(!target)return false;
  let node=target;while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}
  const focus=el&&el.type!=='hidden'?el:field&&field.querySelector('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])');
  target.style.scrollMarginTop='160px';target.scrollIntoView({behavior:'auto',block:'center'});
  if(focus){focus.setAttribute('aria-invalid','true');focus.focus({preventScroll:true});focus.addEventListener('input',()=>focus.removeAttribute('aria-invalid'),{once:true});focus.addEventListener('change',()=>focus.removeAttribute('aria-invalid'),{once:true});}return true;
}
function initAiDraftTimePicker(box,hidden,withDate){
  const hour=box.querySelector('.half-hour-hour'),minute=box.querySelector('.half-hour-minute'),date=withDate?box.querySelector('.half-hour-date'):null;if(!hour||!minute||(withDate&&!date))return;
  const options=n=>Array.from({length:n},(_,i)=>{const v=String(i).padStart(2,'0');return '<option value="'+v+'">'+v+'</option>';}).join('');
  hour.innerHTML='<option value="">--</option>'+options(24);minute.innerHTML=options(60);
  const raw=String(hidden.value||'').trim(),m=raw.match(withDate?/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/:/^([01]\d|2[0-3]):([0-5]\d)$/);
  hour.value=m?m[withDate?2:1]:'';minute.value=m?m[withDate?3:2]:'00';if(date)date.value=m?m[1]:'';
  const sync=()=>{hidden.value=hour.value!==''&&(!date||date.value)?(date?date.value+'T':'')+hour.value+':'+minute.value:'';hidden.dispatchEvent(new Event('input',{bubbles:true}));hidden.dispatchEvent(new Event('change',{bubbles:true}));};
  hour.addEventListener('change',sync);minute.addEventListener('change',sync);if(date)date.addEventListener('change',sync);box.dataset.ready='1';
}
function renderAiCreateSuggestionPanel(){
  if(!aiCreateLastApplied||!(settingsFormDraftDirty||registrationFormDraftDirty))return '';
  const suggestions=aiCreateSuggestionList(),core=window.BxhAiReview;if(!suggestions.length)return '';
  const count=suggestions.filter(s=>aiCreateSuggestionSelection[s.id]===true).length;
  const card=s=>`<label class="ai-create-suggestion-card"><input type="checkbox" data-action="ai-create-suggestion-toggle" data-suggestion-id="${esc(s.id)}" ${aiCreateSuggestionSelection[s.id]===true?'checked':''}><span><span class="ai-create-suggestion-title">${esc(s.title)} <span class="ai-create-suggestion-badge ${s.origin==='source'?'source':'recommended'}">${s.origin==='source'?'原文辨識':'系統建議・待確認'}</span></span><p>${esc(s.message)}</p>${s.changes.map(c=>`<div class="ai-create-suggestion-value">${esc(core.labels[c.field])}｜${esc(core.display(c.field,c.from))} → <b>${esc(core.display(c.field,c.to))}</b></div>`).join('')}</span></label>`;
  return `<div class="ai-create-suggestion-panel" id="ai-create-suggestion-panel"><div class="ai-create-suggestion-head"><div><strong>✨ AI 智慧修正建議</strong><span>請核對修改前後內容。推算建議不預先勾選；確認後只套入草稿，不儲存或發布賽事。</span></div><div class="ai-create-suggestion-count">${count} / ${suggestions.length}</div></div><div class="ai-create-suggestion-list">${suggestions.map(card).join('')}</div><div class="ai-create-suggestion-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="ai-create-suggestion-select-all">全部勾選</button><button type="button" class="btn btn-primary btn-sm" data-action="ai-create-suggestion-apply" ${count?'':'disabled'}>確認並套用 ${count} 項</button></div></div>`;
}
function aiCreateHalfHourCompatible(value){
  // Historical name retained. The four AI-backed draft controls preserve every valid minute.
  if(!value)return true;const v=String(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)||(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00)?\+08:00$/.test(v)&&Number.isFinite(Date.parse(v)));
}

/* HUNTER LOOP P4 | 7-DAY REWARD + REWARD RULES admin UI */
'use strict';

let rewardRulesAdminState=null;

const REWARD_TRIGGER_LABELS={
  daily_checkin:'每日簽到',
  title_granted:'取得稱號',
  tournament_completed:'賽事完成',
  match_completed:'對戰完成',
  ladder_updated:'天梯更新',
  activity_points_changed:'活躍積分更新',
  manual:'管理員手動',
};
const REWARD_CONDITION_LABELS={
  total_checkins:'累積簽到天數 ≥',
  checkin_streak:'連續簽到天數 ≥',
  checkin_streak_multiple:'連續簽到達 N 的倍數',
  has_title:'擁有指定稱號',
  participated_event:'參加指定賽事',
  completed_tournaments:'完成賽事數 ≥',
  matches_played:'對戰場數 ≥',
  wins:'勝場數 ≥',
  placement_at_most:'賽事名次 ≤',
  ladder_points:'天梯積分 ≥',
  ladder_rank_at_most:'天梯排名 ≤',
  activity_points:'活躍積分 ≥',
  manual_approval:'管理員確認',
};
const REWARD_DELIVERY_LABELS={auto:'自動發放',claim:'達成後領取',admin_confirm:'管理員確認後發放'};
const REWARD_REPEAT_LABELS={once:'每位玩家僅一次',per_source:'每個來源／里程碑一次'};

function defaultRewardRuleDraft(){
  return {
    ruleCode:'',
    name:'',
    trigger:'daily_checkin',
    logic:'and',
    deliveryMode:'auto',
    repeatMode:'once',
    monthlyMax:'',
    enabled:true,
    conditions:[{type:'checkin_streak',value:'7',ref:''}],
    reward:{itemCode:'',name:'',quantity:'1',imageUrl:'',purpose:'',source:'REWARD RULES 1.0',expiry:'',consumable:false},
  };
}
function rewardRulesAdminContext(){
  const key=currentAuthUid()+':'+engagementSessionEpoch;
  if(!rewardRulesAdminState||rewardRulesAdminState.key!==key){
    rewardRulesAdminState={
      key,rules:null,loading:false,busy:false,error:'',success:'',
      editing:false,selectedCode:'',draft:defaultRewardRuleDraft(),
    };
  }
  return rewardRulesAdminState;
}
async function rewardRulesApi(payload){
  if(window.engagementService&&typeof window.engagementService.rewardRules==='function'){
    return window.engagementService.rewardRules(payload);
  }
  if(typeof callEngagementFunction==='function'){
    return callEngagementFunction('rewardRulesService',payload,30000);
  }
  throw Error('reward-rules-unavailable');
}
function rewardRulesError(error){
  const msg=String(error?.message||error||'');
  const map={
    'super-admin-required':'只有最高管理員可以管理取得規則。',
    'rule-not-found':'找不到這條規則，請重新整理。',
    'rule-archived':'此規則已封存，不能再直接修改。',
    'invalid-rule-code':'規則代碼限小寫英文、數字、底線與連字號。',
    'invalid-rule-name':'請填寫規則名稱。',
    'invalid-trigger':'觸發事件設定不正確。',
    'invalid-logic':'條件邏輯設定不正確。',
    'invalid-delivery-mode':'發放方式設定不正確。',
    'invalid-repeat-mode':'重複發放設定不正確。',
    'invalid-monthly-max':'每月上限需為 1～1000；留空或 0 代表不限。',
    'invalid-conditions':'至少需要一個取得條件。',
    'invalid-condition-type':'取得條件類型不正確。',
    'invalid-condition-value':'條件數值需為大於 0 的整數。',
    'invalid-condition-ref':'請填寫指定稱號／賽事代碼。',
    'invalid-item-code':'道具代碼格式不正確。',
    'invalid-quantity':'道具數量需為大於 0 的整數。',
    'reward-rules-unavailable':'取得規則服務尚未連線。',
    'functions/not-found':'取得規則服務尚未完成部署。',
    'functions/unavailable':'取得規則服務暫時無法連線。',
  };
  for(const [key,value] of Object.entries(map))if(msg.includes(key))return value;
  return '取得規則操作失敗，請稍後再試。';
}
function rewardRuleExpiryLocal(value){
  if(value==null||value==='')return '';
  const ms=Number(value);
  if(!Number.isFinite(ms))return '';
  return new Date(ms+28800000).toISOString().slice(0,16);
}
function storedRuleToDraft(rule){
  return {
    ruleCode:String(rule.ruleCode||rule.id||''),
    name:String(rule.name||''),
    trigger:String(rule.trigger||'daily_checkin'),
    logic:rule.logic==='or'?'or':'and',
    deliveryMode:['auto','claim','admin_confirm'].includes(rule.deliveryMode)?rule.deliveryMode:'auto',
    repeatMode:rule.repeatMode==='per_source'?'per_source':'once',
    monthlyMax:rule.monthlyMax==null?'':String(rule.monthlyMax),
    enabled:rule.enabled===true,
    conditions:Array.isArray(rule.conditions)&&rule.conditions.length
      ?rule.conditions.map(c=>({type:String(c.type||'checkin_streak'),value:c.value==null?'':String(c.value),ref:c.ref==null?'':String(c.ref)}))
      :[{type:'checkin_streak',value:'7',ref:''}],
    reward:{
      itemCode:String(rule.reward?.itemCode||''),
      name:String(rule.reward?.name||''),
      quantity:String(rule.reward?.quantity||1),
      imageUrl:String(rule.reward?.imageUrl||''),
      purpose:String(rule.reward?.purpose||''),
      source:String(rule.reward?.source||'REWARD RULES 1.0'),
      expiry:rewardRuleExpiryLocal(rule.reward?.expiresAt),
      consumable:rule.reward?.consumable===true,
    },
  };
}
function rewardSelectOptions(map,current){
  return Object.entries(map).map(([value,label])=>`<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`).join('');
}
function rewardConditionSummary(condition){
  const label=REWARD_CONDITION_LABELS[condition.type]||condition.type||'未知條件';
  if(condition.type==='manual_approval')return label;
  if(['has_title','participated_event'].includes(condition.type))return label+'：'+String(condition.ref||'未設定');
  if(condition.type==='placement_at_most')return label+' '+Number(condition.value||0)+(condition.ref?'｜'+condition.ref:'');
  return label+' '+Number(condition.value||0);
}
function renderRewardConditionEditor(condition,index,locked){
  const type=condition.type||'checkin_streak';
  const needsValue=!['has_title','participated_event','manual_approval'].includes(type);
  const needsRef=['has_title','participated_event','placement_at_most'].includes(type);
  const refLabel=type==='has_title'?'稱號 ID':type==='participated_event'?'賽事代碼':'指定賽事代碼（選填）';
  return `<div class="panel" style="margin:8px 0;padding:12px">
    <div class="grid grid-2 inventory-grid">
      <div class="field"><label>條件類型</label><select data-reward-condition-index="${index}" data-reward-condition-field="type" ${locked?'disabled':''}>${rewardSelectOptions(REWARD_CONDITION_LABELS,type)}</select></div>
      ${needsValue?`<div class="field"><label>條件值</label><input type="number" min="1" step="1" value="${esc(condition.value||'')}" data-reward-condition-index="${index}" data-reward-condition-field="value" ${locked?'disabled':''}></div>`:''}
      ${needsRef?`<div class="field"><label>${esc(refLabel)}</label><input value="${esc(condition.ref||'')}" data-reward-condition-index="${index}" data-reward-condition-field="ref" placeholder="${type==='has_title'?'例如 pioneer':'例如 BXH-S3'}" ${locked?'disabled':''}></div>`:''}
    </div>
    <button class="btn btn-ghost btn-sm" data-action="inventory-rule-remove-condition" data-index="${index}" ${locked?'disabled':''}>移除此條件</button>
  </div>`;
}
function renderRewardRuleEditor(state){
  if(!state.editing)return '';
  const d=state.draft,locked=state.busy,editingExisting=!!state.selectedCode;
  const field=(key,label,extra='')=>`<div class="field"><label>${label}</label><input data-reward-rule-field="${key}" value="${esc(d[key]||'')}" ${extra} ${locked?'disabled':''}></div>`;
  const rewardField=(key,label,extra='')=>`<div class="field"><label>${label}</label><input data-reward-item-field="${key}" value="${esc(d.reward[key]||'')}" ${extra} ${locked?'disabled':''}></div>`;
  return `<section class="panel" style="margin-top:12px">
    <div class="panel-title"><span>${editingExisting?'編輯取得規則':'新增取得規則'}</span><button class="btn btn-ghost btn-sm" data-action="inventory-rule-cancel" ${locked?'disabled':''}>收起</button></div>
    <p class="hint">條件成立後依發放方式處理。AUTO 只由伺服器可信事件觸發；玩家端不能自行宣告達成。</p>
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" data-action="inventory-rule-template-weekly" ${locked?'disabled':''}>套用「每連續 7 天抽獎券」</button>
      <button class="btn btn-ghost btn-sm" data-action="inventory-rule-copy-draft" ${locked?'disabled':''}>帶入上方道具資料</button>
    </div>
    <div class="grid grid-2 inventory-grid">
      ${field('ruleCode','規則代碼',`maxlength="64" placeholder="例如 weekly-checkin-ticket" ${editingExisting?'disabled':''}`)}
      ${field('name','規則名稱','maxlength="80" placeholder="例如 每連續 7 天獲得抽獎券"')}
      <div class="field"><label>觸發事件</label><select data-reward-rule-field="trigger" ${locked?'disabled':''}>${rewardSelectOptions(REWARD_TRIGGER_LABELS,d.trigger)}</select></div>
      <div class="field"><label>條件邏輯</label><select data-reward-rule-field="logic" ${locked?'disabled':''}><option value="and" ${d.logic==='and'?'selected':''}>AND｜全部條件成立</option><option value="or" ${d.logic==='or'?'selected':''}>OR｜任一條件成立</option></select></div>
      <div class="field"><label>發放方式</label><select data-reward-rule-field="deliveryMode" ${locked?'disabled':''}>${rewardSelectOptions(REWARD_DELIVERY_LABELS,d.deliveryMode)}</select></div>
      <div class="field"><label>重複規則</label><select data-reward-rule-field="repeatMode" ${locked?'disabled':''}>${rewardSelectOptions(REWARD_REPEAT_LABELS,d.repeatMode)}</select></div>
      <div class="field"><label>每月發放上限</label><input data-reward-rule-field="monthlyMax" type="number" min="0" max="1000" step="1" value="${esc(d.monthlyMax||'')}" placeholder="0 或留空＝不限" ${locked?'disabled':''}></div>
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" data-reward-rule-field="enabled" ${d.enabled?'checked':''} ${locked?'disabled':''}>建立後立即啟用</label>
    <div class="panel-title" style="margin-top:10px">取得條件</div>
    <p class="hint">「連續簽到達 N 的倍數」可做 7、14、21…天里程碑；搭配「每個來源／里程碑一次」即可避免第 8、9 天重複發券。</p>
    ${d.conditions.map((condition,index)=>renderRewardConditionEditor(condition,index,locked)).join('')}
    <button class="btn btn-ghost btn-sm" data-action="inventory-rule-add-condition" ${locked||d.conditions.length>=12?'disabled':''}>＋ 新增條件</button>
    <div class="panel-title" style="margin-top:14px">達成後獎勵</div>
    <div class="grid grid-2 inventory-grid">
      ${rewardField('itemCode','道具代碼','maxlength="48" placeholder="例如 weekly-raffle-ticket"')}
      ${rewardField('name','道具名稱','maxlength="60" placeholder="例如 抽獎券"')}
      ${rewardField('quantity','數量','type="number" min="1" max="10000" step="1"')}
      ${rewardField('imageUrl','圖片網址（選填）','type="url" maxlength="2048" placeholder="https://…"')}
      ${rewardField('purpose','用途','maxlength="300"')}
      ${rewardField('source','來源','maxlength="120"')}
      ${rewardField('expiry','到期時間（台灣時間）','type="datetime-local"')}
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" data-reward-item-field="consumable" ${d.reward.consumable?'checked':''} ${locked?'disabled':''}>此道具可消耗使用（例如抽獎券）</label>
    <div class="btn-row">
      <button class="btn btn-primary" data-action="inventory-rule-save" ${locked?'disabled':''}>${locked?'儲存中……':'儲存取得規則'}</button>
      <button class="btn btn-ghost" data-action="inventory-rule-cancel" ${locked?'disabled':''}>取消</button>
    </div>
  </section>`;
}
async function loadRewardRulesAdmin(){
  if(!isSuperAdmin())return;
  const s=rewardRulesAdminContext();
  if(s.loading||s.busy)return;
  s.loading=true;s.error='';render();
  try{
    const r=await rewardRulesApi({action:'list'});
    if(s!==rewardRulesAdminContext())return;
    if(!r?.ok)throw Error('load-failed');
    s.rules=Array.isArray(r.items)?r.items:[];
  }catch(error){
    if(s===rewardRulesAdminContext())s.error=rewardRulesError(error);
  }finally{
    if(s===rewardRulesAdminContext()){s.loading=false;render();}
  }
}
function renderRewardRulesAdmin(){
  if(!isSuperAdmin())return '';
  const s=rewardRulesAdminContext();
  if(s.rules===null&&!s.loading&&!s.error)setTimeout(()=>loadRewardRulesAdmin(),0);
  const rules=s.rules||[];
  return `<section class="panel" style="margin-top:16px">
    <div class="panel-title"><span>⚙️ 道具取得規則 <span class="badge badge-metal">REWARD RULES 1.0</span></span><span class="btn-row"><button class="btn btn-ghost btn-sm" data-action="inventory-rule-refresh" ${s.loading||s.busy?'disabled':''}>重新整理</button><button class="btn btn-primary btn-sm" data-action="inventory-rule-new" ${s.busy?'disabled':''}>＋ 新增規則</button></span></div>
    <p class="hint">將「達成條件」與道具發放綁定。規則只由伺服器事件判定；封存後保留稽核紀錄，不直接刪除。</p>
    ${s.error?`<p class="auth-error" role="alert">${esc(s.error)}</p>`:''}
    ${s.success?`<p class="hint" role="status">${esc(s.success)}</p>`:''}
    ${s.loading?'<p role="status">正在讀取取得規則……</p>':''}
    ${!s.loading&&!rules.length?'<div class="empty-state">目前尚未建立取得規則。</div>':''}
    <div class="grid grid-2 inventory-grid">
      ${rules.map(rule=>`<article class="panel">
        <div class="panel-title"><span>${esc(rule.name||rule.ruleCode)}</span><span class="badge badge-metal">${rule.enabled?'啟用':'停用'}</span></div>
        <p class="hint">代碼：${esc(rule.ruleCode)}<br>觸發：${esc(REWARD_TRIGGER_LABELS[rule.trigger]||rule.trigger)}｜${esc(rule.logic==='or'?'OR':'AND')}｜${esc(REWARD_DELIVERY_LABELS[rule.deliveryMode]||rule.deliveryMode)}<br>重複：${esc(REWARD_REPEAT_LABELS[rule.repeatMode]||rule.repeatMode)}｜每月上限：${rule.monthlyMax==null?'不限':Number(rule.monthlyMax)}</p>
        <p class="mailbox-body">${(rule.conditions||[]).map(rewardConditionSummary).map(esc).join('<br>')}</p>
        <p><b>→ ${esc(rule.reward?.name||'未設定道具')} × ${Number(rule.reward?.quantity||0)}</b>${rule.reward?.consumable?' <span class="badge badge-metal">可消耗</span>':''}</p>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" data-action="inventory-rule-edit" data-rule-code="${esc(rule.ruleCode)}" ${s.busy?'disabled':''}>編輯</button>
          <button class="btn btn-ghost btn-sm" data-action="inventory-rule-toggle" data-rule-code="${esc(rule.ruleCode)}" data-enabled="${rule.enabled?'true':'false'}" ${s.busy?'disabled':''}>${rule.enabled?'停用':'啟用'}</button>
          <button class="btn btn-ghost btn-sm" data-action="inventory-rule-archive" data-rule-code="${esc(rule.ruleCode)}" ${s.busy?'disabled':''}>封存</button>
        </div>
      </article>`).join('')}
    </div>
    ${renderRewardRuleEditor(s)}
  </section>`;
}
function rewardRuleBuildPayload(draft){
  const ruleCode=String(draft.ruleCode||'').normalize('NFKC').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(ruleCode))throw Error('invalid-rule-code');
  if(!String(draft.name||'').trim())throw Error('invalid-rule-name');
  if(!Array.isArray(draft.conditions)||!draft.conditions.length)throw Error('invalid-conditions');
  const conditions=draft.conditions.map(condition=>{
    const type=condition.type;
    if(type==='manual_approval')return {type};
    if(type==='has_title'||type==='participated_event'){
      const ref=String(condition.ref||'').trim();
      if(!ref)throw Error('invalid-condition-ref');
      return {type,ref};
    }
    const value=Number(condition.value);
    if(!Number.isInteger(value)||value<1)throw Error('invalid-condition-value');
    if(type==='placement_at_most')return {type,value,ref:String(condition.ref||'').trim()||null};
    return {type,value};
  });
  const monthlyRaw=String(draft.monthlyMax??'').trim();
  const monthlyValue=monthlyRaw===''?0:Number(monthlyRaw);
  if(!Number.isInteger(monthlyValue)||monthlyValue<0||monthlyValue>1000)throw Error('invalid-monthly-max');
  const monthlyMax=monthlyValue===0?null:monthlyValue;
  const quantity=Number(draft.reward.quantity);
  if(!Number.isInteger(quantity)||quantity<1||quantity>10000)throw Error('invalid-quantity');
  const expiresAt=inventoryExpiry(draft.reward.expiry);
  return {
    ruleCode,
    name:String(draft.name).trim(),
    trigger:draft.trigger,
    logic:draft.logic,
    deliveryMode:draft.deliveryMode,
    repeatMode:draft.repeatMode,
    monthlyMax,
    enabled:draft.enabled===true,
    conditions,
    reward:{
      itemCode:String(draft.reward.itemCode||'').trim().toLowerCase(),
      name:String(draft.reward.name||'').trim(),
      quantity,
      imageUrl:String(draft.reward.imageUrl||'').trim(),
      purpose:String(draft.reward.purpose||'').trim(),
      source:String(draft.reward.source||'').trim(),
      expiresAt,
      consumable:draft.reward.consumable===true,
    },
  };
}
async function handleRewardRulesAdmin(action,target){
  if(!isSuperAdmin())return;
  const s=rewardRulesAdminContext();
  if(action==='inventory-rule-refresh'){await loadRewardRulesAdmin();return;}
  if(action==='inventory-rule-new'){
    s.editing=true;s.selectedCode='';s.draft=defaultRewardRuleDraft();s.error='';s.success='';render();return;
  }
  if(action==='inventory-rule-cancel'){
    s.editing=false;s.selectedCode='';s.draft=defaultRewardRuleDraft();s.error='';render();return;
  }
  if(action==='inventory-rule-edit'){
    const code=target.getAttribute('data-rule-code');
    const rule=(s.rules||[]).find(item=>item.ruleCode===code);
    if(!rule){s.error='找不到這條規則，請重新整理。';render();return;}
    s.editing=true;s.selectedCode=code;s.draft=storedRuleToDraft(rule);s.error='';s.success='';render();return;
  }
  if(action==='inventory-rule-add-condition'){
    if(s.editing&&s.draft.conditions.length<12){s.draft.conditions.push({type:'checkin_streak',value:'1',ref:''});render();}return;
  }
  if(action==='inventory-rule-remove-condition'){
    const index=Number(target.getAttribute('data-index'));
    if(s.editing&&Number.isInteger(index)&&s.draft.conditions.length>1){s.draft.conditions.splice(index,1);render();}
    else if(s.editing&&s.draft.conditions.length===1){s.error='至少需要保留一個取得條件。';render();}
    return;
  }
  if(action==='inventory-rule-template-weekly'){
    s.editing=true;s.selectedCode='';
    s.draft={
      ruleCode:'weekly-checkin-ticket',
      name:'每連續 7 天獲得抽獎券',
      trigger:'daily_checkin',logic:'and',deliveryMode:'auto',repeatMode:'per_source',monthlyMax:'',enabled:true,
      conditions:[{type:'checkin_streak_multiple',value:'7',ref:''}],
      reward:{itemCode:'weekly-raffle-ticket',name:'BXH ARENA 抽獎券',quantity:'1',imageUrl:'',purpose:'會員抽獎使用',source:'每日簽到｜每連續 7 天',expiry:'',consumable:true},
    };
    s.error='';render();return;
  }
  if(action==='inventory-rule-copy-draft'){
    const inventory=inventoryContext(),source=inventory.pending?.draft||inventory.draft;
    s.draft.reward={
      itemCode:String(source.itemCode||''),
      name:String(source.name||''),
      quantity:String(source.quantity||'1'),
      imageUrl:String(source.imageUrl||''),
      purpose:String(source.purpose||''),
      source:String(source.source||'REWARD RULES 1.0'),
      expiry:String(source.expiry||''),
      consumable:false,
    };
    render();return;
  }
  if(s.loading||s.busy)return;
  if(action==='inventory-rule-toggle'){
    const code=target.getAttribute('data-rule-code'),enabled=target.getAttribute('data-enabled')!=='true';
    s.busy=true;s.error='';s.success='';render();
    try{
      const r=await rewardRulesApi({action:'setEnabled',ruleCode:code,enabled});
      if(!r?.ok)throw Error('save-failed');
      s.success=(enabled?'已啟用：':'已停用：')+code;
      s.busy=false;await loadRewardRulesAdmin();
    }catch(error){s.error=rewardRulesError(error);s.busy=false;render();}
    return;
  }
  if(action==='inventory-rule-archive'){
    const code=target.getAttribute('data-rule-code');
    if(!confirm('確認封存取得規則「'+code+'」？\n封存後不再觸發，但歷史紀錄會保留。'))return;
    s.busy=true;s.error='';s.success='';render();
    try{
      const r=await rewardRulesApi({action:'archive',ruleCode:code});
      if(!r?.ok)throw Error('archive-failed');
      s.success='已封存：'+code;s.busy=false;
      if(s.selectedCode===code){s.editing=false;s.selectedCode='';s.draft=defaultRewardRuleDraft();}
      await loadRewardRulesAdmin();
    }catch(error){s.error=rewardRulesError(error);s.busy=false;render();}
    return;
  }
  if(action==='inventory-rule-save'){
    try{
      const rule=rewardRuleBuildPayload(s.draft);
      if(!confirm('確認儲存取得規則？\n'+rule.name+'\n達成後：'+rule.reward.name+' × '+rule.reward.quantity))return;
      s.busy=true;s.error='';s.success='';render();
      const r=await rewardRulesApi({action:'save',rule});
      if(!r?.ok)throw Error('save-failed');
      s.success=(r.created?'已建立規則：':'已更新規則：')+rule.ruleCode;
      s.editing=false;s.selectedCode='';s.draft=defaultRewardRuleDraft();s.busy=false;
      await loadRewardRulesAdmin();
    }catch(error){s.error=rewardRulesError(error);s.busy=false;render();}
  }
}
function rewardRulesCaptureInput(event){
  if(!isSuperAdmin())return;
  const s=rewardRulesAdminContext();
  if(!s.editing||s.busy)return;
  const ruleField=event.target.getAttribute?.('data-reward-rule-field');
  const itemField=event.target.getAttribute?.('data-reward-item-field');
  const conditionField=event.target.getAttribute?.('data-reward-condition-field');
  if(ruleField){
    s.draft[ruleField]=ruleField==='enabled'?!!event.target.checked:event.target.value;
    return;
  }
  if(itemField){
    s.draft.reward[itemField]=itemField==='consumable'?!!event.target.checked:event.target.value;
    return;
  }
  if(conditionField){
    const index=Number(event.target.getAttribute('data-reward-condition-index'));
    if(!Number.isInteger(index)||!s.draft.conditions[index])return;
    s.draft.conditions[index][conditionField]=event.target.value;
    if(conditionField==='type'){
      const type=event.target.value;
      s.draft.conditions[index].value=['has_title','participated_event','manual_approval'].includes(type)?'':(s.draft.conditions[index].value||'1');
      s.draft.conditions[index].ref=['has_title','participated_event','placement_at_most'].includes(type)?(s.draft.conditions[index].ref||''):'';
      render();
    }
  }
}

window.renderRewardRulesAdmin=renderRewardRulesAdmin;
window.handleRewardRulesAdmin=handleRewardRulesAdmin;
document.addEventListener('input',rewardRulesCaptureInput);
document.addEventListener('change',rewardRulesCaptureInput);
if(typeof isSuperAdmin==='function'&&isSuperAdmin())setTimeout(()=>render(),0);

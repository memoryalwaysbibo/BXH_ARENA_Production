(function(root){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ladderTiers=['未定級','青銅','白銀','黃金','白金','鑽石','大師','宗師'];
const hunterTiers=[['ungraded','未分級'],['e','E級'],['d','D級'],['c','C級'],['b','B級'],['a','A級'],['s','S級'],['national','國家級']];
const roleNames={captain:'隊長',deputy:'副隊長',elite:'菁英隊員',member:'一般隊員'};
function tabs(active){return '<nav aria-label="戰隊功能">'+[['lobby','戰隊大廳'],['mine','我的戰隊'],['create','建立戰隊']].map(([key,label])=>'<button type="button" data-team-action="tab" data-value="'+key+'" aria-pressed="'+(active===key)+'">'+label+'</button>').join('')+'</nav>';}
function rankingTabs(active){return '<nav aria-label="排行榜種類">'+[['ladder','天梯'],['hunter','獵人'],['team','戰隊']].map(([key,label])=>'<button type="button" data-ranking-value="'+key+'" aria-pressed="'+(key===active)+'">'+label+'</button>').join('')+'</nav>';}
function option(value,label,current){return '<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>';}
function lobby({items=[],total=0,query='',mode='all',recruitment='all',loading=false,error=null,partial=false,staleCount=0,totalIsUpperBound=false}={}){
 const filters='<form data-team-form="search"><label>搜尋戰隊或隊長<input name="query" maxlength="100" value="'+esc(query)+'" placeholder="戰隊名稱、隊長名稱"></label><label>加入方式<select name="mode">'+[['all','全部'],['auto','自動加入'],['review','人工審核']].map(([v,l])=>option(v,l,mode)).join('')+'</select></label><label>招募狀態<select name="recruitment">'+[['all','全部'],['open','尚有名額'],['full','已滿員']].map(([v,l])=>option(v,l,recruitment)).join('')+'</select></label><button type="submit">搜尋</button><button type="button" data-team-action="clear">清除篩選</button></form>';
 let content;
 if(loading)content='<p role="status">正在載入戰隊…</p>';
 else if(error)content='<p role="alert">戰隊資料暫時無法載入，請重試。</p>';
 else if(!items.length)content='<p>沒有符合條件的戰隊，請調整搜尋或篩選。</p>';
 else content='<div class="team-table-scroll"><table><thead><tr><th>戰隊名稱</th><th>隊長</th><th>戰力</th><th>人數</th><th>加入狀態</th></tr></thead><tbody>'+items.map(t=>'<tr><td><button type="button" data-team-action="view" data-team-id="'+esc(t.id)+'">'+esc(t.name)+'</button></td><td>'+esc(t.captainName)+'</td><td>'+esc(t.strength??'待確認')+'</td><td>'+esc(t.memberCount)+'／'+esc(t.capacity)+'</td><td><button type="button" data-team-action="'+esc(t.join?.action||'none')+'" data-team-id="'+esc(t.id)+'"'+(t.join?.disabled!==false?' disabled':'')+'>'+esc(t.join?.label||'資格待確認')+'</button>'+(t.join?.label==='審核中'?'<button type="button" data-team-action="cancel" data-team-id="'+esc(t.id)+'">取消申請</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';
 return '<section class="bxh-team-ui"><h2>戰隊大廳</h2>'+filters+(staleCount>0?'<p role="status">本頁 '+esc(staleCount)+' 支戰隊資料更新中，請稍後再查看。</p>':'')+(!loading&&!error?'<p>'+(totalIsUpperBound?'搜尋結果最多：':'符合條件：')+esc(total)+' 支戰隊</p>':'')+content+'</section>';
}
function publicMembers(team){return '<section class="bxh-team-ui"><h2>'+esc(team.name)+'</h2><h3>戰隊成員</h3><div class="team-table-scroll"><table><thead><tr><th>玩家</th><th>職位</th><th>天梯積分</th><th>獵人排位</th></tr></thead><tbody>'+team.members.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(roleNames[p.role]||'一般隊員')+'</td><td>'+esc(p.ladderPoints??'尚無紀錄')+'</td><td>'+esc(({ungraded:'未分級',national:'國家級'}[p.hunterTier]||(p.hunterTier?p.hunterTier.toUpperCase()+'級':'尚無紀錄')))+'</td></tr>').join('')+'</tbody></table></div></section>';}
function recruitmentSettings(policy={}){
 const selected=policy.minLadderTier??'',hunter=policy.minTier??'';
 return '<form data-team-form="admission"><label>加入方式<select name="mode">'+[['auto','自動加入'],['review','人工審核']].map(([v,l])=>option(v,l,policy.mode||'review')).join('')+'</select></label><label>天梯排位<select name="minLadderTier">'+option('','未指定',selected)+ladderTiers.map(t=>option(t,t+'以上',selected)).join('')+'</select></label><label>獵人排位<select name="minTier">'+option('','未指定',hunter)+hunterTiers.map(([v,l])=>option(v,l+'以上',hunter)).join('')+'</select></label><button type="submit">儲存設定</button></form>';
}
function myTeam(team){if(!team)return noTeam();return '<section class="bxh-team-ui"><h2>我的戰隊</h2><p>'+esc(team.name)+'</p>'+(['captain','deputy'].includes(team.role)?'<h3>招募設定</h3>'+recruitmentSettings(team.admission||{})+'<button type="button" data-team-action="applications" data-team-id="'+esc(team.id)+'">查看加入申請</button>':'')+'</section>'; }
function applicationDateTime(value){
 if(!Number.isSafeInteger(value)||value<0)return {date:'未提供',time:'未提供'};
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return {date:'未提供',time:'未提供'};
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=k=>parts.find(x=>x.type===k)?.value||'';
 return {date:get('year')+'/'+get('month')+'/'+get('day'),time:get('hour')+':'+get('minute')};
}
function applications({items=[],hasMore=false,teamId}){
 const rows=items.map(a=>{const when=applicationDateTime(a.requestedAt);return '<li><span>'+esc(a.name)+'</span><div>申請日期：'+esc(when.date)+'</div><div>申請時間：'+esc(when.time)+'</div> <button type="button" data-team-action="approve" data-team-id="'+esc(teamId)+'" data-target-uid="'+esc(a.uid)+'">核准</button> <button type="button" data-team-action="reject" data-team-id="'+esc(teamId)+'" data-target-uid="'+esc(a.uid)+'">拒絕</button></li>';}).join('');
 return '<section class="bxh-team-ui"><h2>加入申請</h2><button type="button" data-team-action="tab" data-value="mine">返回我的戰隊</button><button type="button" data-team-action="reload-applications">重新整理名單</button>'+(items.length?'<ul>'+rows+'</ul>':'<p>目前沒有待審核的申請。</p>')+(hasMore?'<p>還有其他申請，處理目前名單後可繼續查看。</p>':'')+'</section>';
}
function createTeam(team){
 if(team)return '<section class="bxh-team-ui"><h2>建立戰隊</h2><p>你已有所屬戰隊，請先退出後再建立。</p><button type="button" data-team-action="tab" data-value="mine">查看我的戰隊</button></section>';
 return '<section class="bxh-team-ui"><h2>建立戰隊</h2><form data-team-form="create"><label>戰隊名稱<input name="name" required minlength="2" maxlength="24" placeholder="輸入戰隊名稱"></label><p>建立後你將成為隊長，初始成員上限為 10 人。</p><button type="submit">建立戰隊</button></form></section>';
}
function noTeam(){return '<section class="bxh-team-ui"><h2>你尚未加入戰隊</h2><p>尋找一起征戰的夥伴，或建立自己的戰隊。</p><button type="button" data-team-action="tab" data-value="lobby">戰隊大廳</button><button type="button" data-team-action="tab" data-value="create">建立戰隊</button></section>';}
const css='.bxh-team-ui{min-width:0}.bxh-team-ui form{display:flex;flex-wrap:wrap;gap:12px}.bxh-team-ui label{display:flex;flex-direction:column;gap:6px}.bxh-team-ui button,.bxh-team-ui input,.bxh-team-ui select{font:inherit;min-height:44px;max-width:100%;box-sizing:border-box}.bxh-team-ui .team-table-scroll{max-width:100%;overflow-x:auto}.bxh-team-ui table{width:100%;border-collapse:collapse}.bxh-team-ui th,.bxh-team-ui td{padding:12px;text-align:left}.bxh-team-ui td:first-child{overflow-wrap:anywhere}.bxh-team-ui button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:480px){.bxh-team-ui form>label{flex:1 1 140px}.bxh-team-ui th,.bxh-team-ui td{padding:8px}}';
const api={tabs,rankingTabs,lobby,publicMembers,noTeam,myTeam,applications,createTeam,recruitmentSettings,css};
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHTeamUI=api;
})(typeof window==='object'?window:globalThis);

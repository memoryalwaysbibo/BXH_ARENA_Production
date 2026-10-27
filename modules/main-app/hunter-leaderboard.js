(function(){
'use strict';
const tiers=['ungraded','e','d','c','b','a','s','national'];
const labels=['未分級','E 級獵人','D 級獵人','C 級獵人','B 級獵人','A 級獵人','S 級獵人','國家級獵人'];
const label=t=>labels[tiers.indexOf(t)]||'待核對';
function validRow(r){return r&&typeof r.key==='string'&&typeof r.playerName==='string'&&tiers.includes(r.tier)&&
 Number.isInteger(r.rank)&&r.rank>0&&Number.isFinite(r.score)&&r.score>=0&&r.score<=100&&Number.isFinite(r.strength)&&
 (r.matchCount==null||(Number.isSafeInteger(r.matchCount)&&r.matchCount>=0))&&r.strength>=0&&r.strength<=100&&tiers.includes(r.replayedHighest);}
function validPage(r,page,generation){return r?.ok===true&&r.version==='hunter-leaderboard-v1'&&r.promotionPolicy==='medium-or-larger-v1'&&
 ['complete','partial'].includes(r.status)&&typeof r.generation==='string'&&(!generation||r.generation===generation)&&r.page===page&&r.pageSize===50&&
 Number.isSafeInteger(r.total)&&r.total>=0&&r.total<=2000&&typeof r.hasMore==='boolean'&&Array.isArray(r.rows)&&r.rows.length<=50&&
 r.rows.every(validRow)&&(!r.mine||validRow(r.mine))&&r.counts&&['eligible','ranked','pending','noHistory','notPublic'].every(k=>Number.isSafeInteger(r.counts[k])&&r.counts[k]>=0)&&
 r.counts.ranked===r.total&&Number.isFinite(r.updatedAt)&&Number.isFinite(r.startedAt)&&r.updatedAt>=r.startedAt;}
function create({load,identity,onChange,schedule=fn=>setTimeout(fn,0)}){
 let state;
 function current(){const uid=identity()||'';if(!state||state.uid!==uid)state={uid,rows:[],page:0,data:null,loading:false,attempted:false,error:''};return state;}
 async function fetchPage(reset=false){
  let s=current();if(s.loading)return;
  if(reset){state={uid:s.uid,rows:[],page:0,data:null,loading:false,attempted:false,error:''};s=state;}
  const page=s.page+1,generation=s.data?.generation;s.loading=true;s.attempted=true;s.error='';onChange();
  try{
   const r=await load({page,...(generation?{generation}:{})});
   if(current()!==s)return;
   if(!validPage(r,page,generation))throw Error('invalid-board-response');
   const all=[...s.rows,...r.rows],seen=new Set();
   for(const row of all){if(seen.has(row.key))throw Error('duplicate-board-row');seen.add(row.key);}
   s.rows=all;s.page=page;s.data=r;
  }catch(error){if(current()===s)s.error='獵人榜暫時無法讀取，請稍後重新整理。';}
  finally{if(current()===s){s.loading=false;onChange();}}
 }
 function render(esc){
  const s=current();if(!s.attempted&&!s.loading){s.attempted=true;schedule(()=>{if(current()===s)void fetchPage();});}
  const d=s.data,date=d?new Date(d.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚未取得';
  const notice=d?(d.status==='partial'?`已核對資料暫排，另有 ${d.counts.pending} 位待核對；目前不能據此宣告全服最高。`:'本次核對已完成。'):'正在取得後端核對結果。';
  const rows=s.rows.map(r=>`<tr${d?.mine?.key===r.key?' class="hunter-board-mine"':''}><td>${r.rank}</td><td class="hunter-board-name">${esc(r.playerName)}${d?.mine?.key===r.key?' <small>我</small>':''}</td><td><span class="hunter-board-tier tier-${r.tier}">${label(r.tier)}</span></td><td><strong>${r.score.toFixed(1)}</strong></td><td>${r.strength}</td><td>${r.matchCount==null?'—':r.matchCount+' 場'}</td><td>${label(r.replayedHighest)}</td></tr>`).join('');
  return `<section class="panel hunter-board" aria-label="獵人榜"><div class="hunter-board-heading"><div><div class="panel-title">獵人榜</div><p class="hint">以目前階級排序，同階級比較評級分；顯示分數相同並列，不分賽季。</p></div><button class="btn btn-ghost btn-sm" data-action="hunter-board-refresh" ${s.loading?'disabled':''}>重新整理</button></div>
   <div class="hunter-board-summary"><div><small>${d?.status==='partial'?'已核對最高階級':'最高階級'}</small><strong>${d?.highest?label(d.highest.tier):'待核對'}</strong></div><div><small>列榜人數</small><strong>${d?d.counts.ranked:'—'}</strong></div><div><small>我的排名</small><strong>${s.uid?(d?.mine?'第 '+d.mine.rank+' 名':'尚未列榜'):'登入後查看'}</strong></div></div>
   <details class="hunter-board-info"><summary><span>榜單說明${d?.status==='partial'?`<small> · ${d.counts.pending} 位待核對</small>`:''}</span><span class="hunter-board-info-toggle"><span class="when-closed">展開</span><span class="when-open">收合</span></span></summary><div class="hunter-board-info-content">
   <p class="hint" role="status">${esc(notice)}${d?` 已完成核算 ${d.counts.ranked+d.counts.noHistory+d.counts.notPublic}／${d.counts.eligible} 位；未有有效戰績 ${d.counts.noHistory} 位，未有公開名稱 ${d.counts.notPublic} 位。`:''}</p>
   <p class="hint">更新時間（台灣）：${esc(date)}。積分賽結算成功並封存後自動啟動核算，另每 6 小時補漏核對；核算完成後重新整理可查看新榜單。此榜採公開玩家名稱，僅計已封存的正式積分賽有效戰績。累計有效對戰與獵人執照採計範圍一致，實力分採最近 20 場。生涯最高為歷史回算。</p></div></details>
   ${s.error?`<p class="auth-error" role="alert">${esc(s.error)}</p>`:''}
   ${s.rows.length?`<div class="rank-scroll"><table class="rank-table hunter-board-table"><caption class="sr-only">獵人階級與評級分排名</caption><thead><tr><th scope="col">排名</th><th scope="col">玩家</th><th scope="col">目前階級</th><th scope="col">評級分</th><th scope="col">實力分</th><th scope="col">累計有效對戰</th><th scope="col">生涯最高（回算）</th></tr></thead><tbody>${rows}</tbody></table></div>`:d&&!s.loading?'<div class="empty-state">本次尚無可列榜資料。</div>':''}
   ${s.loading?'<p class="hint" role="status">正在讀取獵人榜…</p>':''}
   ${d?.hasMore?`<button class="btn btn-ghost" data-action="hunter-board-more" ${s.loading?'disabled':''}>顯示更多</button>`:''}
   ${!s.loading&&!s.data?'<button class="btn btn-ghost" data-action="hunter-board-refresh">重新讀取</button>':''}</section>`;
 }
 return {render,refresh:()=>fetchPage(true),more:()=>{const s=current();if(s.data?.hasMore)return fetchPage();},state:current};
}
window.BXHHunterLeaderboard=Object.freeze({create,validPage});
})();

(function(root){
'use strict';
function create({read,identity,onChange=()=>{}}){
 let uid=null,ticket=0,items=[],total=0,partial=false,excluded=0,offset=0,loading=false,error=null,loaded=false;
 function reset(){ticket++;items=[];total=0;partial=false;excluded=0;offset=0;loading=false;error=null;loaded=false;uid=identity()||null;}
 function sync(){if(uid!==(identity()||null))reset();}
 async function load(next=0){
  sync();if(!uid||loading)return;
  const call=++ticket,owner=uid;loading=true;error=null;onChange();
  try{
   const r=await read({offset:next,limit:20});if(call!==ticket||owner!==(identity()||null))return;
   if(!Array.isArray(r?.items)||!Number.isSafeInteger(r.total)||r.total<0||!Number.isSafeInteger(r.excluded)||r.excluded<0)throw Error('invalid-ranking');
   items=r.items;total=r.total;partial=r.partial===true;excluded=r.excluded;offset=next;loaded=true;
  }catch(_){if(call===ticket&&owner===(identity()||null)){items=[];error='戰隊排行暫時無法載入，請重新整理。';loaded=false;}}
  finally{if(call===ticket&&owner===(identity()||null)){loading=false;onChange();}}
 }
 function render(esc){
  sync();if(!uid)return '<section><h2>戰隊排行</h2><p>請先登入後查看。</p></section>';
  if(!loaded&&!loading&&!error)void load();
  const rows=items.map(x=>'<tr><td>'+esc(x.rank)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.captainName)+'</td><td>'+esc(x.memberCount)+'</td><td>'+esc(x.strength)+'</td></tr>').join('');
  return '<section class="bxh-team-ui"><h2>戰隊排行</h2><p>依戰隊成員本賽季天梯積分總和排序；同分並列。</p><button type="button" data-action="team-ranking-refresh"'+(loading?' disabled':'')+'>重新整理</button>'+(loading?'<p role="status">正在載入戰隊排行…</p>':error?'<p role="alert">'+esc(error)+'</p>':(partial?'<p role="status">'+esc(excluded)+' 支戰隊資料更新中，目前名次可能變動。</p>':'')+(items.length?'<div class="team-table-scroll"><table><thead><tr><th>排名</th><th>戰隊</th><th>隊長</th><th>人數</th><th>戰力</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>目前沒有可列入排行的戰隊。</p>')+(offset>0?'<button type="button" data-action="team-ranking-prev">上一頁</button>':'')+(offset+items.length<total?'<button type="button" data-action="team-ranking-next">下一頁</button>':''))+'</section>';
 }
 return {render,refresh:()=>load(0),next:()=>load(offset+20),previous:()=>load(Math.max(0,offset-20))};
}
if(typeof module==='object'&&module.exports)module.exports={create};else root.BXHTeamRanking={create};
})(typeof window==='object'?window:globalThis);

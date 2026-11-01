(function(root){
 'use strict';
 function mount(element,{transport,code,uid,station=1,manager=false,onView=()=>{},executeCommand=null}){
  if(!['127.0.0.1','localhost'].includes(root.location.hostname)||transport.projectId!=='demo-bxh-four-court-buckets')throw Error('emulator-lab-only');
  const original=root.cloudSync,listeners=new Set();let view={status:'offline',state:null,pending:[]};
  element.innerHTML='<div class="lab-status" role="status"></div><label>戰鬥台 <select class="lab-court"></select></label><div class="lab-seats"></div><div class="lab-score" aria-live="polite"></div><div class="lab-actions"><button class="lab-a">A +1</button><button class="lab-b">B +1</button><button class="lab-retry">重新確認</button><button class="lab-connection">中斷同步</button></div><p class="lab-toast" role="status"></p>';
  const el=selector=>element.querySelector(selector),toast=text=>el('.lab-toast').textContent=text;
  const client=root.BXHFourCourtClient.create({transport,code,uid,operationId:()=>root.crypto.randomUUID(),canManage:()=>manager,onView:next=>{
   view=next;
   onView(next);
   if(next.state)for(const listener of listeners)listener({model:next.state.meta.refereeSeatsV1,projection:{refereeSeatNames:next.state.meta.refereeSeatNames}});
   render();
  }});
  root.cloudSync={manageRefereeSeats:data=>client.manageRefereeSeats(data),subscribeRefereeSeats:(_code,callback)=>{listeners.add(callback);return ()=>listeners.delete(callback);}};
  const current=()=>view.state?.matches.find(m=>m.station===station&&!m.completed);
  function render(){
   const state=view.state;
   root.BXHRefereeSeats.bind({state:()=>view.state,uid:()=>uid,eligible:()=>view.status==='ready',operator:()=>true,manager:()=>manager,render,toast});
   el('.lab-status').textContent=({ready:'已同步',syncing:'同步中',offline:'已中斷同步',error:'同步失敗'})[view.status];
   const select=el('.lab-court'),count=Number(state?.meta?.stations||0);
   if(select.options.length!==count){select.innerHTML='';for(let n=1;n<=count;n++){const option=document.createElement('option');option.value=String(n);option.textContent=String(n);select.append(option);}}
   select.value=String(station);
   el('.lab-seats').innerHTML=state?root.BXHRefereeSeats.render(state,station):'';
   const match=current();el('.lab-score').textContent=match?`${match.scoreA}：${match.scoreB}`:'等待賽事';
   for(const selector of ['.lab-a','.lab-b'])el(selector).disabled=!match||!client.canScore(station)||view.pending.includes('score:'+match.id);
   el('.lab-retry').hidden=!view.retryable?.length;el('.lab-retry').disabled=view.status!=='ready';
   el('.lab-connection').textContent=view.status==='offline'?'重新連線':'中斷同步';
  }
  async function score(side){const match=current();if(!match)return;const result=executeCommand?{ok:await executeCommand(match.id,{action:'score',side,finish:'spin'})}:await client.score(match.id,'score',{side,finish:'spin'});if(!result?.ok)toast(result?.reason==='cloud-unavailable'?'結果待確認，請按重新確認':'未完成計分，請確認同步狀態。');}
  el('.lab-a').onclick=()=>score('A');el('.lab-b').onclick=()=>score('B');
  el('.lab-court').onchange=event=>{station=Number(event.target.value);render();};
  el('.lab-connection').onclick=()=>view.status==='offline'?client.connect():client.disconnect();
  el('.lab-retry').onclick=async()=>{for(const key of [...view.pending]){const result=await client.retry(key);toast(result?.ok?'已確認操作結果':'結果尚未確認，請再次重試。');}};
  render();client.connect();
  return {client,dispose(){client.disconnect();root.BXHRefereeSeats.bind({state:()=>null,uid:()=>null,operator:()=>false,render:()=>{}});root.cloudSync=original;element.replaceChildren();}};
 }
 root.BXHFourCourtLab={mount};
})(window);

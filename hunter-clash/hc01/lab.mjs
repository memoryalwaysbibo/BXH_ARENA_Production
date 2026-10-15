import{pairingPayload,parsePairingPayload,renderPairingQr}from'./pairing.mjs';
import{createController}from'./controller.mjs';
import{createScanner}from'./scanner.mjs';
const state={A:null,B:null},clients={},scanners={};
const labels={proposed:'等待對手配對',accepted:'等待雙方準備',in_progress:'對戰中',round_pending:'等待本局確認',final_pending:'等待完賽確認',completed:'完賽紀錄已保存',disputed:'有爭議，保留紀錄',cancelled:'已取消',expired:'配對已過期',rejected:'已拒絕'};
const message=text=>document.getElementById('message').textContent=text;
const definitive=new Set(['invalid-operation','invalid-id','invalid-input','invalid-rules','unauthenticated','account-unavailable','opponent-unavailable','closed','request-id-reused','challenge-already-exists','invalid-pairing-policy','challenge-unavailable','pairing-unavailable','participant-required','revision-conflict','terminal-state','invalid-state','invalid-round','round-confirmation-invalid','finish-confirmation-invalid','invalid-time','environment-mismatch']);
async function transport(operation,input,{uid,signal}){
  const response=await fetch('/command',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+uid},body:JSON.stringify({operation,input}),signal});
  const result=await response.json();
  if(!response.ok||result.error){const error=Error(result.error||'unknown-response');error.definitive=response.status<500&&definitive.has(result.error);throw error;}
  if(result.challenge?.environment!=='sandbox'||typeof result.challenge?.challengeId!=='string')throw Error('unknown-response');return result;
}
for(const uid of ['A','B']){
  const section=document.createElement('section');section.id=uid;section.innerHTML=`<h2>測試玩家 ${uid}</h2><div class="state">尚未配對</div><div class="score">0 : 0</div><p class="round"></p><div class="qr" aria-label="${uid} 配對QR碼"></div><textarea aria-label="${uid} 配對資料" placeholder="掃碼或貼上另一方配對資料"></textarea><div class="row"><button data-op="createChallenge">建立挑戰</button><button data-op="scan">相機掃碼</button><button data-op="stopScan">關閉相機</button><button data-op="accept">接受配對</button><button data-op="getChallenge">刷新</button><button data-op="retry" hidden>重送原操作</button></div><video playsinline muted hidden></video><canvas class="scanner" hidden></canvas><div class="row"><button data-op="start">我準備好了</button><button data-op="reject">拒絕</button><button data-op="cancel">取消</button></div><div class="row"><select class="winner"><option value="${uid}">我方得分</option><option value="${uid==='A'?'B':'A'}">對方得分</option></select><select class="finish"><option value="spin">轉停 +1</option><option value="knockout">擊飛 +2</option><option value="burst">爆裂 +2</option><option value="extreme">極限 +3</option></select><button data-op="proposeRound">送出本局</button></div><div class="row"><button data-op="confirmRound">確認本局</button><button data-op="confirmFinish">確認完賽</button><button data-op="dispute">有爭議</button></div>`;
  document.getElementById('players').append(section);
  const client=createController({transport,storage:sessionStorage,onChange:view=>{state[uid]=view;render(uid);}});clients[uid]=client;
  const video=section.querySelector('video');scanners[uid]=createScanner({video,canvas:section.querySelector('.scanner'),onPairing:found=>{section.querySelector('textarea').value=found.payload;video.hidden=true;message('配對碼已辨識，請確認後按接受配對。');},onMessage:message});
  client.setSession(uid);
  section.addEventListener('click',async event=>{
    const operation=event.target.dataset.op;if(!operation)return;
    if(operation==='stopScan'){scanners[uid].stop();video.hidden=true;return;}
    if(operation==='scan'){if(state[uid]?.busy||state[uid]?.pending)return;scanners[uid].stop();video.hidden=false;try{await scanners[uid].start();}catch{video.hidden=true;message('無法使用相機，請允許相機權限或貼上配對資料。');}return;}
    if(state[uid]?.busy)return;
    let result;try{
      if(operation==='retry')result=await client.retry();
      else if(operation==='getChallenge'){const id=state[uid].snapshot?.challengeId||state[uid].pending?.input.challengeId;if(!id)throw Error('請先建立或接受配對');result=await client.read(id);}
      else{
        const c=state[uid].snapshot;let input;
        if(operation==='createChallenge')input={};
        else if(operation==='accept'){input={...parsePairingPayload(section.querySelector('textarea').value),expectedRevision:0};}
        else{if(!c)throw Error('請先建立或接受配對');input={challengeId:c.challengeId,expectedRevision:c.revision};
          if(operation==='proposeRound'){input.winnerUid=section.querySelector('.winner').value;input.finish=section.querySelector('.finish').value;}
          if(operation==='confirmRound')input.roundRevision=c.pendingRound?.roundRevision;
          if(operation==='confirmFinish')input.resultRevision=c.resultRevision;
        }result=await client.mutate(operation,input);
      }
      if(!result)return;
      if(result.pairingToken){const payload=pairingPayload(result.challenge.challengeId,result.pairingToken);section.querySelector('textarea').value=payload;renderPairingQr(section.querySelector('.qr'),payload,window.QRCode);}
      message(result.pairingToken?'配對碼已建立，可由另一方掃碼或貼上資料後接受。':'操作成功。另一方按刷新查看最新狀態。');
    }catch(error){message(state[uid].pending?'操作結果尚未確認，請重送原操作；勿重新建立另一筆。':error.message==='revision-conflict'?'對戰狀態已更新，請先刷新。':error.message);}
  });
}
function render(uid){
  const el=document.getElementById(uid),view=state[uid],c=view?.snapshot;if(!el)return;
  el.querySelector('.state').textContent=c?labels[c.status]+' · 版本 '+c.revision:view?.pending?'有待確認操作，請重送原操作':'尚未配對';
  el.querySelector('.score').textContent=c?c.score.a+' : '+c.score.b:'0 : 0';
  el.querySelector('.round').textContent=c?.pendingRound?'第 '+c.pendingRound.number+' 局：'+c.pendingRound.winnerUid+' 得 '+c.pendingRound.points+' 分，等待另一方確認。':c?'已確認 '+c.rounds.length+' 局':'';
  if(c&&c.status!=='proposed')el.querySelector('.qr').replaceChildren();
  for(const button of el.querySelectorAll('button')){const op=button.dataset.op;
    if(op==='retry'){button.hidden=!view?.pending;button.disabled=!!view?.busy;continue;}
    button.disabled=!!view?.busy||(!!view?.pending&&!['getChallenge','stopScan'].includes(op))||(op==='start'&&(!c||c.status!=='accepted'||c.ready.includes(uid)))||(op==='proposeRound'&&c?.status!=='in_progress')||(op==='confirmRound'&&(c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid)))||(op==='confirmFinish'&&(c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid)))||(op==='dispute'&&!['round_pending','final_pending'].includes(c?.status));
  }
}
addEventListener('pagehide',()=>{for(const scanner of Object.values(scanners))scanner.stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const scanner of Object.values(scanners))scanner.stop();});

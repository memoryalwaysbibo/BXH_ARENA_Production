import{createController}from'../controller.mjs';
import{pairingPayload,parsePairingPayload,renderPairingQr}from'../pairing.mjs';
import{createScanner}from'../scanner.mjs';
const labels={proposed:'等待對手配對',accepted:'等待雙方準備',in_progress:'對戰中',round_pending:'等待本局確認',final_pending:'等待完賽確認',completed:'完賽紀錄已保存',disputed:'有爭議，保留紀錄',cancelled:'已取消',expired:'配對已過期',rejected:'已拒絕'};
export function mountMobile(root,runtime,{storage=sessionStorage,accountStorage=globalThis.localStorage}={}){
  const app=root.querySelector('#app'),message=text=>root.querySelector('#message').textContent=text;
  app.innerHTML=`<form id="login"><section><h2>內測帳號登入</h2><label>電子郵件<input name="email" type="email" autocomplete="username" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><label class="remember"><input name="remember" type="checkbox">記憶帳號</label><button type="submit">登入</button><p>帳號由測試主持者提供。</p></section></form><section id="identity" hidden><span id="who"></span><button type="button" data-op="logout">登出</button></section><section id="match" hidden><div class="state"></div><div class="score">0 : 0</div><p class="round"></p><small class="policy"></small><div class="qr"></div><label>配對資料<textarea placeholder="掃碼或貼上對手的配對資料"></textarea></label><video playsinline muted hidden></video><canvas hidden></canvas><div class="row"><button data-op="createChallenge">建立挑戰</button><button data-op="scan">相機掃碼</button><button data-op="stopScan">關閉相機</button><button data-op="accept">接受配對</button><button data-op="getChallenge">刷新</button><button data-op="retry" hidden>重送原操作</button></div><div class="row"><button data-op="start">我準備好了</button><button data-op="reject">拒絕</button><button data-op="cancel">取消</button></div><div class="scoreboards"></div><p class="score-help">點選得分方式後，需由另一方確認本局才會加分。</p><div class="row"><button data-op="confirmRound">確認本局</button><button data-op="confirmFinish">確認完賽</button><button data-op="dispute">有爭議</button></div></section>`;
  const select=s=>app.querySelector(s),video=select('video');let view={},previousUid=null,loginBusy=false;
  const accountKey='hc01:remembered-email';
  try{const email=accountStorage?.getItem(accountKey);if(email){select('[name="email"]').value=email;select('[name="remember"]').checked=true;}}catch{}
  select('[name="remember"]').addEventListener('change',()=>{if(!select('[name="remember"]').checked)try{accountStorage?.removeItem(accountKey);}catch{}});
  const savedKey=uid=>'hc01:mobile:last:'+uid;
  const savedId=uid=>{try{return storage?.getItem(savedKey(uid));}catch{return null;}};
  const saveId=(uid,id)=>{try{if(id)storage?.setItem(savedKey(uid),id);else storage?.removeItem(savedKey(uid));}catch{}};
  const clearPairing=()=>{scanner.stop();video.hidden=true;select('textarea').value='';select('.qr').replaceChildren();};
  const scanner=createScanner({video,canvas:select('canvas'),onPairing:found=>{select('textarea').value=found.payload;video.hidden=true;message('配對碼已辨識，請按接受配對。');},onMessage:message});
  const client=createController({transport:runtime.transport,storage,onChange:next=>{view=next;render();}});
  function render(){
    const c=view.snapshot,uid=view.uid;
    select('#login').hidden=!!uid;select('#identity').hidden=!uid;select('#match').hidden=!uid;select('#who').textContent=uid?'已登入：'+uid:'';
    select('.state').textContent=c?(labels[c.status]||c.status)+' · 版本 '+c.revision:view.pending?'有待確認操作，請重送原操作':'尚未配對';
    select('.score').textContent=c?c.score.a+' : '+c.score.b:'0 : 0';
    select('.round').textContent=c?.pendingRound?'第 '+c.pendingRound.number+' 局：'+(c.pendingRound.winnerUid===uid?'我方':'對方')+' 得 '+c.pendingRound.points+' 分，等待另一方確認。':c?'已確認 '+c.rounds.length+' 局':'';
    select('.policy').textContent=c?'本場內測目標 '+c.rules.targetScore+' 分 · 完賽紀錄不發放 Rating':'';
    const boards=select('.scoreboards');boards.replaceChildren();
    for(const [index,player] of (c?.participants||[]).entries()){
      const panel=document.createElement('div');panel.className='player-score';
      const name=document.createElement('h3');name.textContent=player===uid?'我方':'對方';panel.append(name);
      const score=document.createElement('div');score.className='points';score.textContent=String(c.score[index===0?'a':'b']);panel.append(score);
      for(const [finish,label] of [['spin','旋轉勝利 +1分'],['knockout','擊飛勝利 +2分'],['burst','爆裂勝利 +2分'],['extreme','極限勝利 +3分']]){
        const button=document.createElement('button');button.type='button';button.dataset.op='proposeRound';button.dataset.player=String(index);button.dataset.finish=finish;button.textContent=label;panel.append(button);
      }
      boards.append(panel);
    }
    if(c){saveId(uid,c.challengeId);if(c.status!=='proposed')select('.qr').replaceChildren();}
    for(const button of app.querySelectorAll('[data-op]')){
      const op=button.dataset.op;if(op==='logout'){button.disabled=false;continue;}if(op==='retry')button.hidden=!view.pending;
      const active=c&&!['completed','disputed','cancelled','expired','rejected'].includes(c.status);
      button.disabled=!uid||!!view.busy||(!!view.pending&&!['retry','getChallenge','stopScan'].includes(op))||
        (op==='retry'&&!view.pending)||(op==='getChallenge'&&!c&&!view.pending?.input.challengeId&&!savedId(uid))||
        (op==='createChallenge'&&active)||(op==='accept'&&active)||(op==='start'&&(c?.status!=='accepted'||c.ready.includes(uid)))||
        (op==='proposeRound'&&c?.status!=='in_progress')||(op==='confirmRound'&&(c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid)))||
        (op==='confirmFinish'&&(c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid)))||
        (op==='dispute'&&!['round_pending','final_pending'].includes(c?.status))||(op==='reject'&&(c?.status!=='accepted'||c.participants[0]===uid))||(op==='cancel'&&!active);
    }
  }
  const unsubscribe=runtime.watch(user=>{
    const uid=user?.uid||null;if(uid!==previousUid){clearPairing();if(previousUid)saveId(previousUid,null);previousUid=uid;client.setSession(uid);}
    if(uid){message('登入成功，可建立挑戰或掃描對手配對碼。');const id=savedId(uid);if(id&&!view.busy&&!view.snapshot)client.read(id).catch(()=>{if(view.uid===uid)message('無法恢復對戰，請按刷新或重送原操作。');});}
    else{client.setSession(null);message('請登入測試帳號。');}
  });
  select('#login').addEventListener('submit',async event=>{event.preventDefault();if(loginBusy)return;loginBusy=true;const button=select('#login button');button.disabled=true;
    try{const email=select('[name="email"]').value.trim();await runtime.login(email,select('[name="password"]').value);try{if(select('[name="remember"]').checked)accountStorage?.setItem(accountKey,email);else accountStorage?.removeItem(accountKey);}catch{}}
    catch{message('登入失敗，請確認測試帳號及密碼。');}finally{select('[name="password"]').value='';loginBusy=false;button.disabled=false;}
  });
  app.addEventListener('click',async event=>{
    const action=event.target.closest('[data-op]');const op=action?.dataset.op;if(!op||action.disabled)return;const uid=view.uid;if(op==='stopScan'){scanner.stop();video.hidden=true;return;}
    if(op==='logout'){clearPairing();if(uid)saveId(uid,null);client.dispose();try{await runtime.logout();}catch{message('登出未完成，請重新整理後確認。');}return;}
    if(!uid||view.busy)return;
    if(op==='scan'){video.hidden=false;try{await scanner.start();}catch{if(view.uid===uid){video.hidden=true;message('無法使用相機，請允許權限或貼上配對資料。');}}return;}
    try{
      let result;if(op==='retry')result=await client.retry();
      else if(op==='getChallenge')result=await client.read(view.snapshot?.challengeId||view.pending?.input.challengeId||savedId(uid));
      else{const c=view.snapshot;let input;if(op==='createChallenge')input={};else if(op==='accept')input={...parsePairingPayload(select('textarea').value),expectedRevision:0};
        else{if(!c)throw Error('challenge-required');input={challengeId:c.challengeId,expectedRevision:c.revision};
          if(op==='proposeRound'){input.winnerUid=c.participants[Number(action.dataset.player)];input.finish=action.dataset.finish;}
          if(op==='confirmRound')input.roundRevision=c.pendingRound?.roundRevision;if(op==='confirmFinish')input.resultRevision=c.resultRevision;}
        result=await client.mutate(op,input);}
      if(view.uid!==uid||!result)return;
      if(result.pairingToken){const payload=pairingPayload(result.challenge.challengeId,result.pairingToken);select('textarea').value=payload;renderPairingQr(select('.qr'),payload,globalThis.QRCode);}
      message('操作已確認。另一方可按刷新查看最新狀態。');
    }catch(error){if(view.uid!==uid)return;message(view.pending?'操作結果尚未確認，請重送原操作。':error.message==='revision-conflict'?'狀態已更新，請先刷新。':error.message==='account-unavailable'?'此帳號沒有內測授權，請聯絡測試主持者。':'操作未完成，請刷新並確認配對資料或目前狀態。');}
  });
  const stop=()=>{scanner.stop();video.hidden=true;};const background=()=>{if(document.hidden)stop();};addEventListener('pagehide',stop);document.addEventListener('visibilitychange',background);
  render();return{dispose(){unsubscribe();stop();client.dispose();app.replaceChildren();removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',background);}};
}

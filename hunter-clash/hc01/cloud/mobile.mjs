import{createController}from'../controller.mjs';
import{pairingPayload,parsePairingPayload,renderPairingQr}from'../pairing.mjs';
import{createScanner}from'../scanner.mjs';
const labels={proposed:'等待對手配對',accepted:'配對成功，等待確認開賽',in_progress:'對戰中',round_pending:'等待本局確認',final_pending:'等待完賽確認',completed:'完賽紀錄已保存',disputed:'有爭議，保留紀錄',score_review:'請核對比分',cancelled:'已取消',expired:'配對已過期',rejected:'已拒絕'};
export function mountMobile(root,runtime,{storage=sessionStorage,accountStorage=globalThis.localStorage}={}){
  const app=root.querySelector('#app'),message=text=>root.querySelector('#message').textContent=text;
  app.innerHTML=`<form id="login"><section><h2>內測帳號登入</h2><label>電子郵件<input name="email" type="email" autocomplete="username" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><label class="remember"><input name="remember" type="checkbox">記憶帳號</label><button type="submit">登入</button><p>帳號由測試主持者提供。</p></section></form><section id="identity" hidden><span class="account-dot" aria-hidden="true"></span><span id="who"></span><button type="button" data-op="logout">登出</button></section><section id="match" hidden><div class="match-heading"><div class="state"></div><span class="sync-label">自動同步</span></div><div class="welcome"><h2>下一場，換你上場。</h2><p>建立挑戰，或加入對手的挑戰。</p></div><div class="score">0 : 0</div><p class="round"></p><small class="policy"></small><div class="pairing-share" hidden><h3>邀請對手加入</h3><p>請對手掃描 QR，或輸入下方 4 碼。</p><div class="qr"></div><strong class="pairing-code"></strong><p class="pairing-expiry"></p></div><div class="home-actions row"><button data-op="createChallenge"><span class="action-icon" aria-hidden="true">＋</span><strong>建立挑戰</strong><small>出示 QR 與 4 碼</small></button><button data-op="join"><span class="action-icon" aria-hidden="true">⌗</span><strong>加入挑戰</strong><small>掃碼或輸入序號</small></button></div><div class="join-panel" hidden><h3>加入挑戰</h3><button data-op="scan">掃描 QR</button><div class="camera" hidden><video playsinline muted></video><button data-op="stopScan">關閉相機</button></div><canvas hidden></canvas><p class="divider">或輸入 4 碼</p><label>配對序號<input name="pairingCode" placeholder="例如 A7K3" autocomplete="off" autocapitalize="characters" maxlength="4"></label><button data-op="acceptCode">確認加入</button><div class="scan-confirm" hidden><p>已辨識挑戰 QR，確認加入此挑戰？</p><button data-op="accept">確認加入</button></div><textarea hidden></textarea><button data-op="back">返回</button></div><div class="pairing-actions row"><button data-op="start">確認開賽</button><button data-op="reject">拒絕配對</button></div><p class="ready-help" hidden></p><button class="flow-back" data-op="cancel">返回</button><details class="more-actions"><summary>更多操作</summary><div class="row"><button data-op="getChallenge">重新同步</button></div></details><button data-op="retry" hidden>重送原操作</button><div class="scoreboards"></div><p class="review-help" hidden></p><button data-op="undoRound">撤銷上一筆得分</button><button data-op="resumeReview">比分已核對，繼續</button><p class="score-help">建立挑戰者替雙方記分，比分自動同步；整場結束後雙方確認結果。</p><div class="row"><button data-op="confirmRound">確認本局</button><button data-op="confirmFinish">確認完賽</button><button data-op="dispute">有爭議</button></div></section>`;
  const select=s=>app.querySelector(s),video=select('video');let view={},previousUid=null,loginBusy=false,joining=false,scanning=false,scanFound=false;
  const accountKey='hc01:remembered-email';
  try{const email=accountStorage?.getItem(accountKey);if(email){select('[name="email"]').value=email;select('[name="remember"]').checked=true;}}catch{}
  select('[name="remember"]').addEventListener('change',()=>{if(!select('[name="remember"]').checked)try{accountStorage?.removeItem(accountKey);}catch{}});
  const savedKey=uid=>'hc01:mobile:last:'+uid;
  const savedId=uid=>{try{return storage?.getItem(savedKey(uid));}catch{return null;}};
  const saveId=(uid,id)=>{try{if(id)storage?.setItem(savedKey(uid),id);else storage?.removeItem(savedKey(uid));}catch{}};
  const clearPairing=()=>{scanner.stop();scanning=false;scanFound=false;joining=false;video.hidden=true;select('textarea').value='';select('.qr').replaceChildren();select('.pairing-share').hidden=true;select('.pairing-code').textContent='';select('[name="pairingCode"]').value='';};
  const scanner=createScanner({video,canvas:select('canvas'),onPairing:found=>{select('textarea').value=found.payload;scanning=false;scanFound=true;render();message('配對碼已辨識，請確認加入挑戰。');},onMessage:message});
  const client=createController({transport:runtime.transport,storage,onChange:next=>{view=next;render();}});
  const goHome=()=>{saveId(view.uid,null);clearPairing();client.setSession(view.uid);message('');};
  function render(){
    const c=view.snapshot,uid=view.uid;
    select('#login').hidden=!!uid;select('#identity').hidden=!uid;select('#match').hidden=!uid;select('#who').textContent=uid?(runtime.auth?.currentUser?.displayName||runtime.auth?.currentUser?.email||'測試玩家'):'';
    select('.state').textContent=c?(labels[c.status]||c.status):view.pending?'操作待確認':'準備對戰';
    select('.state').dataset.revision=c?String(c.revision):'';
    select('.welcome').hidden=!!c||joining||!!view.pending;
    select('.sync-label').hidden=!c||['completed','disputed','cancelled','expired','rejected'].includes(c.status);
    select('.more-actions').hidden=!c&&!view.pending;
    select('#match').dataset.stage=c?.status||(joining?'joining':'home');
    select('.score').textContent=c?c.score.a+' : '+c.score.b:'0 : 0';
    select('.round').textContent=c?.pendingRound?'第 '+c.pendingRound.number+' 局：'+(c.pendingRound.winnerUid===uid?'我方':'對方')+' 得 '+c.pendingRound.points+' 分，等待另一方確認。':c?'已記錄 '+c.rounds.length+' 局':'';
    select('.policy').textContent=c?'一般對戰 · '+c.rules.targetScore+' 分勝':'';
    const active=c&&!['completed','disputed','cancelled','expired','rejected'].includes(c.status);
    if(active)joining=false;
    select('.home-actions').hidden=!!active||joining;
    select('.join-panel').hidden=!joining||!!active;
    select('.camera').hidden=!scanning;video.hidden=!scanning;
    select('.scan-confirm').hidden=!scanFound;
    select('[data-op="scan"]').hidden=scanning||scanFound;
    select('[data-op="acceptCode"]').hidden=scanFound;
    select('[name="pairingCode"]').closest('label').hidden=scanFound;
    select('[data-op="start"]').hidden=c?.status!=='accepted';
    select('[data-op="reject"]').hidden=c?.status!=='accepted'||c.participants[0]===uid;
    select('[data-op="cancel"]').hidden=!active;
    select('.ready-help').hidden=c?.status!=='accepted';
    select('.ready-help').textContent=c?.ready.includes(uid)?'已確認開賽，等待對手確認。':'對手已加入。雙方確認開賽後開始計分。';
    select('.score').hidden=!c||['proposed','accepted'].includes(c.status);
    select('.score-help').hidden=c?.status!=='in_progress';
    select('[data-op="confirmRound"]').hidden=c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid);
    select('[data-op="confirmFinish"]').hidden=c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid);
    select('.review-help').hidden=c?.status!=='score_review';
    select('.review-help').textContent=c?.participants[0]===uid?'對戰保留中。請核對比分，可撤銷誤記得分後重新記分；核對完成再繼續。':'對戰保留中，等待記分方核對修正；完賽仍需雙方重新確認。';
    select('[data-op="undoRound"]').hidden=c?.participants[0]!==uid||!['in_progress','round_pending','final_pending','score_review'].includes(c?.status);
    select('[data-op="resumeReview"]').hidden=c?.status!=='score_review'||c.participants[0]!==uid;
    select('[data-op="dispute"]').hidden=!['in_progress','round_pending','final_pending'].includes(c?.status);
    select('[data-op="getChallenge"]').hidden=!c&&!view.pending&&!savedId(uid);
    const boards=select('.scoreboards');boards.replaceChildren();boards.hidden=!['in_progress','round_pending','final_pending','score_review','completed','disputed'].includes(c?.status);
    for(const [index,player] of (c?.participants||[]).entries()){
      const panel=document.createElement('div');panel.className='player-score';
      const name=document.createElement('h3');name.textContent=player===uid?'我方':'對方';panel.append(name);
      const score=document.createElement('div');score.className='points';score.textContent=String(c.score[index===0?'a':'b']);panel.append(score);
      for(const [finish,label] of [['spin','旋轉 +1'],['knockout','擊飛 +2'],['burst','爆裂 +2'],['extreme','極限 +3']]){
        const button=document.createElement('button');button.type='button';button.dataset.op='recordRound';button.dataset.player=String(index);button.dataset.finish=finish;button.textContent=label;button.hidden=!['in_progress','score_review'].includes(c.status)||!!c.pendingRound||Math.max(c.score.a,c.score.b)>=c.rules.targetScore||c.participants[0]!==uid;panel.append(button);
      }
      boards.append(panel);
    }
    select('.round').hidden=!c||!c.rounds.length&&!c.pendingRound;select('.policy').hidden=!c;
    if(c){saveId(uid,c.challengeId);if(c.status!=='proposed'){select('.qr').replaceChildren();select('.pairing-share').hidden=true;select('.pairing-code').textContent='';}}
    for(const button of app.querySelectorAll('[data-op]')){
      const op=button.dataset.op;if(op==='logout'){button.disabled=false;continue;}if(op==='retry')button.hidden=!view.pending;
      const active=c&&!['completed','disputed','cancelled','expired','rejected'].includes(c.status);
      button.disabled=!uid||!!view.busy||(!!view.pending&&!['retry','getChallenge','stopScan'].includes(op))||
        (op==='retry'&&!view.pending)||(op==='getChallenge'&&!c&&!view.pending?.input.challengeId&&!savedId(uid))||
        (op==='undoRound'&&(c?.participants[0]!==uid||!['in_progress','round_pending','final_pending','score_review'].includes(c?.status)||(!c?.pendingRound&&!c?.rounds.length)))||
        (op==='resumeReview'&&(c?.status!=='score_review'||c.participants[0]!==uid))||
        (op==='createChallenge'&&active)||(['accept','acceptCode'].includes(op)&&active)||(op==='start'&&(c?.status!=='accepted'||c.ready.includes(uid)))||
        (op==='proposeRound'&&c?.status!=='in_progress')||(op==='recordRound'&&(!['in_progress','score_review'].includes(c?.status)||!!c?.pendingRound||Math.max(c?.score.a||0,c?.score.b||0)>=c?.rules.targetScore))||(op==='confirmRound'&&(c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid)))||
        (op==='confirmFinish'&&(c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid)))||
        (op==='dispute'&&!['in_progress','round_pending','final_pending'].includes(c?.status))||(op==='reject'&&(c?.status!=='accepted'||c.participants[0]===uid))||(op==='cancel'&&!active);
    }
  }
  const unsubscribe=runtime.watch(user=>{
    const uid=user?.uid||null;if(uid!==previousUid){clearPairing();if(previousUid)saveId(previousUid,null);previousUid=uid;client.setSession(uid);}
    if(uid){message('');const id=savedId(uid);if(id&&!view.busy&&!view.snapshot)client.read(id).catch(()=>{if(view.uid===uid)message('無法恢復對戰，請按刷新或重送原操作。');});}
    else{client.setSession(null);message('請登入你的測試帳號。');}
  });
  select('#login').addEventListener('submit',async event=>{event.preventDefault();if(loginBusy)return;loginBusy=true;const button=select('#login button');button.disabled=true;
    try{const email=select('[name="email"]').value.trim();await runtime.login(email,select('[name="password"]').value);try{if(select('[name="remember"]').checked)accountStorage?.setItem(accountKey,email);else accountStorage?.removeItem(accountKey);}catch{}}
    catch{message('登入失敗，請確認測試帳號及密碼。');}finally{select('[name="password"]').value='';loginBusy=false;button.disabled=false;}
  });
  app.addEventListener('click',async event=>{
    const action=event.target.closest('[data-op]');const op=action?.dataset.op;if(!op||action.disabled)return;const uid=view.uid;if(op==='stopScan'){scanner.stop();scanning=false;render();return;}
    if(op==='join'){joining=true;render();return;}
    if(op==='back'){goHome();return;}
    if(op==='logout'){clearPairing();if(uid)saveId(uid,null);client.dispose();try{await runtime.logout();}catch{message('登出未完成，請重新整理後確認。');}return;}
    if(!uid||view.busy)return;
    if(op==='scan'){scanning=true;scanFound=false;render();try{await scanner.start();}catch{if(view.uid===uid){scanning=false;render();message('無法使用相機，請允許權限或輸入 4 碼配對。');}}return;}
    try{
      let result;if(op==='retry')result=await client.retry();
      else if(op==='getChallenge')result=await client.read(view.snapshot?.challengeId||view.pending?.input.challengeId||savedId(uid));
      else{const c=view.snapshot;let input;if(op==='createChallenge')input={};else if(op==='acceptCode')input={pairingCode:select('[name="pairingCode"]').value,expectedRevision:0};else if(op==='accept')input={...parsePairingPayload(select('textarea').value),expectedRevision:0};
        else{if(!c)throw Error('challenge-required');input={challengeId:c.challengeId,expectedRevision:c.revision};
          if(['proposeRound','recordRound'].includes(op)){input.winnerUid=c.participants[Number(action.dataset.player)];input.finish=action.dataset.finish;}
          if(op==='confirmRound')input.roundRevision=c.pendingRound?.roundRevision;if(op==='confirmFinish')input.resultRevision=c.resultRevision;}
        result=await client.mutate(op,input);}
      if(view.uid!==uid||!result)return;
      if(op==='cancel'){goHome();return;}
      if(['accept','acceptCode'].includes(op)){clearPairing();render();}
      if(result.pairingToken){const payload=pairingPayload(result.challenge.challengeId,result.pairingToken);select('textarea').value=payload;select('.pairing-share').hidden=false;select('.pairing-code').textContent=result.pairingCode||'';select('.pairing-expiry').textContent='配對期限：'+new Date(result.challenge.expiresAt).toLocaleTimeString()+'，成功配對後失效。';renderPairingQr(select('.qr'),payload,globalThis.QRCode);}
      message(result.pairingToken?'':'操作已完成。');
    }catch(error){if(view.uid!==uid)return;message(view.pending?'操作結果尚未確認，請重送原操作。':error.message==='revision-conflict'?'狀態已更新，請先刷新。':error.message==='pairing-rate-limited'?'輸入序號次數過多，請稍候一分鐘再試。':error.message==='closed'?'測試站對戰功能尚未開啟，暫時無法建立或接受挑戰。':error.message==='pairing-unavailable'?'配對資料無效、已使用或已失效，請對手重新建立挑戰。':error.message==='account-unavailable'?'此帳號沒有內測授權，請聯絡測試主持者。':'操作未完成，請刷新並確認配對資料或目前狀態。');}
  });
  const stop=()=>{scanner.stop();scanning=false;render();};const synchronize=()=>{const c=view.snapshot;if(!document.hidden&&view.uid&&c&&!view.busy&&!view.pending&&!['completed','disputed','cancelled','expired','rejected'].includes(c.status))client.sync(c.challengeId).catch(()=>{});};
  const syncTimer=setInterval(synchronize,1500);
  const background=()=>{if(document.hidden)stop();else synchronize();};addEventListener('pagehide',stop);document.addEventListener('visibilitychange',background);
  render();return{dispose(){unsubscribe();clearInterval(syncTimer);stop();client.dispose();app.replaceChildren();removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',background);}};
}

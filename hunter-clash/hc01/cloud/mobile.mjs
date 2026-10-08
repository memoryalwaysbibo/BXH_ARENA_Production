import{createController}from'../controller.mjs';
import{pairingPayload,parsePairingPayload,renderPairingQr}from'../pairing.mjs';
import{createScanner}from'../scanner.mjs';
const labels={proposed:'等待對手配對',accepted:'配對成功，等待確認開賽',in_progress:'對戰中',round_pending:'等待本局確認',game_pending:'本場結束，可繼續下一場',final_pending:'等待完賽確認',completed:'完賽紀錄已保存',disputed:'有爭議，保留紀錄',score_review:'請核對比分',cancelled:'已取消',expired:'配對已過期',rejected:'已拒絕'};
export function mountMobile(root,runtime,{storage=sessionStorage,accountStorage=globalThis.localStorage}={}){
  const app=root.querySelector('#app'),message=text=>root.querySelector('#message').textContent=text;
  app.innerHTML=`<form id="login"><section><h2>內測帳號登入</h2><label>玩家名稱<input name="playerName" autocomplete="nickname" maxlength="40" placeholder="對戰時顯示的名稱" required></label><label>電子郵件<input name="email" type="email" autocomplete="username" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><label class="remember"><input name="remember" type="checkbox">記憶帳號</label><button type="submit">登入</button><p>帳號由測試主持者提供。</p></section></form><section id="identity" hidden><span class="account-dot" aria-hidden="true"></span><span id="who"></span><button type="button" data-op="logout">登出</button></section><section id="match" hidden><div class="match-heading"><div class="state"></div><span class="sync-label">自動同步</span></div><div class="welcome"><h2>下一場，換你上場。</h2><p>建立挑戰，或加入對手的挑戰。</p></div><div class="score">0 : 0</div><p class="round"></p><small class="policy"></small><div class="pairing-share" hidden><h3>邀請對手加入</h3><p>請對手掃描 QR，或輸入下方 4 碼。</p><div class="qr"></div><strong class="pairing-code"></strong><p class="pairing-expiry"></p></div><div class="room-options"><label>對練場次<input name="matchCount" type="number" min="1" max="100" placeholder="未填預設 1 場"></label><label class="remember"><input name="practice" type="checkbox">循環練習（每房最多 100 場）</label></div><div class="home-actions row"><button data-op="createChallenge"><span class="entrance-art entrance-create" aria-hidden="true"><img src="./cloud/entrance-cards-v2.png" alt=""></span><strong>建立挑戰</strong><small>出示 QR 與 4 碼</small></button><button data-op="join"><span class="entrance-art entrance-join" aria-hidden="true"><img src="./cloud/entrance-cards-v2.png" alt=""></span><strong>加入挑戰</strong><small>掃碼或輸入序號</small></button></div><div class="join-panel" hidden><h3>加入挑戰</h3><div class="camera" hidden><video playsinline muted></video><p>將對手的 QR 放入畫面即可掃描</p></div><button data-op="scan" hidden>重新啟動掃描</button><canvas hidden></canvas><p class="divider">或輸入 4 碼</p><label>配對序號<input name="pairingCode" placeholder="例如 A7K3" autocomplete="off" autocapitalize="characters" maxlength="4"></label><button data-op="acceptCode">確認加入</button><div class="scan-confirm" hidden><p>已辨識挑戰 QR，確認加入此挑戰？</p><button data-op="accept">確認加入</button></div><textarea hidden></textarea><button data-op="back">返回</button></div><div class="pairing-actions row"><button data-op="start">確認開賽</button><button data-op="reject">拒絕配對</button></div><p class="ready-help" hidden></p><button class="flow-back" data-op="cancel">返回</button><details class="more-actions"><summary>更多操作</summary><div class="row"><button data-op="getChallenge">重新同步</button></div></details><button data-op="retry" hidden>重送原操作</button><div class="scoreboards"></div><p class="confirmation-wait" role="status" aria-live="polite" hidden></p><p class="review-help" hidden></p><button data-op="undoRound">撤銷上一筆得分</button><button data-op="resumeReview">比分已核對，繼續</button><div class="series-actions row"><button data-op="nextGame">下一場</button><button data-op="endSession">結束對練</button></div><div class="session-results"></div><p class="score-help">建立挑戰者替雙方記分，比分自動同步；整場結束後雙方確認結果。</p><div class="row"><button data-op="confirmRound">確認本局</button><button data-op="confirmFinish">確認完賽</button><button data-op="dispute">有爭議</button></div></section><section id="history" hidden><details><summary>我的 PK 戰績</summary><p class="history-status" role="status"></p><div class="history-stats"></div><p class="history-note">僅計入雙方確認完賽的 PK；明細顯示最近 50 場。</p><div class="history-list"></div><button data-op="history">更新戰績</button></details></section>`;
  const select=s=>app.querySelector(s),video=select('video');let view={},previousUid=null,loginBusy=false,joining=false,scanning=false,scanFound=false,swapped=false,historyEpoch=0,historyRequest=null,historyCompletion=null;
  const accountKey='hc01:remembered-email',nameKey='hc01:remembered-name';
  const playerName=()=>select('[name="playerName"]').value.trim()||runtime.auth?.currentUser?.displayName||'未設定名稱';
  try{const email=accountStorage?.getItem(accountKey);if(email){select('[name="email"]').value=email;select('[name="remember"]').checked=true;select('[name="playerName"]').value=accountStorage?.getItem(nameKey)||'';}}catch{}
  select('[name="remember"]').addEventListener('change',()=>{if(!select('[name="remember"]').checked)try{accountStorage?.removeItem(accountKey);accountStorage?.removeItem(nameKey);}catch{}});
  select('[name="practice"]').addEventListener('change',render);
  const savedKey=uid=>'hc01:mobile:last:'+uid;
  const savedId=uid=>{try{return storage?.getItem(savedKey(uid));}catch{return null;}};
  const saveId=(uid,id)=>{try{if(id)storage?.setItem(savedKey(uid),id);else storage?.removeItem(savedKey(uid));}catch{}};
  const clearPairing=()=>{scanner.stop();scanning=false;scanFound=false;joining=false;swapped=false;video.hidden=true;select('textarea').value='';select('.qr').replaceChildren();select('.pairing-share').hidden=true;select('.pairing-code').textContent='';select('[name="pairingCode"]').value='';};
  const scanner=createScanner({video,canvas:select('canvas'),onPairing:found=>{select('textarea').value=found.payload;scanning=false;scanFound=true;render();message('配對碼已辨識，請確認加入挑戰。');},onMessage:message});
  const client=createController({transport:runtime.transport,storage,onChange:next=>{view=next;render();const c=next.snapshot;if(c?.status==='completed'&&historyCompletion!==c.challengeId){historyCompletion=c.challengeId;refreshHistory();}}});
  const goHome=()=>{saveId(view.uid,null);clearPairing();client.setSession(view.uid);message('');};
  function render(){
    const c=view.snapshot,uid=view.uid;
    const waiting=c?.status==='final_pending'&&c.finishConfirmedBy.includes(uid);
    select('#history').hidden=!uid;select('#login').hidden=!!uid;select('#identity').hidden=!uid;select('#match').hidden=!uid;select('#who').textContent=uid?(c?.participantNames?.[uid]||playerName()):'';
    select('.state').textContent=waiting?'等待對方確認中':c?(labels[c.status]||c.status):view.pending?'操作待確認':'準備對戰';
    select('.state').dataset.revision=c?String(c.revision):'';
    select('.confirmation-wait').hidden=!waiting;
    select('.confirmation-wait').textContent=waiting?'你已確認比分，等待 '+(c.participantNames?.[c.participants.find(player=>player!==uid)]||'對方')+' 確認中。完成後會自動顯示結果。':'';
    select('.welcome').hidden=!!c||joining||!!view.pending;
    select('.sync-label').hidden=!c||['completed','disputed','cancelled','expired','rejected'].includes(c.status);
    select('.more-actions').hidden=!c&&!view.pending;
    select('#match').dataset.stage=c?.status||(joining?'joining':'home');
    select('.score').textContent=c?c.score.a+' : '+c.score.b:'0 : 0';
    select('.round').textContent=c?.pendingRound?'第 '+c.pendingRound.number+' 局：'+(c.participantNames?.[c.pendingRound.winnerUid]||'未設定名稱')+' 得 '+c.pendingRound.points+' 分，等待另一方確認。':c?'已記錄 '+c.rounds.length+' 局':'';
    select('.policy').textContent=c?'一般對戰 · '+c.rules.targetScore+' 分勝 · 第 '+(c.gameNumber||1)+' / '+(c.matchCount===0?'循環':c.matchCount||1)+' 場':'';
    const active=c&&!['completed','disputed','cancelled','expired','rejected'].includes(c.status);
    if(active)joining=false;
    select('.home-actions').hidden=!!active||joining;select('.room-options').hidden=!!active||joining;
    select('[name="matchCount"]').disabled=select('[name="practice"]').checked;
    select('.join-panel').hidden=!joining||!!active;
    select('.camera').hidden=!scanning;video.hidden=!scanning;
    select('.scan-confirm').hidden=!scanFound;
    select('[data-op="scan"]').hidden=!joining||scanning||scanFound;
    select('[data-op="acceptCode"]').hidden=scanFound;
    select('[name="pairingCode"]').closest('label').hidden=scanFound;
    select('[data-op="start"]').hidden=c?.status!=='accepted';
    select('[data-op="reject"]').hidden=c?.status!=='accepted'||c.participants[0]===uid;
    select('[data-op="cancel"]').hidden=!active||waiting;
    select('.ready-help').hidden=c?.status!=='accepted';
    select('.ready-help').textContent=c?.ready.includes(uid)?'已確認開賽，等待對手確認。':'對手已加入。雙方確認開賽後開始計分。';
    select('.score').hidden=!c||['proposed','accepted'].includes(c.status);
    select('.score-help').hidden=waiting||!['in_progress','game_pending','final_pending'].includes(c?.status);
    select('.score-help').textContent=c&&(c.matchCount??1)!==1?'每場比分自動保存；按下一場繼續，整組結束後雙方確認才計入戰績。':'建立挑戰者替雙方記分，比分自動同步；整場結束後雙方確認結果。';
    select('[data-op="confirmRound"]').hidden=c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid);
    select('[data-op="confirmFinish"]').hidden=c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid);
    select('.review-help').hidden=c?.status!=='score_review';
    select('.review-help').textContent=c?.participants[0]===uid?'對戰保留中。請核對比分，可撤銷誤記得分後重新記分；核對完成再繼續。':'對戰保留中，等待記分方核對修正；完賽仍需雙方重新確認。';
    select('[data-op="undoRound"]').hidden=waiting||c?.participants[0]!==uid||!['in_progress','round_pending','game_pending','final_pending','score_review'].includes(c?.status);
    select('[data-op="resumeReview"]').hidden=c?.status!=='score_review'||c.participants[0]!==uid;
    select('[data-op="dispute"]').hidden=waiting||!['in_progress','round_pending','game_pending','final_pending'].includes(c?.status);
    select('[data-op="getChallenge"]').hidden=!c&&!view.pending&&!savedId(uid);
    select('[data-op="nextGame"]').hidden=c?.status!=='game_pending'||c.participants[0]!==uid;
    select('[data-op="endSession"]').hidden=c?.status!=='game_pending'||c.participants[0]!==uid;
    select('[data-op="confirmFinish"]').textContent=c&&(c.matchCount??1)!==1?'確認整組結果':'確認完賽';
    const results=select('.session-results');results.replaceChildren();results.hidden=!c||(c.matchCount??1)===1;
    if(c){for(const game of [...(c.games||[]),...(c.winnerUid?[{number:c.gameNumber||1,score:c.score}]:[])]){const line=document.createElement('p');line.textContent='第 '+game.number+' 場：'+(c.participantNames?.[c.participants[0]]||'未設定名稱')+' '+game.score.a+' : '+game.score.b+' '+(c.participantNames?.[c.participants[1]]||'未設定名稱');results.append(line);}}
    const boards=select('.scoreboards');boards.replaceChildren();boards.hidden=!['in_progress','round_pending','game_pending','final_pending','score_review','completed','disputed'].includes(c?.status);
    const players=Array.from((c?.participants||[]).entries());if(swapped)players.reverse();
    for(const [position,[index,player]] of players.entries()){
      if(position===1){const exchange=document.createElement('button');exchange.type='button';exchange.className='exchange';exchange.dataset.op='exchange';exchange.textContent='⇄';exchange.setAttribute('aria-label','交換左右玩家');boards.append(exchange);}
      const panel=document.createElement('div');panel.className='player-score';
      const name=document.createElement('h3');name.textContent=c.participantNames?.[player]||(player===uid?playerName():'未設定名稱');panel.append(name);
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
        (op==='undoRound'&&(c?.participants[0]!==uid||!['in_progress','round_pending','game_pending','final_pending','score_review'].includes(c?.status)||(!c?.pendingRound&&!c?.rounds.length)))||
        (op==='resumeReview'&&(c?.status!=='score_review'||c.participants[0]!==uid))||
        (op==='createChallenge'&&active)||(['accept','acceptCode'].includes(op)&&active)||(op==='start'&&(c?.status!=='accepted'||c.ready.includes(uid)))||
        (op==='proposeRound'&&c?.status!=='in_progress')||(op==='recordRound'&&(!['in_progress','score_review'].includes(c?.status)||!!c?.pendingRound||Math.max(c?.score.a||0,c?.score.b||0)>=c?.rules.targetScore))||(op==='confirmRound'&&(c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid)))||
        (op==='confirmFinish'&&(c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid)))||
        (op==='dispute'&&!['in_progress','round_pending','game_pending','final_pending'].includes(c?.status))||(op==='reject'&&(c?.status!=='accepted'||c.participants[0]===uid))||(op==='cancel'&&!active);
    }
  }
  function clearHistory(){historyEpoch++;historyRequest?.abort();historyRequest=null;historyCompletion=null;select('.history-list').replaceChildren();select('.history-stats').replaceChildren();select('.history-status').textContent='';}
  async function refreshHistory(){
    const uid=view.uid;if(!uid)return;
    historyRequest?.abort();const request=new AbortController(),epoch=++historyEpoch;historyRequest=request;
    select('.history-status').textContent='載入戰績中…';
    try{
      const result=await runtime.transport('getMyHistory',{},{uid,signal:request.signal});
      if(epoch!==historyEpoch||view.uid!==uid)return;
      const h=result.history;select('.history-stats').textContent=h.total+' 場 · '+h.wins+' 勝 '+h.losses+' 敗 · 勝率 '+(h.total?Math.round(h.wins/h.total*100)+'%':'—');
      const list=select('.history-list');list.replaceChildren();
      for(const m of h.matches){
        const card=document.createElement('article');card.className='history-match';
        const names=document.createElement('strong');names.textContent=m.playerName+' vs '+m.opponentName;
        const score=document.createElement('span');score.className=m.won?'history-win':'history-loss';score.textContent=(m.won?'勝':'敗')+' '+m.score+' : '+m.opponentScore;
        const date=document.createElement('small');date.textContent=new Date(m.completedAt).toLocaleString('zh-TW')+' · 第 '+(m.gameNumber||1)+' 場';card.append(names,score,date);list.append(card);
      }
      select('.history-status').textContent=h.total?'':'尚無已確認的 PK 戰績。';
    }catch{if(epoch===historyEpoch&&view.uid===uid)select('.history-status').textContent='戰績更新未完成，請按更新戰績重試。';}
    finally{if(historyRequest===request)historyRequest=null;}
  }
  const unsubscribe=runtime.watch(user=>{
    const uid=user?.uid||null;if(uid!==previousUid){clearHistory();clearPairing();if(previousUid)saveId(previousUid,null);previousUid=uid;client.setSession(uid);}
    if(uid){refreshHistory();message('');const id=savedId(uid);if(id&&!view.busy&&!view.snapshot)client.read(id).catch(()=>{if(view.uid===uid)message('無法恢復對戰，請按刷新或重送原操作。');});}
    else{client.setSession(null);message('請登入你的測試帳號。');}
  });
  select('#login').addEventListener('submit',async event=>{event.preventDefault();if(loginBusy)return;loginBusy=true;const button=select('#login button');button.disabled=true;
    try{const email=select('[name="email"]').value.trim();await runtime.login(email,select('[name="password"]').value);try{if(select('[name="remember"]').checked){accountStorage?.setItem(accountKey,email);accountStorage?.setItem(nameKey,playerName());}else{accountStorage?.removeItem(accountKey);accountStorage?.removeItem(nameKey);}}catch{}}
    catch{message('登入失敗，請確認測試帳號及密碼。');}finally{select('[name="password"]').value='';loginBusy=false;button.disabled=false;}
  });
  async function startScan(){const uid=view.uid;scanning=true;scanFound=false;render();try{await scanner.start();}catch{if(view.uid===uid&&joining&&scanning){scanning=false;render();message('無法使用相機，可直接輸入 4 碼，或允許相機權限後重新啟動掃描。');}}}
  app.addEventListener('click',async event=>{
    const action=event.target.closest('[data-op]');const op=action?.dataset.op;if(!op||action.disabled)return;const uid=view.uid;if(op==='stopScan'){scanner.stop();scanning=false;render();return;}
    if(['nextGame','endSession'].includes(op)&&view.snapshot?.status!=='game_pending')return;
    if(op==='history'){refreshHistory();return;}
    if(op==='exchange'){swapped=!swapped;render();return;}
    if(op==='join'){joining=true;await startScan();return;}
    if(op==='back'){goHome();return;}
    if(op==='logout'){clearHistory();clearPairing();if(uid)saveId(uid,null);client.dispose();try{await runtime.logout();}catch{message('登出未完成，請重新整理後確認。');}return;}
    if(!uid||view.busy)return;
    if(op==='scan'){await startScan();return;}
    if(op==='createChallenge'&&!select('[name="practice"]').checked){const count=select('[name="matchCount"]').value===''?1:Number(select('[name="matchCount"]').value);if(!Number.isSafeInteger(count)||count<1||count>100){message('場次請輸入 1 到 100 的整數，留白預設一場。');return;}}
    if(['accept','acceptCode'].includes(op)){scanner.stop();scanning=false;render();}
    try{
      let result;if(op==='retry')result=await client.retry();
      else if(op==='getChallenge')result=await client.read(view.snapshot?.challengeId||view.pending?.input.challengeId||savedId(uid));
      else{const c=view.snapshot;let input;if(op==='createChallenge')input={playerName:playerName(),matchCount:select('[name="practice"]').checked?0:select('[name="matchCount"]').value===''?1:Number(select('[name="matchCount"]').value)};else if(op==='acceptCode')input={pairingCode:select('[name="pairingCode"]').value,expectedRevision:0,playerName:playerName()};else if(op==='accept')input={...parsePairingPayload(select('textarea').value),expectedRevision:0,playerName:playerName()};
        else{if(!c)throw Error('challenge-required');input={challengeId:c.challengeId,expectedRevision:c.revision};
          if(['proposeRound','recordRound'].includes(op)){input.winnerUid=c.participants[Number(action.dataset.player)];input.finish=action.dataset.finish;}
          if(op==='confirmRound')input.roundRevision=c.pendingRound?.roundRevision;if(op==='confirmFinish')input.resultRevision=c.resultRevision;}
        result=await client.mutate(op,input);}
      if(view.uid!==uid||!result)return;
      if(op==='cancel'){goHome();return;}
      if(['accept','acceptCode'].includes(op)){clearPairing();render();}
      if(result.pairingToken){const payload=pairingPayload(result.challenge.challengeId,result.pairingToken);select('textarea').value=payload;select('.pairing-share').hidden=false;select('.pairing-code').textContent=result.pairingCode||'';select('.pairing-expiry').textContent='配對期限：'+new Date(result.challenge.expiresAt).toLocaleTimeString()+'，成功配對後失效。';renderPairingQr(select('.qr'),payload,globalThis.QRCode);}
      message(result.pairingToken?'':result.challenge?.status==='final_pending'&&result.challenge.finishConfirmedBy.includes(uid)?'已確認比分，等待對方確認中。':'操作已完成。');
    }catch(error){if(view.uid!==uid)return;message(view.pending?'操作結果尚未確認，請重送原操作。':error.message==='revision-conflict'?'狀態已更新，請先刷新。':error.message==='pairing-rate-limited'?'輸入序號次數過多，請稍候一分鐘再試。':error.message==='closed'?'測試站對戰功能尚未開啟，暫時無法建立或接受挑戰。':error.message==='pairing-unavailable'?'配對資料無效、已使用或已失效，請對手重新建立挑戰。':error.message==='account-unavailable'?'此帳號沒有內測授權，請聯絡測試主持者。':'操作未完成，請刷新並確認配對資料或目前狀態。');}
  });
  const stop=()=>{scanner.stop();scanning=false;render();};const synchronize=()=>{const c=view.snapshot;if(!document.hidden&&view.uid&&c&&!view.busy&&!view.pending&&!['completed','disputed','cancelled','expired','rejected'].includes(c.status))client.sync(c.challengeId).catch(()=>{});};
  const syncTimer=setInterval(synchronize,1500);
  const background=()=>{if(document.hidden)stop();else synchronize();};addEventListener('pagehide',stop);document.addEventListener('visibilitychange',background);
  render();return{dispose(){clearHistory();unsubscribe();clearInterval(syncTimer);stop();client.dispose();app.replaceChildren();removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',background);}};
}

import{createAchievementFeedback}from'./achievement-feedback.mjs?v=20261010-pk-feedback-1';
import{createRecoveryStore,terminalStatus}from'./recovery.mjs?v=20261009-recovery-exit-2';
import{createController}from'./controller.mjs?v=20261009-recovery-exit-2';
import{pairingPayload,parsePairingPayload,renderPairingQr}from'./pairing.mjs';
import{createScanner}from'./scanner.mjs';
const labels={proposed:'等待對手配對',accepted:'配對成功，等待確認開賽',in_progress:'對戰中',round_pending:'等待本局確認',game_pending:'本場結束，可繼續下一場',final_pending:'等待完賽確認',completed:'完賽紀錄已保存',revoked:'紀錄已撤銷',disputed:'有爭議，保留紀錄',score_review:'請核對比分',cancelled:'已取消',expired:'配對已過期',rejected:'已拒絕'};
const finishLabels={extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'};
export function roomPlayerStats(c,games,player){
  const types=Object.keys(finishLabels),opponent=c.participants.find(uid=>uid!==player);
  const attack=Object.fromEntries(types.map(type=>[type,0])),defense=Object.fromEntries(types.map(type=>[type,0]));
  const attackCount=Object.fromEntries(types.map(type=>[type,0])),defenseCount=Object.fromEntries(types.map(type=>[type,0]));
  for(const game of games)for(const round of game.rounds||[]){
    if(!types.includes(round.finish)||!Number.isFinite(round.points))continue;
    if(round.winnerUid===player){attack[round.finish]+=round.points;attackCount[round.finish]++;}
    else if(round.winnerUid===opponent){defense[round.finish]+=round.points;defenseCount[round.finish]++;}
  }
  const totalFor=types.reduce((sum,type)=>sum+attack[type],0),totalAgainst=types.reduce((sum,type)=>sum+defense[type],0);
  const ranked=types.map(type=>({type,points:attack[type],share:totalFor?Math.round(attack[type]/totalFor*100):0})).sort((a,b)=>b.points-a.points);
  const top=ranked[0],second=ranked[1];
  const style=!totalFor?'得分模式待建立':top.points===second.points?'複合均衡型':top.share>=45?{extreme:'極限突擊型',knockout:'擊飛壓制型',burst:'爆裂破壞型',spin:'持久轉停型'}[top.type]:Math.abs(top.share-second.share)<=10?'複合均衡型':'複合攻勢型';
  const leading=(bucket,total,prefix='')=>{const max=Math.max(...Object.values(bucket));return total?types.filter(type=>bucket[type]===max).map(type=>prefix+finishLabels[type]+' '+Math.round(max/total*100)+'%（'+max+' 分）').join('、'):'本輪尚無'+(prefix?'失分':'得分');};
  const wins=games.filter(game=>game.winnerUid===player).length,losses=games.length-wins;
  const efficiency=totalFor+totalAgainst?Math.round(totalFor/(totalFor+totalAgainst)*100):0;
  const summary=wins===games.length?'本輪全勝，已將得分轉成勝場。':wins===0?(totalFor?'尚未拿下勝場，但已有得分；可回看比分接近的場次。':'本輪尚未取得得分，先以建立有效得分回合為目標。'):wins>losses?(efficiency<50?'勝場領先，但總得分落後；可回看失分較多的敗局。':'勝場領先，得分占比也達到一半以上。'):wins===losses?'本輪勝敗相當，可比較勝局與敗局的得失分方式。':efficiency>=50?'勝場較少，但總得分不低於對手；可回看未能拿下的場次。':'本輪勝場與總得分較少，先找出最常見的失分方式。';
  const maxLoss=Math.max(...Object.values(defense)),lossTypes=types.filter(type=>defense[type]===maxLoss);
  const advice=totalAgainst?'下一輪可優先回看「被'+lossTypes.map(type=>finishLabels[type]).join('／被')+'」的回合，記下當時配置與情境，再比較調整後的失分次數。':'本輪沒有失分；可更換對手或配置，觀察得分方式是否仍能維持。';
  const maxAttack=Math.max(...Object.values(attack)),mainTypes=types.filter(type=>attack[type]===maxAttack);
  const scoreComment=!totalFor?'本輪尚無得分。':mainTypes.length>1?'本輪'+mainTypes.map(type=>finishLabels[type]).join('與')+'取得分數並列，得分來源較多元。':'本輪主要得分來自'+finishLabels[mainTypes[0]]+'。';
  const countMax=Math.max(...Object.values(attackCount)),frequentTypes=types.filter(type=>attackCount[type]===countMax);
  const frequentText=totalFor?frequentTypes.map(type=>finishLabels[type]+' '+countMax+' 次').join('、'):'本輪尚無得分';
  const breakdown=types.map(type=>finishLabels[type]+' '+attackCount[type]+' 次／'+attack[type]+' 分／'+(totalFor?Math.round(attack[type]/totalFor*100):0)+'%').join('；');
  let firstTotal=0,firstWins=0,ledGames=0,lostLead=0,trailedGames=0,comebacks=0;
  const positions=[];
  for(const game of games){
    let own=0,other=0,led=false,trailed=false;
    for(const [index,round] of (game.rounds||[]).entries()){
      if(!types.includes(round.finish)||!Number.isFinite(round.points)||![player,opponent].includes(round.winnerUid))continue;
      const won=round.winnerUid===player;
      if(index===0){firstTotal++;if(won)firstWins++;}
      positions[index]??={number:index+1,total:0,losses:0};positions[index].total++;if(!won)positions[index].losses++;
      if(won)own+=round.points;else other+=round.points;
      // Only a lead/deficit before the deciding score describes a comeback opportunity.
      if(index<(game.rounds||[]).length-1){if(own>other)led=true;if(own<other)trailed=true;}
    }
    if(led){ledGames++;if(game.winnerUid===opponent)lostLead++;}
    if(trailed){trailedGames++;if(game.winnerUid===player)comebacks++;}
  }
  const eligible=positions.filter(position=>position&&position.total>=5);
  const highest=eligible.length?Math.max(...eligible.map(position=>position.losses/position.total)):0;
  const concentrated=eligible.filter(position=>position.losses>0&&Math.abs(position.losses/position.total-highest)<1e-9);
  const positionText=concentrated.length?concentrated.map(position=>'第 '+position.number+' 回合失分 '+position.losses+'／'+position.total+' 場（'+Math.round(position.losses/position.total*100)+'%）').join('；')+(concentrated.length>1?'，失分率並列。':'，為本輪失分率最高的回合。'):eligible.length?'符合樣本門檻的回合沒有失分。':'資料不足：各回合至少需有 5 場到達，才比較失分率。';
  const firstText=firstTotal>=5?'首回合得分 '+firstWins+'／'+firstTotal+' 場（'+Math.round(firstWins/firstTotal*100)+'%）。':'首回合樣本不足（'+firstTotal+'／5 場）。';
  const leadText='曾領先 '+ledGames+' 場，其中 '+lostLead+' 場最後落敗。';
  const comebackText='曾落後 '+trailedGames+' 場，其中 '+comebacks+' 場逆轉獲勝。';
  return {mainFinish:totalFor?mainTypes.map(type=>finishLabels[type]).join("／"):"尚無得分",attackCount,defenseCount,scoreComment,frequentText,breakdown,firstText,positionText,leadText,comebackText,attack,defense,totalFor,totalAgainst,style,efficiency,summary,advice,attackText:leading(attack,totalFor),defenseText:leading(defense,totalAgainst,'被')};
}
export function mountMobile(root,runtime,{storage=sessionStorage,accountStorage=null}={}){
  const app=root.querySelector('#app'),message=text=>root.querySelector('#message').textContent=text;
  app.innerHTML=`<section id="match" hidden><div class="match-heading"><div class="state"></div><span class="sync-label">自動同步</span></div><div class="welcome"><h2>用對戰，證明你的實力。</h2><p>建立對戰，或加入對手的對戰。</p></div><div class="score">0 : 0</div><p class="round"></p><small class="policy"></small><div class="pairing-share" hidden><h3>邀請對手加入</h3><p>請對手掃描 QR，或輸入下方 4 碼。</p><div class="qr"></div><strong class="pairing-code"></strong><p class="pairing-expiry"></p></div><div class="practice-xp"></div><p class="session-xp" role="status" hidden></p><section class="achievement-notice" role="status" aria-live="polite" hidden><strong>新成就解鎖</strong><p></p><button data-op="dismissAchievement">知道了</button></section><div class="room-options"><label>對練場次<input name="matchCount" type="number" min="1" max="100" placeholder="未填預設 1 場"></label><label class="remember"><input name="practice" type="checkbox">循環練習（每房最多 100 場）</label></div><div class="home-actions row"><button data-op="createChallenge"><span class="entrance-art entrance-create" aria-hidden="true"><img src="hunter-clash/arena/entrance-dragon-horn-v4.webp" width="512" height="512" decoding="async" alt=""></span><strong>建立對戰</strong><small>出示 QR 與 4 碼</small></button><button data-op="join"><span class="entrance-art entrance-join" aria-hidden="true"><img src="hunter-clash/arena/entrance-dragon-daggers-v4.webp" width="512" height="512" decoding="async" alt=""></span><strong>加入對戰</strong><small>掃碼或輸入序號</small></button></div><div class="join-panel" hidden><h3>加入對戰</h3><div class="camera" hidden><video playsinline muted></video><p>將對手的 QR 放入畫面即可掃描</p></div><button data-op="scan" hidden>重新啟動掃描</button><canvas hidden></canvas><p class="divider">或輸入 4 碼</p><label>配對序號<input name="pairingCode" placeholder="例如 A7K3" autocomplete="off" autocapitalize="characters" maxlength="4"></label><button data-op="acceptCode">確認加入</button><div class="scan-confirm" hidden><p>已辨識對戰 QR，確認加入此對戰？</p><button data-op="accept">確認加入</button></div><textarea hidden></textarea><button data-op="back">返回</button></div><div class="pairing-actions row"><button data-op="start">確認開賽</button><button data-op="reject">拒絕配對</button></div><p class="ready-help" hidden></p><button class="flow-back" data-op="cancel">返回</button><button class="recovery-link" data-op="resumeSaved" hidden>恢復先前對戰</button><div class="recovery-panel" hidden><p>你有尚未結案的對戰。返回原對戰核對比分並完成確認。</p><div class="row"><button data-op="resume">返回未結案對戰</button><button data-op="recoveryBack">返回</button></div></div><div class="connection-actions row" hidden><button data-op="reconnect">重新同步</button><button data-op="leave">暫時離開</button></div><details class="more-actions"><summary>更多操作</summary><div class="row"><button data-op="getChallenge">重新同步</button></div></details><button data-op="retry" hidden>重送原操作</button><div class="scoreboards"></div><p class="confirmation-wait" role="status" aria-live="polite" hidden></p><p class="review-help" hidden></p><div class="series-actions row"><button data-op="nextGame">下一場</button><button data-op="endSession">結束對練</button></div><button data-op="undoRound">撤銷上一筆得分</button><button data-op="resumeReview">比分已核對，繼續</button><details class="room-analysis" hidden><summary>本輪評價</summary><p class="analysis-description">本房已完成場次的即時分析；八角圖不代表正式執照能力值。</p><div class="analysis-player-tabs" role="group" aria-label="選擇查看的玩家"></div><div class="room-stats" id="room-player-analysis" aria-label="本輪戰績"></div><h3 class="radar-title">即時八角圖</h3><div class="room-radar"></div></details><div class="session-results"></div><p class="score-help">建立對戰者替雙方記分，比分自動同步；整場結束後雙方確認結果。</p><div class="row"><button data-op="confirmRound">確認本局</button><button data-op="confirmFinish">確認完賽</button><button data-op="dispute">有爭議</button></div></section><section id="history" hidden><details><summary>我的 PK 戰績</summary><p class="history-status" role="status"></p><div class="history-stats"></div><p class="pending-history" role="status" hidden></p><p class="history-note">僅計入雙方確認完賽的 PK；由完整分頁帳本核對。</p><div class="pk-achievements"></div><div class="history-list"></div><button data-op="history">更新戰績</button></details></section>`;
  const select=s=>app.querySelector(s),video=select('video');let view={},previousUid=null,loginBusy=false,joining=false,scanning=false,scanFound=false,swapped=false,radarPlayer=0,radarChallengeId=null,analysisOwner=null,historyEpoch=0,historyRequest=null,historyCompletion=null,syncPaused=false,syncFailed=false;
  const accountKey='arena-pk:remembered-email',nameKey='arena-pk:remembered-name';
  const playerName=()=>runtime.playerName();
  select('[name="practice"]').addEventListener('change',render);
  const recovery=createRecoveryStore({session:storage,persistent:accountStorage});
  const savedId=uid=>recovery.id(uid);
  const clearPairing=()=>{scanner.stop();scanning=false;scanFound=false;joining=false;swapped=false;video.hidden=true;select('textarea').value='';select('.qr').replaceChildren();select('.pairing-share').hidden=true;select('.pairing-code').textContent='';select('[name="pairingCode"]').value='';};
  const scanner=createScanner({video,canvas:select('canvas'),onPairing:found=>{select('textarea').value=found.payload;scanning=false;scanFound=true;render();message('配對碼已辨識，請確認加入對戰。');},onMessage:message});
  const feedback=createAchievementFeedback({unlocks:runtime.achievementUnlocks,storage:accountStorage||storage});let achievementNotice=null;
  const client=createController({transport:runtime.transport,storage,onChange:next=>{const c=next.snapshot;if(c?.status==='completed'&&next.uid===view.uid&&view.snapshot?.challengeId===c.challengeId&&view.snapshot.status!=='completed')feedback.arm(next.uid,c.challengeId);view=next;render();if(c?.status==='completed'&&historyCompletion!==c.challengeId){historyCompletion=c.challengeId;refreshHistory();}}});
  let recoveryAttempt=0;
  const goHome=({preserve=false}={})=>{recoveryAttempt++;if(preserve)recovery.dismiss(view.uid);if(!preserve)recovery.clear(view.uid);clearPairing();client.setSession(view.uid);message(preserve?'對戰已保留。可返回原對戰完成確認；暫時離開不代表取消或結案。':'');};
  function render(){
    const c=view.snapshot,uid=view.uid;
    if(c)recovery.remember(uid,c);
    const unresolved=c?!terminalStatus(c.status):!!savedId(uid)&&!recovery.dismissed(uid);
    select('.recovery-link').hidden=!!c||joining||!savedId(uid)||!recovery.dismissed(uid);
    select('.recovery-panel').hidden=!!c||!unresolved;
    select('.connection-actions').hidden=!c||terminalStatus(c.status);
    select('.pending-history').hidden=!unresolved;
    select('.pending-history').textContent=c?.status==='final_pending'?'本房待雙方確認：'+((c.games?.length||0)+1)+' 場，尚未計入已結案戰績。':unresolved?'你有未結案對戰，已結案戰績不包含本房暫存比分。':'';
    select('.sync-label').textContent=syncFailed?'同步失敗，請重新同步':syncPaused?'同步已暫停':'自動同步';
    if(c?.challengeId!==radarChallengeId||uid!==analysisOwner){radarChallengeId=c?.challengeId||null;analysisOwner=uid;radarPlayer=Math.max(0,c?.participants.indexOf(uid)??0);}
    const waiting=c?.status==='final_pending'&&c.finishConfirmedBy.includes(uid);
    select('#history').hidden=!uid;select('#match').hidden=!uid;
    select('.match-heading').hidden=!c&&!view.pending;
    select('.state').textContent=waiting?'等待對方確認中':c?(labels[c.status]||c.status):view.pending?'操作待確認':'';
    select('.state').dataset.revision=c?String(c.revision):'';
    select('.confirmation-wait').hidden=!waiting;
    select('.confirmation-wait').textContent=waiting?'你已確認比分，等待 '+(c.participantNames?.[c.participants.find(player=>player!==uid)]||'對方')+' 確認中。完成後會自動顯示結果。':'';
    select('.welcome').hidden=!!c||joining||!!view.pending;
    select('.sync-label').hidden=!c||['completed','revoked','disputed','cancelled','expired','rejected'].includes(c.status);
    select('.more-actions').hidden=!c&&!view.pending;
    select('#match').dataset.stage=c?.status||(joining?'joining':'home');
    select('.score').textContent=c?c.score.a+' : '+c.score.b:'0 : 0';
    select('.round').textContent=c?.pendingRound?'第 '+c.pendingRound.number+' 局：'+(c.participantNames?.[c.pendingRound.winnerUid]||'未設定名稱')+' 得 '+c.pendingRound.points+' 分，等待另一方確認。':c?'已記錄 '+c.rounds.length+' 局':'';
    select('.practice-xp').innerHTML=runtime.xpHtml?.()||'';
    select('.pk-achievements').innerHTML=runtime.achievementsHtml?.()||'';
    const notice=select('.achievement-notice');notice.hidden=!achievementNotice||achievementNotice.uid!==uid||achievementNotice.challengeId!==c?.challengeId||c?.status!=='completed';notice.querySelector('p').textContent=notice.hidden?'':achievementNotice.names.join('、');
    const reward=c?.practiceXpByPlayer?.[uid],xpLine=select('.session-xp');
    xpLine.hidden=c?.status!=='completed';
    xpLine.textContent=reward?'本房獲得 '+reward.xp+' XP'+(reward.reason==='before-launch'?'（啟用前對戰不補發）':reward.reason==='disabled'?'（發放已暫停）':typeof reward.remainingGames==='number'?' · 結案時今日剩餘 '+reward.remainingGames+' 場額度（仍受同對手限制）':''):'本房已結案；XP 請更新戰績核對。';
    select('.policy').textContent=c?'一般對戰 · '+c.rules.targetScore+' 分勝 · 第 '+(c.gameNumber||1)+' / '+(c.matchCount===0?'循環':c.matchCount||1)+' 場':'';
    const active=c&&!['completed','revoked','disputed','cancelled','expired','rejected'].includes(c.status);
    if(active)joining=false;
    select('.home-actions').hidden=!!active||joining||unresolved;select('.room-options').hidden=!!active||joining||unresolved;
    select('[name="matchCount"]').disabled=select('[name="practice"]').checked;
    select('.join-panel').hidden=!joining||!!active;
    select('.camera').hidden=!scanning;video.hidden=!scanning;
    select('.scan-confirm').hidden=!scanFound;
    select('[data-op="scan"]').hidden=!joining||scanning||scanFound;
    select('[data-op="acceptCode"]').hidden=scanFound;
    select('[name="pairingCode"]').closest('label').hidden=scanFound;
    select('[data-op="start"]').hidden=c?.status!=='accepted';
    select('[data-op="reject"]').hidden=c?.status!=='accepted'||c.participants[0]===uid;
    select('[data-op="cancel"]').hidden=!['proposed','accepted'].includes(c?.status);
    select('.ready-help').hidden=c?.status!=='accepted';
    select('.ready-help').textContent=c?.ready.includes(uid)?'已確認開賽，等待對手確認。':'對手已加入。雙方確認開賽後開始計分。';
    select('.score').hidden=!c||['proposed','accepted'].includes(c.status);
    select('.score-help').hidden=waiting||!['in_progress','game_pending','final_pending'].includes(c?.status);
    select('.score-help').textContent=c&&(c.matchCount??1)!==1?'每場比分暫存於本房；按下一場繼續，整組結束後雙方確認才計入戰績。':'建立對戰者替雙方記分，比分自動同步；整場結束後雙方確認結果。';
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
    const results=select('.session-results'),analysis=select('.room-analysis'),roomStats=select('.room-stats'),radar=select('.room-radar');results.replaceChildren();roomStats.replaceChildren();radar.replaceChildren();
    const games=c?[...(c.games||[]),...(c.winnerUid?[{number:c.gameNumber||1,score:c.score,winnerUid:c.winnerUid,rounds:c.rounds}]:[])]:[];
    results.hidden=!c||(c.matchCount??1)===1;
    analysis.hidden=!c||c.participants.length!==2||['proposed','accepted','cancelled','expired','rejected'].includes(c.status);
    if(c){
      renderPlayerSwitch(c,uid);
      for(const game of games){const line=document.createElement('p');line.textContent='第 '+game.number+' 場：'+(c.participantNames?.[c.participants[0]]||'未設定名稱')+' '+game.score.a+' : '+game.score.b+' '+(c.participantNames?.[c.participants[1]]||'未設定名稱');results.append(line);}
      for(const player of [c.participants[radarPlayer]||c.participants[0]]){
        const wins=games.filter(game=>game.winnerUid===player).length,losses=games.length-wins;
        const card=document.createElement('div');card.className='room-stat';
        const name=document.createElement('strong');name.textContent=c.participantNames?.[player]||'未設定名稱';
        const rate=document.createElement('p');rate.className='room-win-rate';const rateValue=document.createElement('span'),rateCount=document.createElement('span');rateValue.textContent='本輪勝率：'+(games.length?Math.round(wins/games.length*100)+'%':'—');rateCount.className='metric-detail';rateCount.textContent='（'+wins+'勝'+losses+'敗）';rate.append(rateValue,rateCount);
        const stats=roomPlayerStats(c,games,player);
        const evaluation=document.createElement('p');evaluation.className='room-evaluation';evaluation.textContent='評價：'+(games.length<5?'資料不足（滿 5 場後顯示）':(games.length<10?'初步・':'')+stats.style);
        card.append(name,rate,evaluation);roomStats.append(card);
        if(games.length>=5){
          const summary=document.createElement('p');summary.className='room-feedback-summary';summary.textContent=stats.summary;card.append(summary);
          const metrics=document.createElement('dl');metrics.className='room-feedback-metrics';
          for(const [label,value] of [['主要得分',stats.attackText],['主要失分',stats.defenseText],['得分效率',stats.efficiency+'%']]){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;if(label==='得分效率'){const count=document.createElement('span');count.className='metric-detail';count.textContent='（'+stats.totalFor+'得分/'+stats.totalAgainst+'失分）';detail.append(count);}metrics.append(term,detail);}card.append(metrics);
          const scoring=document.createElement('p');scoring.className='room-main-finish';const scoringLabel=document.createElement('span'),scoringValue=document.createElement('span');scoringLabel.textContent='本輪主要得分來自';scoringValue.textContent=stats.mainFinish;scoring.append(scoringLabel,scoringValue);card.append(scoring);
          const details=document.createElement('dl');details.className='room-feedback-metrics';
          for(const [label,value] of [['最常得分方式',stats.frequentText],['首回合表現',stats.firstText],['失分集中回合',stats.positionText],['領先後落敗',stats.leadText],['落後後逆轉',stats.comebackText]]){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;details.append(term,detail);}card.append(details);
          const table=document.createElement('table');table.className='finish-breakdown';
          const caption=document.createElement('caption');caption.textContent='四種得分明細';table.append(caption);
          const head=document.createElement('thead'),heading=document.createElement('tr');
          for(const label of ['方式','次數','累計得分','占比']){const cell=document.createElement('th');cell.scope='col';cell.textContent=label;heading.append(cell);}head.append(heading);table.append(head);
          const body=document.createElement('tbody');
          for(const type of Object.keys(finishLabels)){const row=document.createElement('tr');for(const [index,value] of [finishLabels[type],stats.attackCount[type]+' 次',stats.attack[type]+' 分',(stats.totalFor?Math.round(stats.attack[type]/stats.totalFor*100):0)+'%'].entries()){const cell=document.createElement(index===0?'th':'td');if(index===0)cell.scope='row';cell.textContent=value;row.append(cell);}body.append(row);}table.append(body);card.append(table);
          const advice=document.createElement('p');advice.className='room-feedback-advice';advice.textContent='對練建議：'+stats.advice;card.append(advice);
        }
      }
      const note=document.createElement('p');note.className='room-stats-note';note.textContent=c.status==='completed'?'雙方已確認，本房對戰明細已保存；評價與八角圖由明細即時計算，沒有另存固定報告。':'本輪資料為暫計；雙方確認整組結果後，才保存對戰明細並計入 PK 戰績。';roomStats.append(note);
      const radarTitle=select('.radar-title');radarTitle.hidden=games.length<5;
      if(c.participants.length===2&&games.length>=5)renderRoomRadar(radar,c,games);
      else if(games.length<5){const threshold=document.createElement('p');threshold.className='radar-note';threshold.textContent='已完成 '+games.length+' 場；滿 5 場才顯示初步八角圖，滿 10 場後資料較充分。';radar.append(threshold);}
      if(games.length>=5){const threshold=document.createElement('p');threshold.className='radar-note';threshold.textContent=games.length<10?'目前 '+games.length+' 場，屬初步分析；滿 10 場後資料較充分。':'目前 '+games.length+' 場，已達 10 場分析門檻；僅供本輪參考。';radar.append(threshold);}
    }
    const boards=select('.scoreboards');boards.replaceChildren();boards.hidden=!['in_progress','round_pending','game_pending','final_pending','score_review','completed','disputed'].includes(c?.status);
    const players=Array.from((c?.participants||[]).entries());if(swapped)players.reverse();
    for(const [position,[index,player]] of players.entries()){
      if(position===1){const exchange=document.createElement('button');exchange.type='button';exchange.className='exchange';exchange.dataset.op='exchange';exchange.textContent='⇄';exchange.setAttribute('aria-label','交換左右玩家');boards.append(exchange);}
      const panel=document.createElement('div');panel.className='player-score';
      const name=document.createElement('h3');name.textContent=c.participantNames?.[player]||(player===uid?playerName():'未設定名稱');panel.append(name);
      const score=document.createElement('div');score.className='points';score.textContent=String(c.score[index===0?'a':'b']);panel.append(score);
      for(const [finish,label] of [['spin','轉停 +1'],['knockout','擊飛 +2'],['burst','爆裂 +2'],['extreme','極限 +3']]){
        const button=document.createElement('button');button.type='button';button.dataset.op='recordRound';button.dataset.player=String(index);button.dataset.finish=finish;button.textContent=label;button.hidden=!['in_progress','score_review'].includes(c.status)||!!c.pendingRound||Math.max(c.score.a,c.score.b)>=c.rules.targetScore||c.participants[0]!==uid;panel.append(button);
      }
      boards.append(panel);
    }
    select('.round').hidden=!c||!c.rounds.length&&!c.pendingRound;select('.policy').hidden=!c;
    if(c){if(c.status!=='proposed'){select('.qr').replaceChildren();select('.pairing-share').hidden=true;select('.pairing-code').textContent='';}}
    for(const button of app.querySelectorAll('[data-op]')){
      const op=button.dataset.op;if(op==='logout'||op==='recoveryBack'){button.disabled=!view.uid;continue;}if(op==='retry')button.hidden=!view.pending;
      const active=c&&!['completed','revoked','disputed','cancelled','expired','rejected'].includes(c.status);
      button.disabled=!uid||!!view.busy||(!!view.pending&&!['retry','getChallenge','stopScan'].includes(op))||
        (op==='retry'&&!view.pending)||(['getChallenge','reconnect','resume'].includes(op)&&!c&&!view.pending?.input.challengeId&&!savedId(uid))||
        (op==='undoRound'&&(c?.participants[0]!==uid||!['in_progress','round_pending','game_pending','final_pending','score_review'].includes(c?.status)||(!c?.pendingRound&&!c?.rounds.length)))||
        (op==='resumeReview'&&(c?.status!=='score_review'||c.participants[0]!==uid))||
        (op==='createChallenge'&&(active||unresolved))||(['accept','acceptCode'].includes(op)&&active)||(op==='start'&&(c?.status!=='accepted'||c.ready.includes(uid)))||
        (op==='proposeRound'&&c?.status!=='in_progress')||(op==='recordRound'&&(!['in_progress','score_review'].includes(c?.status)||!!c?.pendingRound||Math.max(c?.score.a||0,c?.score.b||0)>=c?.rules.targetScore))||(op==='confirmRound'&&(c?.status!=='round_pending'||c.pendingRound.confirmedBy.includes(uid)))||
        (op==='confirmFinish'&&(c?.status!=='final_pending'||c.finishConfirmedBy.includes(uid)))||
        (op==='dispute'&&!['in_progress','round_pending','game_pending','final_pending'].includes(c?.status))||(op==='reject'&&(c?.status!=='accepted'||c.participants[0]===uid))||(op==='cancel'&&!['proposed','accepted'].includes(c?.status));
    }
  }
  function renderPlayerSwitch(c,uid){
    const tabs=select('.analysis-player-tabs');
    const players=[...c.participants].sort((a,b)=>Number(b===uid)-Number(a===uid));
    if(tabs.dataset.players!==JSON.stringify(players)){
      tabs.replaceChildren();tabs.dataset.players=JSON.stringify(players);
      for(const player of players){
        const button=document.createElement('button');button.type='button';button.dataset.analysisPlayer=player;button.setAttribute('aria-controls','room-player-analysis');
        button.addEventListener('click',()=>{radarPlayer=view.snapshot.participants.indexOf(player);render();button.focus({preventScroll:true});});tabs.append(button);
      }
    }
    for(const button of tabs.children){const player=button.dataset.analysisPlayer;button.textContent=c.participantNames?.[player]||'未設定名稱';button.setAttribute('aria-pressed',String(c.participants[radarPlayer]===player));}
    select('.room-stats').setAttribute('aria-label',(c.participantNames?.[c.participants[radarPlayer]]||'玩家')+' 本輪分析');
  }
  function renderRoomRadar(container,c,games){
    const ns='http://www.w3.org/2000/svg';
    const player=c.participants[radarPlayer]||c.participants[0],stats=roomPlayerStats(c,games,player);
    const totals={for:stats.attack,against:stats.defense},totalFor=stats.totalFor,totalAgainst=stats.totalAgainst;
    const axes=[['極限','for','extreme'],['擊飛','for','knockout'],['爆裂','for','burst'],['轉停','for','spin'],['被極限','against','extreme'],['被擊飛','against','knockout'],['被爆裂','against','burst'],['被轉停','against','spin']];
    const shares=axes.map(([,side,type])=>{const total=side==='for'?totalFor:totalAgainst;return total?Math.round(totals[side][type]/total*100):null;});
    const shell=document.createElement('div');shell.className='license-radar';
    const svg=document.createElementNS(ns,'svg');svg.classList.add('license-radar-svg');svg.setAttribute('viewBox','0 0 320 320');svg.setAttribute('role','img');svg.setAttribute('aria-label',(c.participantNames?.[player]||'玩家')+' 本輪得分及失分分布八角圖');
    const point=(index,radius)=>{const angle=(-90+index*45)*Math.PI/180;return [(160+Math.cos(angle)*radius).toFixed(1),(160+Math.sin(angle)*radius).toFixed(1)]};
    const polygon=(radii,className)=>{const el=document.createElementNS(ns,'polygon');el.setAttribute('points',radii.map((radius,index)=>point(index,radius).join(',')).join(' '));el.setAttribute('class',className);svg.append(el);return el;};
    for(const scale of [.25,.5,.75,1])polygon(axes.map(()=>105*scale),'radar-grid');
    for(let i=0;i<8;i++){const axis=document.createElementNS(ns,'line'),[x,y]=point(i,105);axis.setAttribute('x1','160');axis.setAttribute('y1','160');axis.setAttribute('x2',x);axis.setAttribute('y2',y);axis.setAttribute('class','radar-axis');svg.append(axis);}
    const radii=shares.map(share=>105*Math.min(100,share)/100);polygon(radii,'radar-player');
    for(let i=0;i<8;i++){const node=document.createElementNS(ns,'circle'),[x,y]=point(i,radii[i]);node.setAttribute('cx',x);node.setAttribute('cy',y);node.setAttribute('r','2.8');node.setAttribute('class','radar-node');svg.append(node);}
    const center=document.createElementNS(ns,'text');center.setAttribute('x','160');center.setAttribute('y','164');center.setAttribute('class','radar-center');center.textContent='100% 分布＝滿格';svg.append(center);
    shell.append(svg);
    axes.forEach(([label,side],index)=>{const axis=document.createElement('span');axis.className='radar-label radar-label-'+index+(side==='against'?' loss':'');axis.textContent=label;const value=document.createElement('b');value.textContent=shares[index]===null?'—':shares[index]+'%';axis.append(value);shell.append(axis);});
    const note=document.createElement('p');note.className='radar-note';note.textContent='戰型與攻防分布依本房得失分明細計算；得分效率＝本人得分÷雙方總得分。進攻四軸各占本人總得分，防守四軸各占本人總失分。圖形以 100% 占比為滿格。回合序號依有效記分順序計算，不含未記錄的平手或重賽；失分不等於失誤。集中失分以到達該回合的場次為分母，至少 5 場才比較；領先與逆轉以已完成場次的比分走勢統計。評價與建議只反映本輪對練，無法判定發射技術、陀螺配置優劣或整體實力。';
    container.append(shell,note);
  }
  function clearHistory(){feedback.reset();achievementNotice=null;select('.achievement-notice').hidden=true;select('.achievement-notice p').textContent='';historyEpoch++;historyRequest?.abort();historyRequest=null;historyCompletion=null;select('.practice-xp').replaceChildren();select('.session-xp').textContent='';select('.history-list').replaceChildren();select('.history-stats').replaceChildren();select('.history-status').textContent='';}
  async function refreshHistory(){
    const uid=view.uid;if(!uid)return;
    historyRequest?.abort();const request=new AbortController(),epoch=++historyEpoch;historyRequest=request;
    select('.history-status').textContent='載入戰績中…';
    try{
      const result=await runtime.history(true);if(!['ready','empty'].includes(result?.status))throw Error('history-unavailable');
      if(epoch!==historyEpoch||view.uid!==uid)return;
      const h={total:result.total,wins:result.records.filter(r=>r.isWin).length,losses:result.records.filter(r=>!r.isWin).length,matches:result.records.map(r=>({playerName:r.playerName,opponentName:r.opponent.name,score:r.scoreFor,opponentScore:r.scoreAgainst,won:r.isWin,completedAt:r.completedAt,gameNumber:r.round,rounds:r.roundsPerspective,practiceXp:r.practiceXp}))};select('.history-stats').textContent=h.total+' 場 · '+h.wins+' 勝 '+h.losses+' 敗 · 勝率 '+(h.total?Math.round(h.wins/h.total*100)+'%':'—');
      const list=select('.history-list');list.replaceChildren();
      for(const m of h.matches){
        const card=document.createElement('article');card.className='history-match';
        const names=document.createElement('strong');names.textContent=m.playerName+' vs '+m.opponentName;
        const score=document.createElement('span');score.className=m.won?'history-win':'history-loss';score.textContent=(m.won?'勝':'敗')+' '+m.score+' : '+m.opponentScore;
        const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='逐回合紀錄';detail.append(summary);for(const round of m.rounds){const line=document.createElement('p');line.textContent=(round.perspective==='for'?m.playerName:m.opponentName)+' · '+finishLabels[round.type]+' +'+round.points;detail.append(line);}card.append(detail);const date=document.createElement('small');date.textContent=new Date(m.completedAt).toLocaleString('zh-TW')+' · 第 '+(m.gameNumber||1)+' 場';card.append(names,score,date);const xp=document.createElement('p');xp.textContent=m.practiceXp?'練習 XP +'+m.practiceXp.xp+(m.practiceXp.reason==='daily-limit'?'（已達每日 10 場上限）':m.practiceXp.reason==='opponent-limit'?'（同對手已超過 6 場）':m.practiceXp.reason==='opponent-half'?'（同對手第 4～6 場，半額）':''):'練習 XP 0（啟用前或發放暫停）';card.append(xp);list.append(card);
      }
      const current=view.snapshot;if(current?.status==='completed'){
        if(achievementNotice&&runtime.achievementUnlocks){const eligible=new Set(runtime.achievementUnlocks(result.records,current.challengeId).map(b=>b.name));achievementNotice.names=achievementNotice.names.filter(name=>eligible.has(name));if(!achievementNotice.names.length)achievementNotice=null;}
        const badges=feedback.settle(uid,current.challengeId,result.records);if(badges.length)achievementNotice={uid,challengeId:current.challengeId,names:badges.map(b=>b.name)};
      }
      select('.history-status').textContent=h.total?'':'尚無已確認的 PK 戰績。';render();
    }catch{if(epoch===historyEpoch&&view.uid===uid)select('.history-status').textContent='戰績更新未完成，請按更新戰績重試。';}
    finally{if(historyRequest===request)historyRequest=null;}
  }
  async function recoverRoom({returnHome=false}={}){
    const attempt=++recoveryAttempt,uid=view.uid,id=view.snapshot?.challengeId||view.pending?.input.challengeId||savedId(uid);
    if(!uid||!id||view.busy)return;
    try{
      const result=await client.read(id);if(view.uid!==uid||attempt!==recoveryAttempt||!result)return;
      syncPaused=false;syncFailed=false;
      if(terminalStatus(result.challenge?.status)){
        recovery.clear(uid);
        if(returnHome&&!view.pending){goHome();message('原對戰已結束，已返回對戰首頁。');}
        else{render();message('原對戰已結束，紀錄已更新。');}
      }else{render();message(returnHome?'此對戰仍未結案，請核對比分並完成確認。':'');}
    }catch(error){
      if(view.uid!==uid||attempt!==recoveryAttempt)return;
      if(recovery.clearUnavailable(uid,error,{pending:!!view.pending})){goHome();message('原對戰已不存在或無法參與，已返回對戰首頁。');}
      else message('原對戰讀取未完成，紀錄仍保留。請重新連線後重試，或重送原操作。');
    }
  }
  const unsubscribe=runtime.watch(user=>{
    const uid=user?.uid||null;if(uid!==previousUid){clearHistory();clearPairing();previousUid=uid;client.setSession(uid);}
    if(uid){refreshHistory();message('');const id=savedId(uid);if(id&&!recovery.dismissed(uid)&&!view.busy&&!view.snapshot)recoverRoom();}
    else{client.setSession(null);message('請回到 ARENA 登入。');}
  });
  async function startScan(){const uid=view.uid;scanning=true;scanFound=false;render();try{await scanner.start();}catch{if(view.uid===uid&&joining&&scanning){scanning=false;render();message('無法使用相機，可直接輸入 4 碼，或允許相機權限後重新啟動掃描。');}}}
  app.addEventListener('click',async event=>{
    const action=event.target.closest('[data-op]');const op=action?.dataset.op;if(!op||action.disabled)return;const uid=view.uid;if(op==='stopScan'){scanner.stop();scanning=false;render();return;}
    if(['nextGame','endSession'].includes(op)&&view.snapshot?.status!=='game_pending')return;
    if(op==='dismissAchievement'){achievementNotice=null;render();return;}
    if(op==='history'){refreshHistory();return;}
    if(op==='exchange'){swapped=!swapped;render();return;}
    if(op==='join'&&savedId(uid)&&!recovery.dismissed(uid)&&!view.snapshot){message('請先返回未結案對戰完成確認。');return;}
    if(op==='join'){joining=true;await startScan();return;}
    if(op==='back'){goHome();return;}
    if(op==='leave'){goHome({preserve:true});return;}
    if(op==='recoveryBack'){goHome({preserve:true});return;}
    if(!uid||view.busy)return;
    if(['resume','resumeSaved'].includes(op)){await recoverRoom();return;}
    if(op==='scan'){await startScan();return;}
    if(op==='createChallenge'&&!select('[name="practice"]').checked){const count=select('[name="matchCount"]').value===''?1:Number(select('[name="matchCount"]').value);if(!Number.isSafeInteger(count)||count<1||count>100){message('場次請輸入 1 到 100 的整數，留白預設一場。');return;}}
    if(['accept','acceptCode'].includes(op)){scanner.stop();scanning=false;render();}
    const previous=view.snapshot;
    try{
      let result;if(op==='retry')result=await client.retry();
      else if(['getChallenge','reconnect','resume'].includes(op))result=await client.read(view.snapshot?.challengeId||view.pending?.input.challengeId||savedId(uid));
      else{const c=view.snapshot;let input;if(op==='createChallenge')input={matchCount:select('[name="practice"]').checked?0:select('[name="matchCount"]').value===''?1:Number(select('[name="matchCount"]').value)};else if(op==='acceptCode')input={pairingCode:select('[name="pairingCode"]').value,expectedRevision:0};else if(op==='accept')input={...parsePairingPayload(select('textarea').value),expectedRevision:0};
        else{if(!c)throw Error('challenge-required');input={challengeId:c.challengeId,expectedRevision:c.revision};
          if(['proposeRound','recordRound'].includes(op)){input.winnerUid=c.participants[Number(action.dataset.player)];input.finish=action.dataset.finish;}
          if(op==='confirmRound')input.roundRevision=c.pendingRound?.roundRevision;if(op==='confirmFinish')input.resultRevision=c.resultRevision;}
        result=await client.mutate(op,input);}
      if(view.uid!==uid||!result)return;syncPaused=false;syncFailed=false;render();
      if(op==='cancel'){goHome();return;}
      if(['accept','acceptCode'].includes(op)){clearPairing();render();}
      if(result.pairingToken){const payload=pairingPayload(result.challenge.challengeId,result.pairingToken);select('textarea').value=payload;select('.pairing-share').hidden=false;select('.pairing-code').textContent=result.pairingCode||'';select('.pairing-expiry').textContent='配對期限：'+new Date(result.challenge.expiresAt).toLocaleTimeString()+'，成功配對後失效。';renderPairingQr(select('.qr'),payload,globalThis.QRCode);}
      message(result.pairingToken?'':result.challenge?.status==='final_pending'&&result.challenge.finishConfirmedBy.includes(uid)?'已確認比分，等待對方確認中。':'操作已完成。');
    }catch(error){if(view.uid!==uid)return;if(error.message==='revision-conflict'&&previous&&!view.pending){try{const latest=(await client.read(previous.challengeId))?.challenge;if(view.uid!==uid||!latest)return;const safeStart=op==='start'&&latest.status==='accepted'&&!latest.ready.includes(uid);const safeFinish=op==='confirmFinish'&&latest.status==='final_pending'&&latest.resultRevision===previous.resultRevision&&!latest.finishConfirmedBy.includes(uid);if(safeStart||safeFinish){await client.mutate(op,{challengeId:latest.challengeId,expectedRevision:latest.revision,...(safeFinish?{resultRevision:latest.resultRevision}:{})});message(safeFinish?'已確認比分，等待對方確認中。':'已確認開賽。');return;}}catch{}}message(view.pending?'操作結果尚未確認，請重送原操作。':error.message==='revision-conflict'?'狀態已更新，正在同步最新比分。':error.message==='pairing-rate-limited'?'輸入序號次數過多，請稍候一分鐘再試。':error.message==='closed'?'對戰功能暫時關閉，請稍後再試。':error.message==='pairing-unavailable'?'配對資料無效、已使用或已失效，請對手重新建立對戰。':error.message==='account-unavailable'?'此帳號目前無法使用對戰功能，請確認帳號狀態。':'操作未完成，請刷新並確認配對資料或目前狀態。');}
  });
  const stop=()=>{scanner.stop();scanning=false;render();};const synchronize=()=>{const c=view.snapshot;if(!syncPaused&&!document.hidden&&view.uid&&c&&!view.busy&&!view.pending&&!['completed','revoked','disputed','cancelled','expired','rejected'].includes(c.status))client.sync(c.challengeId).then(result=>{if(view.snapshot?.challengeId!==c.challengeId)return;if(result&&syncFailed){syncFailed=false;render();}}).catch(error=>{if(view.snapshot?.challengeId!==c.challengeId)return;syncFailed=true;if(['closed','account-unavailable'].includes(error.message))syncPaused=true;render();message('對戰同步未完成，比分仍保留。可按重新同步；暫時離開不會取消對戰。');});};
  const syncTimer=setInterval(synchronize,3000);
  const background=()=>{if(document.hidden)stop();else synchronize();};addEventListener('pagehide',stop);document.addEventListener('visibilitychange',background);
  render();return{dispose(){clearHistory();unsubscribe();clearInterval(syncTimer);stop();client.dispose({preservePending:true});app.replaceChildren();removeEventListener('pagehide',stop);document.removeEventListener('visibilitychange',background);}};
}

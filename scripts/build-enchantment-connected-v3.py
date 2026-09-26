"""Derive the connected player draw from the approved, unmodified V3 artwork."""
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'docs' / 'enchantment' / 'approved-draw-v3.html'
target = Path(__file__).resolve().parents[1] / 'enchantment-draw-v3.html'
html = source.read_text(encoding='utf-8')

def replace_once(before, after):
    global html
    count = html.count(before)
    if count != 1:
        raise RuntimeError(f'Expected one V3 script segment, found {count}: {before[:70]}')
    html = html.replace(before, after, 1)

replace_once('12 張定版卡面隨機展示｜此頁為抽卡動畫預覽，尚未連接賽事與裁判計分。',
             '12 張 BXH 附魔卡｜抽卡結果由賽事伺服器指定，請等待裁判開始。')

replace_once(
    "let phase='idle',round=1,index=0,timer=null,drag=null,progress=0;const order=[...cards.keys()].sort(()=>Math.random()-.5);",
    "let phase='waiting',round=0,index=0,timer=null,drag=null,progress=0,assignedCard=null,session=null,acknowledgedRound=0;"
    "const cardIds=['double_extreme','double_knockout','double_burst','double_spin','boost_extreme','boost_knockout','boost_burst','weaken_extreme','weaken_knockout','weaken_burst','weaken_spin','seal'];"
)
replace_once(
    "const c=cards[order[index%cards.length]];",
    "const cardIndex=cardIds.indexOf(assignedCard);if(cardIndex<0){showDrawError('無法取得本局卡牌，請重新整理。');return;}const c=cards[cardIndex];"
)
replace_once(
    "timer=setTimeout(reveal,750)",
    "timer=setTimeout(()=>{if(session)window.parent.postMessage({kind:'bxh-enchantment-draw',code:session.code,matchId:session.matchId,round},location.origin);else showDrawError('尚未連接賽事');},750)"
)
replace_once(
    "function next(){stopClips();soundStarted=false;round++;index++;if(index%cards.length===0)order.sort(()=>Math.random()-.5);clearTimer();",
    "function next(){stopClips();soundStarted=false;assignedCard=null;clearTimer();"
)
replace_once(
    "action.addEventListener('click',()=>{if(phase==='idle')finishDraw();else if(phase==='revealed'){phase='waiting';action.textContent='模擬下局抽卡';setCopy('等待裁判開賽','雙方卡片資訊將同步至裁判台。')}else if(phase==='waiting')next()});skip.addEventListener('click',reveal);",
    """action.addEventListener('click',()=>{if(phase==='idle')finishDraw();else if(phase==='revealed'){acknowledgedRound=round;phase='waiting';action.disabled=true;setCopy('等待裁判結果','本局卡牌已確認，等待裁判送出比賽結果。')}});
skip.addEventListener('click',()=>{if(assignedCard)reveal()});
function showDrawError(message){clearTimer();stopClips();phase='waiting';action.disabled=true;skip.hidden=true;setCopy('抽卡暫停',message)}
function receiveState(data){
 if(!data||!data.state||!session||data.code!==session.code||data.matchId!==session.matchId)return;
 const s=data.state,side=data.side;
 if(!['A','B'].includes(side))return;
 if(s.phase==='completed'){showDrawError('本場比賽已結束。');return;}
 if(s.round!==round){round=s.round;next();}
 if(s.round<1){showDrawError('等待裁判開始抽卡。');return;}
 $('round').textContent='ROUND '+String(round).padStart(2,'0')+' · '+(s.phase==='drawing'?'抽卡階段':'對戰階段');
 const ownCard=s.cards&&s.cards[side];
 if(ownCard){
  if(!cardIds.includes(ownCard)){showDrawError('卡牌資料異常。');return;}
  assignedCard=ownCard;
  if(acknowledgedRound===round)return;
  if(phase==='drawing'||phase==='idle')reveal();
  else if(phase!=='revealed'){phase='drawing';reveal();}
  return;
 }
 if(s.phase==='drawing'&&!s.drawn?.[side]&&phase!=='drawing'&&phase!=='idle'){
  phase='idle';action.disabled=false;action.textContent='按鈕抽卡 ↑';setCopy('本局附魔待命','按住底部露出的卡片，穿過龍爪往上抽。');
 }else if(s.phase!=='drawing'&&phase!=='revealed')showDrawError('等待裁判送出結果。');
}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==window.parent)return;
 const d=event.data||{};
 if(d.kind==='bxh-enchantment-init'){
  if(!d.code||!d.matchId)return;
  session={code:d.code,matchId:d.matchId};
  receiveState(d);
 }else if(d.kind==='bxh-enchantment-state')receiveState(d);
 else if(d.kind==='bxh-enchantment-error'&&session&&d.code===session.code&&d.matchId===session.matchId)showDrawError('連線中斷，請重新整理頁面再試。');
});
action.disabled=true;skip.hidden=true;setCopy('等待裁判開始抽卡','請留在此畫面，裁判啟動後即可拖出卡片。');
window.parent.postMessage({kind:'bxh-enchantment-ready'},location.origin);"""
)
target.write_text(html, encoding='utf-8')
print(target, target.stat().st_size)

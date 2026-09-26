/* BXH 附魔之戰｜三方狀態轉移，供可信任的後端交易引用。 */
const score=require('./enchantment-score-core.js');

function failure(reason){return {ok:false,reason};}
function create(matchId,playerA,playerB){
  if(!matchId||!playerA||!playerB||playerA===playerB)throw new Error('invalid-match');
  return {matchId,players:{A:playerA,B:playerB},round:0,phase:'waiting-referee',
    cards:{A:null,B:null},revealed:{A:false,B:false},scores:{A:0,B:0},history:[]};
}
function copy(s){return {...s,players:{...s.players},cards:{...s.cards},revealed:{...s.revealed},scores:{...s.scores},history:s.history.slice()};}
function start(s,refereeAuthorized){
  if(!refereeAuthorized)return failure('referee-required');
  if(s.phase!=='waiting-referee')return failure('invalid-phase');
  const n=copy(s);n.round=1;n.phase='drawing';return {ok:true,state:n};
}
// Assignment happens once in a trusted server transaction. The drag animation
// only reveals this assigned card; repeating a request cannot reroll it.
function assign(s,round,side,cardId){
  if(s.phase!=='drawing'||round!==s.round)return failure('stale-round');
  if(!['A','B'].includes(side)||!score.CARDS[cardId])return failure('invalid-card');
  if(s.cards[side])return failure('already-assigned');
  const n=copy(s);n.cards[side]=cardId;return {ok:true,state:n};
}
function reveal(s,round,side,playerId){
  if(s.phase!=='drawing'||round!==s.round)return failure('stale-round');
  if(!['A','B'].includes(side)||s.players[side]!==playerId)return failure('player-required');
  if(!s.cards[side])return failure('card-not-assigned');
  if(s.revealed[side])return {ok:true,state:s,idempotent:true};
  const n=copy(s);n.revealed[side]=true;
  if(n.revealed.A&&n.revealed.B)n.phase='ready-to-score';
  return {ok:true,state:n};
}
function submit(s,round,side,type,refereeAuthorized){
  if(!refereeAuthorized)return failure('referee-required');
  if(s.phase!=='ready-to-score'||round!==s.round)return failure('not-ready');
  if(!['A','B'].includes(side))return failure('invalid-winner');
  const other=side==='A'?'B':'A';
  const computed=score.resolve({type,winnerCardId:s.cards[side],loserCardId:s.cards[other]});
  if(!computed.ok)return computed;
  const n=copy(s);n.scores[side]+=computed.points;
  n.history.push({round,side,type,winningCardId:s.cards[side],losingCardId:s.cards[other],
    scoreBefore:{...s.scores},...computed});
  if(n.scores[side]>=4){n.phase='awaiting-result';return {ok:true,state:n,event:n.history.at(-1)};}
  n.round++;n.phase='drawing';n.cards={A:null,B:null};n.revealed={A:false,B:false};
  return {ok:true,state:n,event:n.history.at(-1)};
}
function undo(s,refereeAuthorized){
  if(!refereeAuthorized)return failure('referee-required');
  if(!['drawing','awaiting-result'].includes(s.phase)||!s.history.length)return failure('nothing-to-undo');
  const last=s.history.at(-1);
  // A later round may already have drawings; those assignments are discarded
  // when restoring the previous round, and its original cards return intact.
  const n=copy(s);n.history.pop();n.scores={...last.scoreBefore};n.round=last.round;
  n.cards={A:last.side==='A'?last.winningCardId:last.losingCardId,
    B:last.side==='B'?last.winningCardId:last.losingCardId};
  n.revealed={A:true,B:true};n.phase='ready-to-score';
  return {ok:true,state:n,event:last};
}
function confirm(s,refereeAuthorized){
  if(!refereeAuthorized)return failure('referee-required');
  if(s.phase!=='awaiting-result')return failure('not-ready');
  const n=copy(s);n.phase='completed';
  n.winner=n.scores.A>=4?'A':'B';return {ok:true,state:n};
}
function view(s,side){
  // The referee sees both after players reveal. A player never receives the
  // opponent's assigned card through this view while the draw is pending.
  const cards={A:null,B:null};
  if(['A','B'].includes(side)){if(s.revealed[side])cards[side]=s.cards[side];}
  else if(side==='referee')for(const who of ['A','B'])if(s.revealed[who])cards[who]=s.cards[who];
  return {matchId:s.matchId,round:s.round,phase:s.phase,scores:{...s.scores},
    drawn:{...s.revealed},cards};
}
module.exports={create,start,assign,reveal,submit,undo,confirm,view};

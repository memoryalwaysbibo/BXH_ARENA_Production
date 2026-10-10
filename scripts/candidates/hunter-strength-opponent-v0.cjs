'use strict';

// Offline research candidate only. Never imported by production runtime.
const VERSION='hunter-strength-opponent-calibration-v0';

function clamp(v,min=0,max=100){return Math.max(min,Math.min(max,v));}
function expectedWin(self,opponent){
  return 1/(1+Math.pow(10,(opponent-self)/400));
}
function evaluate(prefix){
  if(!Array.isArray(prefix)||prefix.length===0)throw Error('candidate-prefix-empty');
  let wins=0,scoreFor=0,scoreAgainst=0,expected=0;
  for(const item of prefix){
    const r=item&&item.record,rating=item&&item.rating;
    if(!r||!rating||!Number.isFinite(rating.self)||!Number.isFinite(rating.opponent))throw Error('candidate-rating-invalid');
    if(typeof r.isWin!=='boolean'||!Number.isFinite(Number(r.scoreFor))||!Number.isFinite(Number(r.scoreAgainst)))throw Error('candidate-record-invalid');
    wins+=r.isWin?1:0;
    scoreFor+=Number(r.scoreFor);
    scoreAgainst+=Number(r.scoreAgainst);
    expected+=expectedWin(rating.self,rating.opponent);
  }
  const n=prefix.length;
  const winRate=wins/n*100;
  const pointShare=(scoreFor+scoreAgainst)>0?scoreFor/(scoreFor+scoreAgainst)*100:50;
  const baseline=0.6*winRate+0.4*pointShare;

  // Small samples are pulled toward neutral instead of being treated as fully stable.
  const maturity=n/(n+7);
  const stabilized=50+(baseline-50)*maturity;

  // Reward or penalize results relative to the opponent strength available before each match.
  // 20 points is deliberately conservative for research v0 and must be calibrated on held-out data
  // before any production use.
  const actual=wins/n;
  const expectedRate=expected/n;
  const opponentAdjustment=(actual-expectedRate)*20*maturity;

  return Number(clamp(stabilized+opponentAdjustment).toFixed(2));
}

module.exports={version:VERSION,evaluate,expectedWin};

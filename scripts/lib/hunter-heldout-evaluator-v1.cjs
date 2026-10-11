'use strict';

const crypto=require('node:crypto');

const VERSION='hunter-phase2-heldout-evaluator-v1';

function hashUnit(value){
  const hex=crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,13);
  return parseInt(hex,16)/0xfffffffffffff;
}
function splitPlayers(playerIds,{calibrationShare=0.7,salt='hunter-p2-heldout-v1'}={}){
  if(!(calibrationShare>0&&calibrationShare<1))throw Error('split-share-invalid');
  const calibration=[],holdout=[];
  for(const id of [...new Set(playerIds.map(String))].sort()){
    (hashUnit(salt+'|'+id)<calibrationShare?calibration:holdout).push(id);
  }
  return {calibration,holdout};
}
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function clamp01(v){return Math.max(0,Math.min(1,v));}
function scoreToProxyProbability(score){
  if(!finite(score)||score<0||score>100)return null;
  return clamp01(score/100);
}
function metrics(rows,key){
  const valid=rows.filter(r=>finite(r[key])&&typeof r.isWin==='boolean');
  if(!valid.length)return {samples:0,brier:null,mae:null,accuracy:null};
  let brier=0,mae=0,correct=0;
  for(const r of valid){
    const p=scoreToProxyProbability(r[key]),y=r.isWin?1:0;
    brier+=(p-y)**2;mae+=Math.abs(p-y);
    correct+=((p>=0.5)===r.isWin)?1:0;
  }
  return {
    samples:valid.length,
    brier:Number((brier/valid.length).toFixed(6)),
    mae:Number((mae/valid.length).toFixed(6)),
    accuracy:Number((correct/valid.length*100).toFixed(2))
  };
}
function buildPredictionRows(playerSeries,{warmupMatches=3}={}){
  if(!Number.isSafeInteger(warmupMatches)||warmupMatches<1)throw Error('warmup-invalid');
  const out=[];
  for(const [playerId,series] of Object.entries(playerSeries||{})){
    const rows=[...(series||[])].sort((a,b)=>Number(a.completedAt||0)-Number(b.completedAt||0));
    for(let i=warmupMatches;i<rows.length;i++){
      const r=rows[i];
      if(!finite(r.completedAt)||r.completedAt<=0||typeof r.isWin!=='boolean')continue;
      // Scores must represent the prefix ending before this target match.
      if(!finite(r.baselineScoreBefore)||!finite(r.candidateScoreBefore))continue;
      out.push({
        playerId,
        completedAt:r.completedAt,
        isWin:r.isWin,
        baselineScoreBefore:r.baselineScoreBefore,
        candidateScoreBefore:r.candidateScoreBefore
      });
    }
  }
  return out;
}
function evaluate(playerSeries,options={}){
  const playerIds=Object.keys(playerSeries||{});
  const split=splitPlayers(playerIds,options);
  const rows=buildPredictionRows(playerSeries,options);
  const calibrationRows=rows.filter(r=>split.calibration.includes(r.playerId));
  const holdoutRows=rows.filter(r=>split.holdout.includes(r.playerId));
  const baseline=metrics(holdoutRows,'baselineScoreBefore');
  const candidate=metrics(holdoutRows,'candidateScoreBefore');
  const coverage=rows.length?Number((holdoutRows.length/rows.length*100).toFixed(2)):0;
  const criteria={
    minHoldoutPlayers:Number.isSafeInteger(options.minHoldoutPlayers)?options.minHoldoutPlayers:5,
    minHoldoutSamples:Number.isSafeInteger(options.minHoldoutSamples)?options.minHoldoutSamples:30,
    maxCandidateBrierDelta:finite(options.maxCandidateBrierDelta)?options.maxCandidateBrierDelta:0,
    minCoveragePct:finite(options.minCoveragePct)?options.minCoveragePct:20
  };
  const reasons=[];
  if(split.holdout.length<criteria.minHoldoutPlayers)reasons.push('insufficient-holdout-players');
  if(holdoutRows.length<criteria.minHoldoutSamples)reasons.push('insufficient-holdout-samples');
  if(coverage<criteria.minCoveragePct)reasons.push('insufficient-holdout-coverage');
  if(baseline.brier==null||candidate.brier==null)reasons.push('missing-score-metrics');
  else if(candidate.brier-baseline.brier>criteria.maxCandidateBrierDelta)reasons.push('candidate-brier-worse');
  return {
    version:VERSION,
    split:{
      calibrationPlayers:split.calibration.length,
      holdoutPlayers:split.holdout.length,
      calibrationPlayerIds:split.calibration,
      holdoutPlayerIds:split.holdout
    },
    rows:{all:rows.length,calibration:calibrationRows.length,holdout:holdoutRows.length,coveragePct:coverage},
    holdout:{baseline,candidate,brierDelta:baseline.brier!=null&&candidate.brier!=null?Number((candidate.brier-baseline.brier).toFixed(6)):null},
    criteria,
    accepted:reasons.length===0,
    reasons,
    notes:[
      'Scores are treated as 0-1 proxy probabilities only for comparative validation.',
      'Holdout players are disjoint from calibration players.',
      'Each target match uses scores computed strictly from the prior prefix.'
    ]
  };
}

module.exports={VERSION,hashUnit,splitPlayers,scoreToProxyProbability,metrics,buildPredictionRows,evaluate};

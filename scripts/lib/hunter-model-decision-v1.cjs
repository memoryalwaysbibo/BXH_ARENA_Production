'use strict';

const VERSION='hunter-phase2-model-decision-v1';
const INSUFFICIENT_PREFIX='insufficient-';

function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function validateEvaluation(e){
  if(!e||typeof e!=='object')throw Error('evaluation-required');
  if(!e.version||!e.rows||!e.split||!e.holdout||!e.criteria||!Array.isArray(e.reasons))throw Error('evaluation-invalid');
  return e;
}
function classify(evaluation){
  const e=validateEvaluation(evaluation);
  const insufficient=e.reasons.filter(r=>String(r).startsWith(INSUFFICIENT_PREFIX)||r==='missing-score-metrics');
  const modelFailures=e.reasons.filter(r=>!insufficient.includes(r));
  let status;
  if(insufficient.length)status='INSUFFICIENT_DATA';
  else if(e.accepted===true&&modelFailures.length===0)status='PASS';
  else status='FAIL';
  return {status,insufficient,modelFailures};
}
function buildDecision({evaluation,modelVersion,dataVersion,inputHashes={}}){
  const e=validateEvaluation(evaluation);
  const c=classify(e);
  if(!modelVersion||!dataVersion)throw Error('decision-version-required');
  return {
    version:VERSION,
    status:c.status,
    researchOnly:true,
    productionEligible:false,
    modelVersion:String(modelVersion),
    dataVersion:String(dataVersion),
    evaluatorVersion:String(e.version),
    inputs:{
      ledgerSha256:inputHashes.ledgerSha256||null,
      recordsSha256:inputHashes.recordsSha256||null
    },
    sample:{
      calibrationPlayers:Number(e.split.calibrationPlayers||0),
      holdoutPlayers:Number(e.split.holdoutPlayers||0),
      allRows:Number(e.rows.all||0),
      calibrationRows:Number(e.rows.calibration||0),
      holdoutRows:Number(e.rows.holdout||0),
      holdoutCoveragePct:Number(e.rows.coveragePct||0)
    },
    metrics:{
      baseline:{
        samples:Number(e.holdout.baseline?.samples||0),
        brier:finite(e.holdout.baseline?.brier)?e.holdout.baseline.brier:null,
        mae:finite(e.holdout.baseline?.mae)?e.holdout.baseline.mae:null,
        accuracy:finite(e.holdout.baseline?.accuracy)?e.holdout.baseline.accuracy:null
      },
      candidate:{
        samples:Number(e.holdout.candidate?.samples||0),
        brier:finite(e.holdout.candidate?.brier)?e.holdout.candidate.brier:null,
        mae:finite(e.holdout.candidate?.mae)?e.holdout.candidate.mae:null,
        accuracy:finite(e.holdout.candidate?.accuracy)?e.holdout.candidate.accuracy:null
      },
      brierDelta:finite(e.holdout.brierDelta)?e.holdout.brierDelta:null
    },
    criteria:{...e.criteria},
    reasons:{
      insufficientData:c.insufficient,
      modelFailures:c.modelFailures,
      raw:[...e.reasons]
    },
    decisionText:
      c.status==='PASS'?'Candidate 通過目前 research gate；不代表可直接上 production。':
      c.status==='FAIL'?'Candidate 在目前 holdout gate 未通過；維持 baseline。':
      '資料不足，不能判定 Candidate 優於或劣於 baseline。',
    nextAction:
      c.status==='PASS'?'manual-policy-review':
      c.status==='FAIL'?'keep-baseline':
      'collect-more-data'
  };
}

module.exports={VERSION,classify,buildDecision};

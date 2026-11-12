'use strict';
// RDW P2-5 observational shadow evaluator. No writes or production scoring hooks.
const RDW=require('../../modules/main-app/rdw-shadow-v1.js');
function evaluate(records){
  if(!Array.isArray(records))throw Error('records-required');
  let eligible=0,excluded=0,neutral=0,weightedWins=0,rawWins=0,weightedLosses=0,rawLosses=0;
  const details=[];
  for(const row of records){
    const weight=RDW.verifiedPreMatchWeight(row&&row.snapshot);
    if(weight===null){excluded++;continue;}
    if(typeof row.isWin!=='boolean')throw Error('result-required');
    eligible++;if(weight===1)neutral++;
    if(row.isWin){rawWins++;weightedWins+=weight;}else{rawLosses++;weightedLosses+=weight;}
    details.push({weight,isWin:row.isWin});
  }
  // Diagnostic weighted contributions only. Do not call this a replacement for 60/40 strength.
  return Object.freeze({version:'rdw-shadow-comparison-v1',eligible,excluded,neutral,rawWins,rawLosses,weightedWins:Number(weightedWins.toFixed(6)),weightedLosses:Number(weightedLosses.toFixed(6)),details});
}
module.exports={evaluate};

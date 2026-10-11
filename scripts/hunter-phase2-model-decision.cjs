'use strict';

const fs=require('node:fs');
const decision=require('./lib/hunter-model-decision-v1.cjs');

const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
const input=value('--input');
if(!input){console.error('Usage: node scripts/hunter-phase2-model-decision.cjs --input evaluation.json --model-version VERSION --data-version VERSION [--output report.json]');process.exit(2);}
const evaluation=JSON.parse(fs.readFileSync(input,'utf8'));
const report=decision.buildDecision({
  evaluation,
  modelVersion:value('--model-version')||evaluation.modelVersion||'unknown-model',
  dataVersion:value('--data-version')||evaluation.dataVersion||'unknown-data',
  inputHashes:evaluation.inputs||{}
});
const json=JSON.stringify({...report,generatedAt:new Date().toISOString()},null,2)+'\n';
if(value('--output'))fs.writeFileSync(value('--output'),json);else process.stdout.write(json);

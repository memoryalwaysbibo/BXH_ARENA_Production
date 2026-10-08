'use strict';
// Offline only: caller supplies authorized, de-identified perspective records.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
if(!value('--input')){console.error('Usage: node scripts/backtest-hunter-strength.cjs --input records.json [--candidate module.cjs] [--output report.json]');process.exit(2);}
const root=path.join(__dirname,'..'),c=vm.createContext({window:{},console});
for(const f of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/'+f+'.js'),'utf8'),c);
Object.assign(c,c.window.BXHHunterUtils,{HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},HUNTER_ANALYSIS_MIN_MATCHES:3,HUNTER_ANALYSIS_MIN_ROUNDS:8});
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8'),a=core.indexOf('function hunterBuildAnalysis('),b=core.indexOf('\nfunction ',a+1);vm.runInContext(core.slice(a,b),c);
const records=JSON.parse(fs.readFileSync(value('--input'),'utf8'));if(!Array.isArray(records))throw Error('Input must be an array of perspective records');
const candidate=value('--candidate')?require(path.resolve(value('--candidate'))):null;
const result=c.hunterBacktestStrength(records,c.hunterBuildAnalysis,candidate);
const {rows,...diagnostic}=result.diagnostic;
// Summaries only: never echo source round ledgers, player IDs or rating snapshots.
const report={...result,diagnostic,history:result.history.map(({matchKey,...row})=>({...row,index:row.matches})),generatedAt:new Date().toISOString(),candidateProvided:!!candidate,officialScoreChanged:false};
const json=JSON.stringify(report,null,2)+'\n';if(value('--output'))fs.writeFileSync(value('--output'),json);else process.stdout.write(json);

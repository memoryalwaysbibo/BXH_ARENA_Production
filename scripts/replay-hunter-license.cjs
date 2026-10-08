'use strict';
// Offline reconstruction of current rules; no cloud reads or writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
if(!value('--input')){console.error('Usage: node scripts/replay-hunter-license.cjs --input records.json [--output report.json] [--compare previous-report.json]');process.exit(2);}
const root=path.join(__dirname,'..'),c=vm.createContext({window:{},console});
for(const f of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/'+f+'.js'),'utf8'),c);
Object.assign(c,c.window.BXHHunterUtils,{HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},HUNTER_ANALYSIS_MIN_MATCHES:3,HUNTER_ANALYSIS_MIN_ROUNDS:8});
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8'),a=core.indexOf('function hunterBuildAnalysis('),b=core.indexOf('\nfunction ',a+1);vm.runInContext(core.slice(a,b),c);
const input=fs.readFileSync(value('--input'),'utf8'),records=JSON.parse(input);if(!Array.isArray(records))throw Error('Input must be an array of complete, authorized career perspective records');
const report={...c.hunterReplayLicense(records,c.hunterBuildAnalysis),inputSha256:crypto.createHash('sha256').update(input).digest('hex'),scope:'connected-career-standard-strength-all-source-xp',generatedAt:new Date().toISOString(),comparison:null};
if(value('--compare')){
 const old=JSON.parse(fs.readFileSync(value('--compare'),'utf8'));
 const reasons=[];
 if(old.version!==report.version||old.scope!==report.scope)reasons.push('different-report-scope');
 if(old.inputSha256!==report.inputSha256)reasons.push('different-input');
 if(JSON.stringify(old.current?.versions)!==JSON.stringify(report.current.versions))reasons.push('different-formula-versions');
 report.comparison={comparable:!reasons.length,reasons,previous:old.current?Object.fromEntries(Object.keys(report.current).map(key=>[key,key==='candidate'?{status:old.current.candidate?.status,strength:null,grade:null,connected:false}:key==='versions'?{xp:old.current.versions?.xp,strength:old.current.versions?.strength,grade:old.current.versions?.grade}:old.current[key]])):null,current:report.current,
  scoreDelta:!reasons.length&&old.current.score!=null&&report.current.score!=null?report.current.score-old.current.score:null,
  xpDelta:!reasons.length?report.current.xp-old.current.xp:null};
}
const json=JSON.stringify(report,null,2)+'\n';if(value('--output'))fs.writeFileSync(value('--output'),json);else process.stdout.write(json);

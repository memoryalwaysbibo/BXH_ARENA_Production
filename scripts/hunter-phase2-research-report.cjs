'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

const ledger=require('./lib/hunter-rating-ledger-v0.cjs');
const candidate=require('./candidates/hunter-strength-opponent-v0.cjs');

function sha256(value){
  return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
}
function loadHunter(root){
  const c=vm.createContext({window:{},console});
  for(const f of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/'+f+'.js'),'utf8'),c);
  Object.assign(c,c.window.BXHHunterUtils,{
    HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],
    HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},
    HUNTER_ANALYSIS_MIN_MATCHES:3,
    HUNTER_ANALYSIS_MIN_ROUNDS:8
  });
  const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
  const a=core.indexOf('function hunterBuildAnalysis('),b=core.indexOf('\nfunction ',a+1);
  if(a<0||b<=a)throw Error('hunter-analysis-loader-missing');
  vm.runInContext(core.slice(a,b),c);
  return c;
}
function alias(uid,salt='hunter-p2-report'){
  return 'P_'+sha256(salt+'|'+String(uid)).slice(0,12);
}
function indexResearchRatings(replay){
  const byMatch=new Map();
  for(const h of replay.history){
    byMatch.set(h.matchIdentity,{
      a:{self:h.beforeA,opponent:h.beforeB},
      b:{self:h.beforeB,opponent:h.beforeA}
    });
  }
  return byMatch;
}
function perspectiveRecords(sourceRecords,replay,uid){
  const index=indexResearchRatings(replay),out=[];
  for(const r of sourceRecords||[]){
    const id=String(r.eventCode||'').toUpperCase()+'|'+String(r.matchId||'');
    const rr=index.get(id);
    if(!rr)continue;
    const isA=String(r.playerUid||r.playerId||'')===String(r.playerA||'') || String(uid)===String(r.playerA||'');
    const rating=isA?rr.a:rr.b;
    out.push({...r,
      matchStartedAt:Number(r.matchStartedAt||r.startedAt||r.completedAt)-1,
      ratingSnapshot:{source:'server',verified:true,version:replay.providerVersion,scale:replay.providerScale,capturedAt:Number(r.matchStartedAt||r.startedAt||r.completedAt)-2,selfBefore:rating.self,opponentBefore:rating.opponent}
    });
  }
  return out;
}
function bucketOpponentStrength(records){
  const groups={weaker:[],peer:[],stronger:[]};
  for(const r of records){
    const d=Number(r.ratingSnapshot?.opponentBefore)-Number(r.ratingSnapshot?.selfBefore);
    if(!Number.isFinite(d))continue;
    if(d<=-100)groups.weaker.push(r);
    else if(d>=100)groups.stronger.push(r);
    else groups.peer.push(r);
  }
  const summarize=rows=>({
    matches:rows.length,
    wins:rows.filter(r=>r.isWin===true).length,
    winRate:rows.length?Number((rows.filter(r=>r.isWin===true).length/rows.length*100).toFixed(2)):null
  });
  return Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarize(v)]));
}
function repeatOpponentSummary(records){
  const counts=new Map();
  for(const r of records){
    const id=String(r.opponent?.playerId||r.opponentIdentity?.playerId||'').trim();
    if(id)counts.set(id,(counts.get(id)||0)+1);
  }
  const known=[...counts.values()],total=known.reduce((a,b)=>a+b,0);
  return {
    knownMatches:total,
    uniqueOpponents:counts.size,
    repeatMatches:known.reduce((s,n)=>s+Math.max(0,n-1),0),
    largestOpponentShare:total?Number((Math.max(0,...known)/total*100).toFixed(2)):null
  };
}
function buildReport({ledgerRows,recordsByPlayer}){
  const root=path.join(__dirname,'..');
  const ctx=loadHunter(root);
  const replay=ledger.replay(ledgerRows||[]);
  const players=[];
  for(const [uid,raw] of Object.entries(recordsByPlayer||{})){
    const records=perspectiveRecords(raw,replay,uid);
    const backtest=ctx.hunterBacktestStrength(records,ctx.hunterBuildAnalysis,candidate);
    const history=backtest.history;
    const latest=history.filter(x=>x.candidateScore!=null).at(-1)||null;
    players.push({
      player:alias(uid),
      matches:backtest.diagnostic.matches,
      ratingCoverage:backtest.diagnostic.matches?Number((backtest.diagnostic.rated/backtest.diagnostic.matches*100).toFixed(2)):0,
      baselineScore:latest?latest.baselineScore:null,
      candidateScore:latest?latest.candidateScore:null,
      scoreDelta:latest&&latest.baselineScore!=null?Number((latest.candidateScore-latest.baselineScore).toFixed(2)):null,
      maxBaselineJump:backtest.maxBaselineJump,
      maxCandidateJump:backtest.maxCandidateJump,
      opponentStrength:bucketOpponentStrength(records),
      repeatOpponents:repeatOpponentSummary(records),
      candidateReason:backtest.candidateReason
    });
  }
  players.sort((a,b)=>a.player.localeCompare(b.player));
  const covered=players.filter(p=>p.candidateReason==null);
  const avg=key=>covered.length?Number((covered.reduce((s,p)=>s+Number(p[key]||0),0)/covered.length).toFixed(2)):null;
  return {
    version:'hunter-phase2-research-report-v1',
    inputs:{
      ledgerSha256:sha256(ledgerRows||[]),
      recordsSha256:sha256(recordsByPlayer||{})
    },
    provider:{version:replay.providerVersion,scale:replay.providerScale},
    candidate:{version:candidate.version},
    summary:{
      players:players.length,
      candidateReadyPlayers:covered.length,
      averageBaselineScore:avg('baselineScore'),
      averageCandidateScore:avg('candidateScore'),
      averageScoreDelta:avg('scoreDelta'),
      averageMaxBaselineJump:avg('maxBaselineJump'),
      averageMaxCandidateJump:avg('maxCandidateJump')
    },
    players,
    officialScoreChanged:false,
    researchOnly:true
  };
}

if(require.main===module){
  const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
  const input=value('--input');
  if(!input){console.error('Usage: node scripts/hunter-phase2-research-report.cjs --input dataset.json [--output report.json]');process.exit(2);}
  const parsed=JSON.parse(fs.readFileSync(input,'utf8'));
  if(!parsed||!Array.isArray(parsed.ledgerRows)||!parsed.recordsByPlayer||typeof parsed.recordsByPlayer!=='object')throw Error('research-dataset-invalid');
  const report=buildReport(parsed);
  const json=JSON.stringify({...report,generatedAt:new Date().toISOString()},null,2)+'\n';
  if(value('--output'))fs.writeFileSync(value('--output'),json);else process.stdout.write(json);
}
module.exports={buildReport,alias,bucketOpponentStrength,repeatOpponentSummary};

const fs=require('node:fs'),crypto=require('node:crypto');
const source=fs.readFileSync('../../modules/main-app/core.js','utf8');
function take(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<0)throw Error('renderer seam missing');return source.slice(a,b);}
const parts=[take('function matchBoxHtml(', '\nfunction refereeBracketRoundtripNav('),take('function renderRefereeScorePanel(', '\nfunction renderSkippedMatches('),take('function matchStatusBarHtml(', '\nfunction matchLegendHtml('),take('function matchScoreCellHtml(', '\nfunction matchBoxHtml('),take('function checkWinnerSide(', '\nfunction tournamentScoringUnlocked(')];
const wrapper=`// Source-extracted renderer functions; only surrounding presentation/auth stubs are lab-specific.
let state,pendingModal=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const playerName=id=>state.players.find(p=>p.id===id)?.name||id;
const playerBracketRowHtml=(id,name)=>'<span>'+esc(name)+'</span>';
const MATCH_STATUS_LABELS={completed:'已完成',in_progress:'進行中',pending:'等待中',ready:'預備',paused:'暫停'};
const POINT_LABELS={spin:'旋轉 +1',knockout:'擊飛 +2',burst:'爆裂 +2',extreme:'極限 +3'};
const canOperateStation=()=>true,refereeUploadPending=()=>false,refereeFaultWritePending=()=>false,refereeFaultCount=()=>0,refereeFaultLast=()=>null;
const refereeCourtSwapButton=()=>'',refereeViewClass=()=>'',refereeSwapControl=()=>'',refereeUploadStatusHtml=()=>'',courtSwapMatchClass=()=>'',activeMatchCourtAtmosphereStyle=()=>'',courtSwapMatchBadge=()=>'';
const matchStatusClass=m=>m.status||'pending';
${parts.join('\n')}
export function render(view,mode){state={...view,startedAt:1};
 if(mode==='referee')return Object.values(view.courtAssignments).map(c=>view.matches.find(m=>m.id===c.currentMatchId)).filter(Boolean).map(m=>'<section class="referee-workstation" data-match="'+m.id+'">'+renderRefereeScorePanel(m,m.station)+'</section>').join('');
 return view.matches.filter(m=>!m.isBye).map(m=>matchBoxHtml(m,m.id)).join('');}
`;
fs.writeFileSync('arena-renderers.mjs',wrapper);fs.mkdirSync('evidence',{recursive:true});fs.writeFileSync('evidence/renderer-source.json',JSON.stringify({source:'modules/main-app/core.js',sha256:crypto.createHash('sha256').update(source).digest('hex'),functions:['matchBoxHtml','renderRefereeScorePanel','matchStatusBarHtml','matchScoreCellHtml','quickModeTagHtml','checkWinnerSide'],stubbed:['permission/upload/pending-fault/presentation decoration helpers'],productionRouter:false},null,2));

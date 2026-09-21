const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const V=require('../ladder-v1.js');
let assertions=0;
function eq(a,b){assert.deepEqual(a,b);assertions++;}
for(const [n,w,p] of [[16,1,100],[32,1.5,145],[64,2,190],[100,2.28125,215],[127,2.4921875,234],[128,2.5,235],[256,3,280],[512,3.5,325]]){
  eq(V.multiplier(n),w);eq(10+Math.round(V.bonus(1,n,1)*w),p);
}
for(let n=2;n<=512;n++){assert(V.multiplier(n)>=V.multiplier(n-1));assertions++;}
for(const n of [0,-1,513,NaN,1.5]) assert.throws(()=>V.multiplier(n));
for(const t of V.tiers){eq(V.tier(t.min),t.name);if(t.min>1)eq(V.tier(t.min-1),V.tiers[V.tiers.indexOf(t)-1].name);}
eq(V.bonus(1,128,0),0);
for(const [place,threshold,b] of [[17,64,8],[33,96,6],[65,128,4],[97,160,2]]){
  eq(V.bonus(place,threshold,1),0);eq(V.bonus(place,threshold+1,1),b);
}
function single(n){
  const players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'Player '+i,accountUid:'u'+i}));
  const size=2**Math.ceil(Math.log2(n));
  let slots=Array.from({length:size},(_,i)=>i<n?players[i].id:null),round=0,seq=0;
  const matches=[];let semis=[];
  while(slots.length>1){
    const next=[];
    for(let i=0;i<slots.length;i+=2){
      const a=slots[i],b=slots[i+1],winner=a||b,loser=a&&b?b:null;
      matches.push({id:'m'+seq++,bracket:'SE',round,a:a?{playerId:a}:null,b:b?{playerId:b}:null,isBye:!a||!b,completed:true,winnerId:winner,loserId:loser});
      next.push(winner);if(slots.length===4&&loser)semis.push(loser);
    }
    slots=next;round++;
  }
  const final=matches.at(-1);
  if(semis.length===2)matches.push({id:'bronze',bracket:'BZ',round:round-2,a:{playerId:semis[0]},b:{playerId:semis[1]},completed:true,winnerId:semis[0],loserId:semis[1]});
  return {meta:{formatType:'single',eventAuthority:'official'},players,matches,bracketSize:size,
    championId:final.winnerId,runnerUpId:final.loserId,thirdId:semis[0],fourthId:semis[1]};
}
for(const n of [16,32,64,100,127,128,129,256,512]){
  const s=single(n),r=V.analyze(s,s,[]);
  eq(r.count,n);
  eq(r.players.find(x=>x.placement===1).pointsEarned,10+Math.round(90*V.multiplier(n)));
  const firstLoser=r.players.find(x=>x.player.id==='p1');eq(firstLoser.pointsEarned,10);
  assert(r.players.every(x=>Number.isInteger(x.pointsEarned)&&x.pointsEarned>=10));
}
const s=single(16);s.players.push({id:'absent',name:'Absent'});s.matches.push({id:'bye',isBye:true,completed:true,winnerId:'absent',a:{playerId:'absent'},b:null});
eq(V.analyze(s,s,[]).count,16);
eq(V.isPlayed({completed:true,a:{playerId:'a'},b:{playerId:'b'},winnerId:'a',resultMethod:'forfeit'}),false);
eq(V.isPlayed({completed:true,a:{playerId:'a'},b:{playerId:'b'},winnerId:'x'}),false);
const t=single(16);t.players[1].source='test';eq(V.analyze(t,t,[]).count,15);
// Same elimination cohort gets the best place, including crossing the 96-place boundary.
const large=single(256),cohort=V.analyze(large,large,[]).players.filter(x=>x.placement===65);
eq(cohort.length,64);assert(cohort.every(x=>x.scoring.placementBonus===4));
const d={meta:{formatType:'double'},players:['a','b','c','d','e','f'].map(id=>({id})),matches:[
  {bracket:'WB',round:0,a:{playerId:'a'},b:{playerId:'e'},winnerId:'e',completed:true},
  {bracket:'WB',round:0,a:{playerId:'b'},b:{playerId:'f'},winnerId:'f',completed:true},
  {bracket:'LB',round:0,a:{playerId:'a'},b:{playerId:'e'},winnerId:'a',completed:true},
  {bracket:'LB',round:0,a:{playerId:'b'},b:{playerId:'f'},winnerId:'b',completed:true},
  {bracket:'LB',round:1,a:{playerId:'a'},b:{playerId:'d'},winnerId:'a',completed:true},
  {bracket:'LB',round:2,a:{playerId:'a'},b:{playerId:'c'},winnerId:'a',completed:true},
  {bracket:'GF',round:0,a:{playerId:'a'},b:{playerId:'b'},winnerId:'a',completed:true}
]};
const dr=V.analyze(d,{championId:'a',runnerUpId:'b',thirdId:'c',fourthId:'d'},[]);
eq(dr.players.find(x=>x.player.id==='e').placement,5);eq(dr.players.find(x=>x.player.id==='f').placement,5);
// Parse every inline script, not merely the added file.
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
let scriptCount=0;
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc\s*=/.test(m[1])||/application\/ld\+json/.test(m[1]))continue;
  if(/type=["']module/.test(m[1]))new vm.SourceTextModule(m[2]);
  else new vm.Script(m[2]);scriptCount++;
}
assert(html.indexOf('src="ladder-v1.js')<html.indexOf('const LADDER_TIERS'));
console.log(`PASS ${assertions} scoring assertions; ${scriptCount} inline scripts parse`);
module.exports={single};

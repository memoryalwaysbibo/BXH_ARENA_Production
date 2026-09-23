const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const needles=[
  'async function performAutoArchive',
  'function performAutoArchive',
  '測試積分賽必須連上 Firebase',
  '至少需要兩位有效參賽者才能結算積分',
  'testPlayerKey',
  'TEST-S1',
  'settleTest',
  'settlementPhase="ladder"',
  'settlementPhase="processing"',
  'settleLadderTournament',
  'buildLadderSettlementPayload'
];
let out='';
for(const needle of needles){
  out += '\n\n===== '+needle+' =====\n';
  let pos=0,count=0;
  while((pos=html.indexOf(needle,pos))>=0 && count<8){
    const start=Math.max(0,pos-5000), end=Math.min(html.length,pos+9000);
    out += '\n--- match '+(count+1)+' @ '+pos+' ---\n';
    out += html.slice(start,end);
    pos += needle.length;
    count++;
  }
  if(count===0) out += '(no match)\n';
}
fs.mkdirSync('diagnostics',{recursive:true});
fs.writeFileSync('diagnostics/settlement-routing-snippets.txt',out);
console.log('wrote diagnostics',out.length);

const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const needles=[
  'function isOwnTestTournament',
  'isOwnTestTournament()',
  'async settleTestLadderTournament',
  'settleTestLadderTournament(code',
  '至少需要兩位有效參賽者才能結算積分',
  'testLadderEnabled',
  'testPlayerKey:',
  'testPlayerKey||',
  'TEST-S1',
  'function createTest',
  '測試玩家',
  'virtual',
  '虛擬'
];
let out='';
for(const needle of needles){
  out+='\n\n===== '+needle+' =====\n';
  let pos=0,count=0;
  while((pos=html.indexOf(needle,pos))>=0 && count<6){
    const start=Math.max(0,pos-3000),end=Math.min(html.length,pos+5000);
    out+='\n--- match '+(count+1)+' @ '+pos+' ---\n'+html.slice(start,end);
    pos+=needle.length;count++;
  }
  if(!count)out+='(no match)\n';
}
fs.mkdirSync('diagnostics',{recursive:true});
fs.writeFileSync('diagnostics/settlement-routing-snippets.txt',out);
console.log('wrote diagnostics',out.length);

const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const needles=[
  'async settleTestLadderTournament',
  '至少需要兩位有效參賽者才能結算積分',
  'source:"test"',
  "source:'test'",
  'testPlayerKey:',
  '測試名單',
  'random-test',
  'test-roster',
  'TEST_PLAYER'
];
let out='';
for(const needle of needles){
  out+='\n===== '+needle+' =====\n';
  let pos=0,count=0;
  while((pos=html.indexOf(needle,pos))>=0 && count<4){
    out+='\n--- '+(++count)+' @'+pos+' ---\n'+html.slice(Math.max(0,pos-2200),Math.min(html.length,pos+5200));
    pos+=needle.length;
  }
  if(!count)out+='(no match)\n';
}
fs.mkdirSync('diagnostics',{recursive:true});
fs.writeFileSync('diagnostics/settlement-routing-snippets.txt',out);
console.log(out.length);

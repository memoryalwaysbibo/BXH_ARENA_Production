'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2]||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')+'\n'+fs.readFileSync(path.join(root,'modules','main-app','core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'modules','cloud','cloud-runtime.js'),'utf8');
let count=0;
const test=(label,fn)=>{fn();count++;console.log('PASS '+label);};

test('battle mode labels exist',()=>{
  assert(html.includes('const BATTLE_MODE_LABELS = { individual:"個人戰", team:"團體戰" };'));
  assert(html.includes('const PLAY_MODE_LABELS = { standard:"標準規則", enchantment:"附魔之戰" };'));
});

test('default tournament remains individual and backward compatible',()=>{
  assert(html.includes('battleMode:"individual", teamSize:3, playMode:"standard"'));
  assert(html.includes('teams:[]'));
});

test('settings expose three independent dimensions',()=>{
  assert(html.includes('<label>對戰形式</label><select id="f-battle-mode"'));
  assert(html.includes('<label>賽事制度</label><select id="f-format"'));
  assert(html.includes('<label>戰鬥規則</label><select id="f-play-mode"'));
});

test('team size is fixed per event and minimum three',()=>{
  assert(html.includes('id="f-team-size"'));
  assert(html.includes('min="3"'));
  assert(html.includes('本場固定為 ${Math.max(3,parseInt(d.teamSize,10)||3)}V${Math.max(3,parseInt(d.teamSize,10)||3)}'));
  assert(html.includes('field==="teamSize"?Math.max(3,parseInt(el.value,10)||3)'));
});

test('draft and save persist battle mode and team size',()=>{
  assert(html.includes('battleMode:m.battleMode==="team"?"team":"individual"'));
  assert(html.includes('settingsFormDraft.battleMode=val("f-battle-mode"'));
  assert(html.includes('const newBattleMode=d.battleMode==="team"?"team":"individual";'));
  assert(html.includes('state.meta.battleMode=newBattleMode;'));
  assert(html.includes('state.meta.teamSize=newTeamSize;'));
});

test('changing team architecture invalidates an existing bracket',()=>{
  assert(html.includes('const battleModeChanged='));
  assert(html.includes('if((formatChanged||battleModeChanged) && state.matches.length>0)'));
  assert(html.includes('更換對戰形式、隊伍人數或賽事制度將清除目前對戰表'));
});

test('unfinished team enchantment is guarded but future schema remains combinable',()=>{
  assert(html.includes('settingsFormDraft.battleMode!=="team"&&settingsFormDraft.formatType==="single"'));
  assert(html.includes('d.battleMode!=="team"&&d.formatType==="single"'));
  assert(html.includes('資料結構已預留未來「團體附魔戰」'));
});

test('publish preview shows all three dimensions',()=>{
  assert(html.includes('["對戰形式", (BATTLE_MODE_LABELS[sm.battleMode]||"個人戰")'));
  assert(html.includes('["賽事制度", FORMAT_LABELS[sm.formatType]'));
  assert(html.includes('["戰鬥規則", PLAY_MODE_LABELS[sm.playMode]'));
});

test('cloud metadata carries team foundation fields',()=>{
  const battle=(html.match(/battleMode: data\.meta && data\.meta\.battleMode==="team"/g)||[]).length;
  const teamSize=(html.match(/teamSize: Math\.max\(3,Number\(data\.meta && data\.meta\.teamSize\)\|\|3\)/g)||[]).length;
  assert(battle>=2);
  assert(teamSize>=2);
});

console.log('PASS '+count+' team battle foundation regression cases.');

'use strict';
// Isolated Chromium integration: real regional loader and ranking renderers,
// synthetic callable responses. No authentication or production data access.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
function between(a,b){return core.slice(core.indexOf(a),core.indexOf(b,core.indexOf(a)));}
for(const width of [390,1280])test('regional ranking interactions in Chromium at '+width+'px',async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<main id="app"></main>');
    await page.addScriptTag({content:`
      let ladderPublicData={players:[{uid:'a',playerName:'仁德玩家',seasonPoints:50,careerPoints:100},{uid:'b',playerName:'左營玩家',seasonPoints:100,careerPoints:200}]};
      let ladderPublicLoaded=true,ladderPublicError='',firebaseUser={uid:'a'};
      const LADDER_TIER_INDEX={青銅:1};
      function ladderTierFromPoints(){return '青銅';}function ladderDisplayTier(){return '青銅';}
      function esc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
      function renderLadderLeaderboardPage(){return '';}function ladderLeaderboardTable(){return '';}
      window.qa={calls:0,fail:false,locations:{a:{city:'台南市',region:'仁德區'},b:{city:'高雄市',region:'左營區'}}};
      window.cloudSync={getLadderLocations:async ids=>{qa.calls++;await new Promise(r=>setTimeout(r,100));if(qa.fail)throw Error('offline');return {ok:true,version:1,locations:Object.fromEntries(ids.map(uid=>[uid,qa.locations[uid]]))};}};
    `});
    await page.addScriptTag({path:path.join(root,'modules/main-app/ladder-location.js')});
    await page.addScriptTag({content:between('const TAIWAN_CITY_DISTRICTS=','function profileCityOptionsHtml')+between('function ladderCompare(','function defaultLadderProfile(')+between('let ladderLocationCity=','let ladderAdminLogs=')});
    await page.addScriptTag({path:path.join(root,'ladder-secondary-ui.js')});
    await page.addScriptTag({content:`
      function render(){
        document.querySelector('#app').innerHTML='<select id="city"><option value="">全部</option><option>台南市</option><option>高雄市</option></select><select id="district"><option value="">全部</option><option>仁德區</option><option>東區</option></select><button id="refresh">重新整理</button><div id="board">'+ladderLeaderboardTable([],false)+'</div>';
        document.querySelector('#city').value=ladderLocationCity;document.querySelector('#district').value=ladderLocationRegion;
        document.querySelector('#city').onchange=e=>{ladderLocationCity=e.target.value;ladderLocationRegion='';render();};
        document.querySelector('#district').onchange=e=>{ladderLocationRegion=e.target.value;render();};
        document.querySelector('#refresh').onclick=()=>{ladderPublicData={...ladderPublicData};render();};
      }
      render();
    `});
    assert.equal(await page.evaluate(()=>qa.calls),0);
    await page.selectOption('#city','台南市');
    assert.match(await page.locator('#board').innerText(),/正在讀取玩家最新地區/);
    await page.getByText('仁德玩家',{exact:true}).first().waitFor();
    await page.selectOption('#district','仁德區');
    assert.match(await page.locator('.ladder-my-rank').innerText(),/NO\.1/);
    assert.equal(await page.locator('.ladder-rank-row-v2').count(),1);
    await page.selectOption('#district','東區');
    assert.match(await page.locator('#board').innerText(),/此地區目前沒有符合/);
    assert.doesNotMatch(await page.locator('#board').innerText(),/尚無玩家取得/);
    await page.evaluate(()=>{qa.fail=true;});await page.click('#refresh');
    await page.getByText(/地區資料讀取失敗/).waitFor();
    assert.doesNotMatch(await page.locator('#board').innerText(),/尚未上榜|尚無玩家取得/);
    await page.selectOption('#city','');
    assert.equal(await page.locator('.ladder-rank-row-v2').count(),2);
    await page.evaluate(()=>{qa.fail=false;qa.locations.a={city:'',region:''};});
    await page.click('#refresh');await page.selectOption('#city','台南市');
    await page.getByText(/此地區目前沒有符合/).waitFor();
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

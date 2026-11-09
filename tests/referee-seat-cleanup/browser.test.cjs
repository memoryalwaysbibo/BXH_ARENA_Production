'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),makeFixture=require('./browser-fixture.cjs');
const resultDir=path.join(root,'test-results/referee-seat-cleanup');fs.mkdirSync(resultDir,{recursive:true});
const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
const start=cloud.indexOf('    subscribeRefereeSeats(code,callback){'),end=cloud.indexOf('\n    async mutateMatchTransaction',start);
assert(start>=0&&end>start);const fragment=cloud.slice(start,end).trim().replace(/,$/,'');
const routes={'/':()=>makeFixture(root),'/core.js':()=>fs.readFileSync(path.join(root,'modules/main-app/core.js')),'/cloud-runtime.js':()=>cloud,'/referee-seats.js':()=>fs.readFileSync(path.join(root,'modules/main-app/referee-seats.js')),'/subscribe-fragment.js':()=>fragment};
(async()=>{const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const read=routes[pathname];if(!read){res.writeHead(404).end();return;}res.setHeader('Content-Type',pathname==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(read());});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{browser=await chromium.launch();const origin=`http://127.0.0.1:${server.address().port}`;
for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['tablet',768,1024]]){const context=await browser.newContext({viewport:{width,height}});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#results').textContent.includes('TOTAL'),null,{timeout:15000});const output=await page.locator('#results').innerText();fs.writeFileSync(path.join(resultDir,name+'.txt'),output+'\nPage errors: '+JSON.stringify(errors));await page.screenshot({path:path.join(resultDir,name+'.png'),fullPage:true});console.log(name+'\n'+output);assert(output.includes('TOTAL 13 PASS / 0 FAIL'));assert.deepEqual(errors,[]);await context.close();}
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});

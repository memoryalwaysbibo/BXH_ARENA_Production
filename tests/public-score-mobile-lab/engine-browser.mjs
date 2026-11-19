import http from 'node:http';import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {commit} from './mobile-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),{fixture}=require('./engine-fixture.cjs'),B=require('./bridge.cjs');
const f=fixture();let view=f.projection(),revision=0,tail=Promise.resolve();
await commit([['labRooms/engine96',{visibility:'public'}],['labRooms/engine96/public/legacy',{view:JSON.stringify(view)}],['labRooms/engine96/public/checkpoint',{packet:JSON.stringify(B.checkpoint(view,'e-engine96',0))}]]);
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','text/html; charset=utf-8');
 if(req.url==='/engine.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync('engine-bundle.js'));}
 if(req.url==='/referee.css'){res.setHeader('Content-Type','text/css');return res.end(fs.readFileSync('../../referee-score-v2.css'));}
 if(req.url==='/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(view));}
 if(req.url==='/command'&&req.method==='POST'){
  let data='';for await(const c of req){data+=c;if(data.length>4096){res.statusCode=413;return res.end();}}
  tail=tail.then(async()=>{try{const input=JSON.parse(data);if(!['score','undo','confirm','skip'].includes(input.action))throw Error('invalid-action');
   f.run(input.action,input.id,{...(input.side?{side:input.side}:{}),...(input.finish?{finish:input.finish}:{})});const next=f.projection(),packet=B.delta(view,next,'e-engine96',revision++);view=next;
   await commit([['labRooms/engine96/public/legacy',{view:JSON.stringify(view)}],['labRooms/engine96/public/checkpoint',{packet:JSON.stringify(B.checkpoint(view,'e-engine96',revision))}],['labRooms/engine96/deltas/'+String(revision).padStart(6,'0'),{revision,packet:JSON.stringify(packet)}]]);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({view,revision}));
  }catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});return;
 }
 res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/referee.css"><style>body{margin:8px;font:16px sans-serif}.referee-workstation,.match-box{padding:8px;border:1px solid #aaa;margin-bottom:8px}.mb-row{display:flex;justify-content:space-between}.side-panel{min-width:0}.score-btns{display:flex;flex-wrap:wrap}button{min-height:40px}</style><main id="arena"></main><script type="module" src="/engine.js"></script>');
});
let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',chromiumSandbox:true,headless:true});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const ref=await context.newPage(),watch=await context.newPage(),base='http://127.0.0.1:'+server.address().port;
 await ref.goto(base+'/?mode=referee');await watch.goto(base+'/?mode=spectator');await ref.waitForFunction(()=>engineLab.ready);await watch.waitForFunction(()=>engineLab.ready&&engineLab.states.at(-1)?.state==='live');
 const id=f.current()[0].id,player=f.current()[0].a.playerId;
 // Expected revision is captured before click; browser action is asynchronous.
 const action=async(selector,target=id)=>{const expected=revision+1;await ref.locator(`[data-match="${target}"] ${selector}`).click();await watch.waitForFunction(r=>engineLab.revision===r,expected);assert.deepEqual(await watch.evaluate(()=>engineLab.view),view);};
 await action('[data-action="score"][data-side="A"][data-type="spin"]');assert.equal(await watch.locator(`[data-id="${id}"] .sc`).first().textContent(),'1');
 await action('[data-action="undo-score"]');assert.equal(await watch.locator(`[data-id="${id}"] .sc`).first().textContent(),'');
 await action('[data-action="score"][data-side="A"][data-type="extreme"]');await action('[data-action="score"][data-side="A"][data-type="spin"]');await action('[data-action="confirm-result"]');
 assert.equal(await watch.locator(`[data-id="${id}"] .winner`).count(),1);assert.equal(view.matches.find(m=>m.id===id).winnerId,player);assert(view.matches.some(m=>m.id!==id&&(m.a?.playerId===player||m.b?.playerId===player)),'winner advancement absent');
 const pass=f.current().find(m=>m.status==='in_progress');await action('[data-action="skip-match"]',pass.id);assert(view.matches.find(m=>m.id===pass.id).skippedAt);
 console.log('PASS actual renderer score/undo/confirm/PASS and advancement assertions; capturing evidence');
 await ref.bringToFront();await ref.screenshot({path:'evidence/actual-renderer-referee-390.png',animations:'disabled',timeout:15000});await watch.bringToFront();await watch.screenshot({path:'evidence/actual-renderer-spectator-390.png',animations:'disabled',timeout:15000});
 console.log(JSON.stringify({passed:true,actualEngine:'scoring-core.transition',generatedBracketPlayers:96,courts:6,browser:true,rendererFunctions:'source extracted from ARENA core',commands:revision,scoreUndoConfirmPass:true,advancement:true,transport:'local demo HTTP command adapter -> Firestore emulator -> public SDK spectator',productionCallable:false,productionRouter:false,realMobile:false}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

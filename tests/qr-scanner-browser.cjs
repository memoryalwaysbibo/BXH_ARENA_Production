'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
const scanner=core.slice(core.indexOf('function setQrScannerStatus('),core.indexOf('/* ==== registration QR deep-link'));
const modal=core.slice(core.indexOf('function qrScannerModalMarkup(){'),core.indexOf('\nfunction ',core.indexOf('function syncQrScannerModal(){')+30));
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:430,height:932}});
    await page.route('https://arena.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><div id="app"></div>'}));
    await page.goto('https://arena.test/');
    await page.addScriptTag({content:`
      let qrScannerOpen=true,qrScannerStatus='',qrScannerStream=null,qrScannerVideoElement=null,qrScannerFrame=null,qrScannerBusy=false;
      const esc=String;let mediaCalls=0,stops=0,pixel=0;
      const camera=document.createElement('canvas');camera.width=640;camera.height=480;
      function paint(){const c=camera.getContext('2d');c.fillStyle=pixel++%2?'#e22':'#2e2';c.fillRect(0,0,640,480);requestAnimationFrame(paint);}paint();
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
        mediaCalls++;const stream=camera.captureStream(20);
        for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stops++;stop();};}
        return stream;
      }}});
      window.jsQR=()=>null;window.BarcodeDetector=undefined;
      ${scanner}
      ${modal}
      function render(){syncQrScannerModal();document.querySelector('#app').innerHTML='<p>background update '+Date.now()+'</p>'+renderQrScannerModal();}
      window.fixture={render,close(){stopQrScanner();qrScannerOpen=false;render();},open(){qrScannerOpen=true;qrScannerAttempted=false;render();},stats:()=>({mediaCalls,stops,status:qrScannerStatus})};
      render();
    `});
    await page.waitForFunction(()=>{const v=document.querySelector('#qr-scanner-video');return v?.readyState>=2&&v.videoWidth>0&&!v.paused;});
    const original=await page.locator('#qr-scanner-video').elementHandle();
    await page.evaluate(async()=>{for(let i=0;i<30;i++){fixture.render();await new Promise(r=>setTimeout(r,15));}});
    assert.equal(await original.evaluate(v=>v===document.querySelector('#qr-scanner-video')&&v.isConnected&&!v.paused),true);
    assert.equal((await page.evaluate(()=>fixture.stats())).mediaCalls,1);
    assert.equal(await page.locator('#app #qr-scanner-video').count(),0);
    await page.evaluate(()=>fixture.close());assert.equal(await page.locator('#qr-scanner-portal').count(),0);
    assert.equal((await page.evaluate(()=>fixture.stats())).stops,1);
    await page.evaluate(()=>fixture.open());
    await page.waitForFunction(()=>{const v=document.querySelector('#qr-scanner-video');return v?.readyState>=2&&v.videoWidth>0&&!v.paused;});
    assert.equal((await page.evaluate(()=>fixture.stats())).mediaCalls,2);
    await page.evaluate(()=>fixture.close());
    console.log('PASS QR camera preview survives 30 app renders and closes/reopens with real canvas MediaStream');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

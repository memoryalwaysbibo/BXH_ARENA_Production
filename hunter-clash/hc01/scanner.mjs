import {parsePairingPayload} from './pairing.mjs';
export function decodePairingPixels(image,decoder){
  if(typeof decoder!=='function')throw Error('qr-decoder-unavailable');
  const found=decoder(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
  return found?{payload:found.data,...parsePairingPayload(found.data)}:null;
}
export function createScanner({video,canvas,mediaDevices=globalThis.navigator?.mediaDevices,decoder=globalThis.jsQR,
  detectorFactory=()=>globalThis.BarcodeDetector?new BarcodeDetector({formats:['qr_code']}):null,
  schedule=callback=>setTimeout(callback,150),unschedule=clearTimeout,onPairing,onMessage=()=>{}}){
  let generation=0,stream=null,timer=null,detector=null,running=false;
  function stop(){generation++;running=false;if(timer!==null)unschedule(timer);timer=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;}
  async function start(){
    stop();const current=generation;
    if(!mediaDevices?.getUserMedia)throw Error('camera-unavailable');
    try{
      const acquired=await mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
      stream=acquired;video.srcObject=stream;await video.play();if(current!==generation)return;
      try{detector=detectorFactory();}catch{detector=null;}
      if(!detector&&typeof decoder!=='function')throw Error('qr-decoder-unavailable');running=true;
      const frame=async()=>{
        if(!running||current!==generation)return;
        try{
          let payload=null;
          if(detector){try{const codes=await detector.detect(video);payload=codes[0]?.rawValue;}catch{detector=null;}}
          if(!payload&&typeof decoder==='function'&&video.videoWidth&&video.videoHeight){
            canvas.width=Math.min(video.videoWidth,640);canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth);
            const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(video,0,0,canvas.width,canvas.height);
            const found=decoder(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});payload=found?.data;
          }
          if(current!==generation)return;
          if(payload){const pairing=parsePairingPayload(payload);stop();onPairing({payload,...pairing});return;}
        }catch{if(current===generation)onMessage('請掃描獵人交鋒配對碼，或貼上配對資料。');}
        if(current===generation&&running)timer=schedule(frame);
      };await frame();
    }catch(error){if(current===generation)stop();throw error;}
  }
  return Object.freeze({start,stop,dispose:stop});
}

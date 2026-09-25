/* P7.13: local image preparation and strict poster contract. No persistence or writes. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BxhPoster=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const CONTRACT='bxh-arena.ai-poster.callable.v1';
  const SCHEMA='bxh-arena.ai-create.v1';
  const MAX_BYTES=1572864,MAX_SIDE=2048,MAX_FILE=12*1024*1024;
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  function fitSize(width,height){
    if(!Number.isInteger(width)||!Number.isInteger(height)||Math.min(width,height)<64||width*height>32000000)fail('poster-local-dimensions');
    const scale=Math.min(1,MAX_SIDE/Math.max(width,height));
    const w=Math.floor(width*scale),h=Math.floor(height*scale);
    if(Math.min(w,h)<64)fail('poster-local-dimensions');
    return {width:w,height:h};
  }
  function waitForImage(url){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      const done=(error)=>{clearTimeout(timer);image.onload=image.onerror=null;if(error){image.src='';reject(error);}else resolve(image);};
      const timer=setTimeout(()=>done(new Error('poster-local-timeout')),20000);
      image.onload=()=>done();image.onerror=()=>done(new Error('poster-local-decode'));
      image.src=url;
    });
  }
  function canvasBlob(canvas,mime,quality){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('poster-local-timeout')),15000);
      try{canvas.toBlob(blob=>{clearTimeout(timer);blob?resolve(blob):reject(new Error('poster-local-decode'));},mime,quality);}
      catch(e){clearTimeout(timer);reject(new Error('poster-local-decode'));}
    });
  }
  function blobBase64(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      const timer=setTimeout(()=>{reader.abort();reject(new Error('poster-local-timeout'));},15000);
      reader.onerror=reader.onabort=()=>{clearTimeout(timer);reject(new Error('poster-local-decode'));};
      reader.onload=()=>{clearTimeout(timer);const value=String(reader.result||'');const prefix='data:'+blob.type+';base64,';value.startsWith(prefix)?resolve(value.slice(prefix.length)):reject(new Error('poster-local-decode'));};
      reader.readAsDataURL(blob);
    });
  }
  async function prepareImage(file){
    if(!file||!['image/jpeg','image/png'].includes(file.type))fail('poster-local-format');
    if(!Number.isFinite(file.size)||file.size<=0||file.size>MAX_FILE)fail('poster-local-size');
    const original=URL.createObjectURL(file);
    let image,canvas;
    try{
      image=await waitForImage(original);
      let size=fitSize(image.naturalWidth,image.naturalHeight);
      canvas=document.createElement('canvas');
      let blob;
      for(let pass=0;pass<5;pass++){
        canvas.width=size.width;canvas.height=size.height;
        const context=canvas.getContext('2d');if(!context)fail('poster-local-decode');
        context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(image,0,0,canvas.width,canvas.height);
        blob=await canvasBlob(canvas,'image/png');
        if(blob.size>MAX_BYTES)blob=await canvasBlob(canvas,'image/jpeg',0.9);
        if(blob.size>MAX_BYTES)blob=await canvasBlob(canvas,'image/jpeg',0.75);
        if(blob.size<=MAX_BYTES)break;
        size={width:Math.floor(size.width*0.8),height:Math.floor(size.height*0.8)};
        if(Math.min(size.width,size.height)<64)fail('poster-local-dimensions');
      }
      if(!blob||blob.size>MAX_BYTES||!['image/jpeg','image/png'].includes(blob.type))fail('poster-local-size');
      const base64=await blobBase64(blob);
      // Separate small cover from the OCR input. The full image never enters room state.
      const side=240,cover=document.createElement('canvas');cover.width=side;cover.height=side;
      const ctx=cover.getContext('2d');if(!ctx)fail('poster-local-decode');
      ctx.fillStyle='#11151b';ctx.fillRect(0,0,side,side);
      const ratio=Math.min(side/image.naturalWidth,side/image.naturalHeight);
      const w=Math.round(image.naturalWidth*ratio),h=Math.round(image.naturalHeight*ratio);
      ctx.drawImage(image,Math.floor((side-w)/2),Math.floor((side-h)/2),w,h);
      const coverBlob=await canvasBlob(cover,'image/jpeg',0.75);
      if(coverBlob.size>120000)fail('poster-local-size');
      const coverBase64=await blobBase64(coverBlob);
      cover.width=1;cover.height=1;
      return {name:String(file.name||'活動海報').slice(0,180),mimeType:blob.type,base64,width:canvas.width,height:canvas.height,byteLength:blob.size,previewUrl:URL.createObjectURL(blob),cover:{mimeType:'image/jpeg',base64:coverBase64,width:side,height:side}};
    }finally{
      URL.revokeObjectURL(original);
      if(image)image.src='';
      if(canvas){canvas.width=1;canvas.height=1;}
    }
  }
  function release(image){if(image&&image.previewUrl)URL.revokeObjectURL(image.previewUrl);}
  function buildRequest(poster,sourceText){
    if(!poster||!['image/jpeg','image/png'].includes(poster.mimeType))fail('poster-local-format');
    if(typeof sourceText!=='string'||sourceText.length>12000)fail('poster-invalid-text');
    const p={mimeType:poster.mimeType,base64:poster.base64,width:poster.width,height:poster.height};
    if(typeof p.base64!=='string'||!p.base64.length||p.base64.length>Math.ceil(MAX_BYTES/3)*4||p.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.base64))fail('poster-invalid-image');
    if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||Math.min(p.width,p.height)<64||Math.max(p.width,p.height)>MAX_SIDE)fail('poster-invalid-dimensions');
    return {contractVersion:CONTRACT,sourceText,poster:p};
  }
  function realDate(value){
    if(value==null)return true;
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function validateEnvelope(raw,validateStructured){
    if(!object(raw)||raw.ok!==true||raw.contractVersion!==CONTRACT||raw.schemaVersion!==SCHEMA||!object(raw.result))fail('poster-invalid-result');
    const r=raw.result;
    if(r.sourceMode!=='poster-callable'||typeof r.posterText!=='string'||!r.posterText.trim()||r.posterText.length>12000)fail('poster-invalid-result');
    if(!Array.isArray(r.warnings)||r.warnings.length>31||r.warnings.some(w=>!object(w)||typeof w.code!=='string'||!w.code||w.code.length>120||typeof w.message!=='string'||!w.message||w.message.length>4000||!['info','warning','error'].includes(w.severity)||(w.field!=null&&typeof w.field!=='string')))fail('poster-invalid-result');
    const checked=validateStructured(r);if(!checked||!checked.ok)fail('poster-invalid-result');
    if(!realDate(r.activity.date)||r.events.some(e=>!realDate(e.date)||!realDate(e.endDate)))fail('poster-invalid-result');
    for(const key of ['name','locationName','address'])if(r.activity[key]!=null&&typeof r.activity[key]!=='string')fail('poster-invalid-result');
    const result=JSON.parse(JSON.stringify(r));
    if(!result.warnings.some(w=>w.code==='poster-review-required'))result.warnings.push({code:'poster-review-required',field:null,severity:'warning',message:'海報辨識可能有錯字或漏字；請房主核對日期、時間、地址、費用、名額與獎品。'});
    return result;
  }
  function evidence(result,source){
    const text=String(source||'').trim();
    if(!result||result.sourceMode!=='poster-callable')return text;
    const poster=String(result.posterText||'').trim();
    return '【海報辨識文字｜請人工核對】\n'+poster+(text?'\n\n【房主補充文案】\n'+text:'');
  }
  function guardMapping(model,result){
    if(!model||!result||result.sourceMode!=='poster-callable')return model;
    const s=model.settings,r=model.registration;
    for(const w of result.warnings||[]){
      if(w.code!=='source-conflict')continue;
      const path=String(w.field||'').replace(/\[\d+\]/g,'').replace(/\.\d+(?=\.|$)/g,'');
      if(/(^|\.)(name)$/.test(path)&&!path.startsWith('venue'))s.name='';
      if(/(^|\.)date$/.test(path))s.date='';
      if(/(locationName|venue\.name)$/.test(path))s.venueName='';
      if(/address$/.test(path))s.venueAddress='';
      if(/checkInStart$/.test(path))s.checkin='';
      if(/startAt$/.test(path))s.startTime='';
      if(/capacity$/.test(path))r.registrationCapacity=null;
      if(/fee(?:\.amount)?$/.test(path))r.registrationFee=null;
      if(/registrationOpenAt$/.test(path))r.registrationOpenAt=null;
      if(/registrationCloseAt$/.test(path))r.registrationCloseAt=null;
      if(/locationName|address|venue|[Mm]aps/.test(path)){s.googleMapsUrl='';s.navigationEnabled=false;}
    }
    s.location=[s.venueName,s.venueAddress].filter(Boolean).join('｜');
    model.warnings.push('海報套用會更新預覽欄位；未辨識的日期、時間、場地、名額與費用留空。既有活動說明與公版選擇不覆蓋。');
    return model;
  }
  function errorMessage(error){
    const code=String(error&&error.message||error&&error.code||'');
    const messages={
      'poster-local-format':'請選擇 JPG 或 PNG 海報；HEIC、PDF、GIF 請先轉成 JPG／PNG。',
      'poster-local-size':'圖片過大；請改用 12 MB 以內的 JPG／PNG，或先縮小圖片。',
      'poster-local-dimensions':'圖片尺寸不適合辨識；短邊需至少 64 像素，原圖不可超過 3,200 萬像素。',
      'poster-local-decode':'無法讀取圖片；請重新匯出 JPG／PNG 後再試。',
      'poster-local-timeout':'圖片處理逾時；請縮小圖片後重試。',
      'beta-not-allowed':'此帳號尚未開放海報辨識，未變更草稿。',
      'auth-required':'登入狀態已失效，請重新登入。',
      'stale-session':'帳號狀態已變更，辨識結果已捨棄。',
      'poster-disabled':'海報辨識服務暫未開放；可移除海報改用純文字解析。',
      'parser-unconfigured':'海報辨識服務尚未完成憑證設定，未變更草稿。',
      'rate-limit':'操作過於頻繁；請稍後再試，草稿未變更。',
      'provider-rate-limited':'辨識服務忙碌；請稍後再試，草稿未變更。',
      'provider-timeout':'海報辨識逾時，請重試或換用更清楚的圖片。',
      'deadline-exceeded':'海報辨識逾時，請重試或換用更清楚的圖片。',
      'not-event-content':'未辨識到活動資訊；請使用文字清楚的活動海報。',
      'poster-invalid-result':'辨識結果未通過檢查，已停止套用；請換圖或補充文字後重試。',
      'poster-invalid-image':'圖片未通過伺服器檢查，請重新選圖。',
      'poster-invalid-dimensions':'圖片尺寸未通過伺服器檢查，請重新選圖。',
      'poster-invalid-text':'補充文案最多 12,000 字。',
      'service-unavailable':'海報服務尚未載入；請重新整理後再試。'
    };
    for(const key of Object.keys(messages))if(code.includes(key))return messages[key];
    return '海報辨識連線失敗；未變更草稿，也不會自動改走純文字解析。';
  }
  return {CONTRACT,MAX_BYTES,MAX_SIDE,MAX_FILE,fitSize,prepareImage,release,buildRequest,validateEnvelope,evidence,guardMapping,errorMessage,realDate};
});

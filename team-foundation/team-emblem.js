(function(root){
'use strict';
const INPUT_TYPES=['image/jpeg','image/png','image/webp'];
const MAX_INPUT=10*1024*1024,MAX_PIXELS=24*1000*1000,SIZE=256,MAX_OUTPUT=128*1024;
async function prepare(file,{decode,canvasFactory}={}){
 if(!file||!INPUT_TYPES.includes(file.type))throw Error('invalid-image-type');
 if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_INPUT)throw Error('invalid-image-size');
 const bitmap=await (decode||root.createImageBitmap)(file);
 try{
  if(!Number.isSafeInteger(bitmap?.width)||!Number.isSafeInteger(bitmap?.height)||bitmap.width<=0||bitmap.height<=0||bitmap.width*bitmap.height>MAX_PIXELS)throw Error('invalid-image-dimensions');
  const canvas=canvasFactory?canvasFactory():root.document.createElement('canvas');canvas.width=SIZE;canvas.height=SIZE;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('image-processing-failed');
  const scale=Math.min(SIZE/bitmap.width,SIZE/bitmap.height),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  ctx.clearRect(0,0,SIZE,SIZE);ctx.drawImage(bitmap,Math.floor((SIZE-width)/2),Math.floor((SIZE-height)/2),width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.82));
  if(!blob||blob.type!=='image/webp'||!Number.isSafeInteger(blob.size)||blob.size<=0||blob.size>MAX_OUTPUT)throw Error('image-processing-failed');
  return blob;
 }finally{bitmap?.close?.();}
}
async function hydrate({items,read,isCurrent=()=>true}){
 const result=items.map(item=>({...item})),queue=result.slice(0,20).filter(item=>item.hasEmblem===true&&typeof item.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(item.id));let index=0;
 async function worker(){while(index<queue.length&&isCurrent()){
  const item=queue[index++];try{const r=await read({teamId:item.id}),image=r?.image,b64=image?.base64;
   if(isCurrent()&&image?.contentType==='image/webp'&&typeof b64==='string'&&b64.length>=16&&b64.length<=174764&&/^UklGR[A-Za-z0-9+/]*={0,2}$/.test(b64))item.emblemSource='data:image/webp;base64,'+b64;
  }catch(_){/* Keep the page usable if one image is unavailable. */}
 }}
 await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));return result;
}
const api={prepare,hydrate,MAX_INPUT,MAX_OUTPUT,SIZE};
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHTeamEmblem=api;
})(typeof window==='object'?window:globalThis);

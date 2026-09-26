/* Mobile signature input. Deliberately has no network or contract activation. */
(function(root){
  'use strict';
  function mount(container, options={}) {
    if(!container || !container.ownerDocument) throw new Error('signature-container-required');
    const doc=container.ownerDocument;
    const canvas=doc.createElement('canvas');
    canvas.setAttribute('aria-label','手寫簽名區');
    canvas.style.cssText='display:block;width:100%;height:220px;background:#fff;border:1px solid #8d94a4;border-radius:8px;touch-action:none;';
    const actions=doc.createElement('div');
    actions.style.cssText='display:flex;gap:8px;margin-top:8px;';
    const clear=doc.createElement('button');clear.type='button';clear.textContent='清除重簽';
    const preview=doc.createElement('button');preview.type='button';preview.textContent='預覽簽名';
    const image=doc.createElement('img');image.alt='簽名預覽';image.hidden=true;
    image.style.cssText='display:block;max-width:100%;margin-top:10px;background:#fff;';
    actions.append(clear,preview);container.append(canvas,actions,image);
    const ctx=canvas.getContext('2d');
    if(!ctx) throw new Error('signature-canvas-unavailable');
    let drawing=false, ink=false, destroyed=false, pointerId=null;
    function resize() {
      const snapshot=ink ? doc.createElement('canvas') : null;
      if(snapshot){snapshot.width=canvas.width;snapshot.height=canvas.height;snapshot.getContext('2d').drawImage(canvas,0,0);}
      const ratio=Math.min(3,Math.max(1,root.devicePixelRatio||1));
      const width=Math.max(1,Math.round((canvas.clientWidth||320)*ratio));
      const height=Math.max(1,Math.round((canvas.clientHeight||220)*ratio));
      if(canvas.width===width && canvas.height===height)return;
      canvas.width=width;canvas.height=height;
      ctx.scale(ratio,ratio);ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#131722';
      if(snapshot)ctx.drawImage(snapshot,0,0,snapshot.width,snapshot.height,0,0,canvas.clientWidth||320,canvas.clientHeight||220);
    }
    function point(event){const box=canvas.getBoundingClientRect();return {x:event.clientX-box.left,y:event.clientY-box.top};}
    function down(event){
      if(destroyed||drawing||event.pointerType==='mouse'&&event.button!==0)return;
      resize();drawing=true;pointerId=event.pointerId;
      canvas.setPointerCapture?.(pointerId);
      const p=point(event);ctx.beginPath();ctx.moveTo(p.x,p.y);
      ctx.lineTo(p.x+0.01,p.y+0.01);ctx.stroke();ink=true;
      event.preventDefault();
    }
    function move(event){
      if(!drawing||event.pointerId!==pointerId)return;
      const p=point(event);ctx.lineTo(p.x,p.y);ctx.stroke();event.preventDefault();
    }
    function up(event){if(event.pointerId===pointerId){drawing=false;pointerId=null;}}
    function erase(){drawing=false;pointerId=null;ink=false;ctx.clearRect(0,0,canvas.width,canvas.height);image.hidden=true;image.removeAttribute('src');}
    function exportPng(){if(!ink)throw new Error('signature-empty');return canvas.toDataURL('image/png');}
    function showPreview(){try{image.src=exportPng();image.hidden=false;return true;}catch{image.hidden=true;return false;}}
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
    clear.addEventListener('click',erase);preview.addEventListener('click',showPreview);
    root.addEventListener?.('resize',resize);resize();
    return {canvas,clear,preview,image,hasInk:()=>ink,exportPng,erase,showPreview,
      destroy(){destroyed=true;root.removeEventListener?.('resize',resize);container.replaceChildren();}};
  }
  const api={mount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BXHPartnerSignaturePad=api;
})(typeof window!=='undefined'?window:globalThis);

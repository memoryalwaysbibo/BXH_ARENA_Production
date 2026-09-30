/* BXH ARENA — My Interface preference controller.
 * UI-only preference. No Firestore dependency; safe default is V1.
 */
(function(global){
  "use strict";
  const STORAGE_KEY="bxh:management-interface";
  const V1="v1",V2="v2";

  function normalize(value){return value===V2?V2:V1;}
  function get(){
    try{return normalize(localStorage.getItem(STORAGE_KEY));}
    catch(_){return V1;}
  }
  function set(value){
    const next=normalize(value);
    try{localStorage.setItem(STORAGE_KEY,next);}catch(_){}
    global.dispatchEvent(new CustomEvent("bxh:interface-change",{detail:{value:next}}));
    return next;
  }
  function apply(options){
    options=options||{};
    const preference=get();
    if(preference===V2&&typeof options.enableV2==="function"){
      try{
        const result=options.enableV2();
        if(result&&result.ok!==false)return {value:V2,ok:true,result};
      }catch(_){}
      if(typeof options.enableV1==="function")options.enableV1();
      return {value:V1,ok:false,fallback:true};
    }
    if(typeof options.enableV1==="function")options.enableV1();
    return {value:V1,ok:true};
  }
  function render(host,options){
    if(!host)return false;
    options=options||{};
    const current=get();
    host.innerHTML='<section class="bxh-interface-picker" aria-label="我的介面">'
      +'<div class="bxh-interface-picker__title"><strong>我的介面</strong><small>選擇管理介面配置</small></div>'
      +'<div class="bxh-interface-picker__options" role="radiogroup">'
      +'<button type="button" data-bxh-interface="v1" role="radio" aria-checked="'+(current===V1)+'"><b>V1</b><span>經典介面</span></button>'
      +'<button type="button" data-bxh-interface="v2" role="radio" aria-checked="'+(current===V2)+'"><b>V2</b><span>新版管理介面</span></button>'
      +'</div></section>';
    host.onclick=function(e){
      const btn=e.target.closest("[data-bxh-interface]");
      if(!btn)return;
      const value=set(btn.dataset.bxhInterface);
      host.querySelectorAll("[data-bxh-interface]").forEach(x=>x.setAttribute("aria-checked",String(x.dataset.bxhInterface===value)));
      if(typeof options.onChange==="function")options.onChange(value);
    };
    return true;
  }

  global.BXH_INTERFACE_PREFERENCE=Object.freeze({V1,V2,STORAGE_KEY,get,set,apply,render});
})(window);

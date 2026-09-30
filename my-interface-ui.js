/* BXH ARENA — My Interface entry.
 * Uses the same dialog pattern as existing personal tools.
 */
(function(global){
  "use strict";

  function open(){
    const pref=global.BXH_INTERFACE_PREFERENCE;
    if(!pref)return false;
    document.getElementById("bxh-interface-dialog")?.close();

    const previous=document.activeElement;
    const dialog=document.createElement("dialog");
    dialog.id="bxh-interface-dialog";
    dialog.className="raffle-claim-dialog";
    dialog.innerHTML='<header><h2>我的介面</h2><button class="btn btn-ghost" data-interface-close>關閉</button></header>'
      +'<p class="hint">選擇你要使用的管理介面。V1 為目前經典版；V2 為新版雙層管理導航。此設定只影響這台裝置。</p>'
      +'<div data-interface-picker></div>'
      +'<p class="hint" data-interface-status role="status" aria-live="polite"></p>';

    const close=()=>{if(dialog.open)dialog.close();dialog.remove();previous?.focus?.();};
    dialog.querySelector("[data-interface-close]").onclick=close;
    dialog.oncancel=e=>{e.preventDefault();close();};
    dialog.onclose=()=>{if(dialog.isConnected)dialog.remove();};

    document.body.appendChild(dialog);
    pref.render(dialog.querySelector("[data-interface-picker]"),{
      onChange(value){
        dialog.querySelector("[data-interface-status]").textContent=
          value===pref.V2?"已選擇 V2，新版管理介面會在可用的管理頁啟用。":"已切回 V1 經典介面。";
      }
    });
    dialog.showModal();
    return true;
  }

  global.openMyInterface=open;
  global.BXH_MY_INTERFACE=Object.freeze({open});
})(window);

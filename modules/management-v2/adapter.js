/* BXH ARENA Management UI V2 — production-safe adapter.
 * Isolated bridge only: never owns business content or tournament state.
 */
(function(global){
  "use strict";

  const DEFAULT_TAB_SELECTORS=[
    "[data-tab]","[data-management-tab]","[data-admin-tab]",
    "[data-view]","[data-section]"
  ];

  function keyFromElement(el){
    if(!el)return null;
    const d=el.dataset||{};
    return d.managementTab||d.adminTab||d.tab||d.view||d.section||null;
  }

  function discoverTabs(root,selectors){
    root=root||document;
    const seen=new Map();
    (selectors||DEFAULT_TAB_SELECTORS).forEach(selector=>{
      root.querySelectorAll(selector).forEach(el=>{
        const key=keyFromElement(el);
        if(key&&!seen.has(key))seen.set(key,el);
      });
    });
    return seen;
  }

  function activeKey(tabMap){
    for(const [key,el] of tabMap){
      if(el.matches(".active,[aria-selected='true'],[aria-current='page']"))return key;
    }
    return tabMap.keys().next().value||null;
  }

  function activate(tabMap,key){
    const el=tabMap.get(key);
    if(el){el.click();return true;}
    const proxy=document.createElement("button");
    proxy.type="button";proxy.hidden=true;proxy.dataset.action="switch-tab";proxy.dataset.tab=key;
    document.body.appendChild(proxy);proxy.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));proxy.remove();return true;
  }

  function mount(options){
    options=options||{};
    const model=global.BXH_MANAGEMENT_UI_V2;
    const host=options.host;
    if(!model||!host)return {ok:false,reason:"missing-model-or-host"};

    // The canonical app already supplies the permitted tab manifest and active
    // tab on every render. V2 must only render navigation; it must never scan
    // or observe the whole application DOM.
    const manifest=String(host.dataset.visibleTabs||"").split(",").map(x=>x.trim()).filter(Boolean);
    const visible=manifest.filter(k=>model.LABELS[k]);
    if(!visible.length)return {ok:false,reason:"no-compatible-tabs"};
    const active=String(host.dataset.activeTab||visible[0]||"");

    function activate(key){
      if(!key)return false;
      const proxy=document.createElement("button");
      proxy.type="button";
      proxy.hidden=true;
      proxy.dataset.action="switch-tab";
      proxy.dataset.tab=key;
      host.appendChild(proxy);
      proxy.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
      proxy.remove();
      return true;
    }

    model.mount({
      host,
      activeTab:active,
      visibleTabs:visible,
      onTab:key=>activate(key),
      onGroup:key=>activate(key)
    });

    return {
      ok:true,
      refresh(){return true;},
      destroy(){host.replaceChildren();},
      get visibleTabs(){return visible.slice();}
    };
  }

  global.BXH_MANAGEMENT_UI_V2_ADAPTER=Object.freeze({
    DEFAULT_TAB_SELECTORS,discoverTabs,activeKey,activate,mount
  });
})(window);

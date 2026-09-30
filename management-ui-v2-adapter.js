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
    document.body.appendChild(proxy);proxy.click();proxy.remove();return true;
  }

  function mount(options){
    options=options||{};
    const model=global.BXH_MANAGEMENT_UI_V2;
    const host=options.host;
    const root=options.root||document;
    if(!model||!host)return {ok:false,reason:"missing-model-or-host"};

    let tabs=discoverTabs(root,options.tabSelectors);
    const manifest=String(host.dataset.visibleTabs||"").split(",").map(x=>x.trim()).filter(Boolean);
    let visible=(manifest.length?manifest:[...tabs.keys()]).filter(k=>model.LABELS[k]);
    if(!visible.length)return {ok:false,reason:"no-compatible-tabs"};

    function draw(){
      tabs=discoverTabs(root,options.tabSelectors);
      visible=(manifest.length?manifest:[...tabs.keys()]).filter(k=>model.LABELS[k]);
      const active=activeKey(tabs);
      model.mount({
        host,
        activeTab:active,
        visibleTabs:visible,
        onTab:key=>{ if(activate(tabs,key)) queueMicrotask(draw); },
        onGroup:key=>{ if(activate(tabs,key)) queueMicrotask(draw); }
      });
    }

    draw();
    const observer=new MutationObserver(()=>draw());
    if(options.observe!==false)observer.observe(root,{subtree:true,attributes:true,attributeFilter:["class","aria-selected","aria-current"]});

    return {
      ok:true,
      refresh:draw,
      destroy(){observer.disconnect();host.replaceChildren();},
      get visibleTabs(){return visible.slice();}
    };
  }

  global.BXH_MANAGEMENT_UI_V2_ADAPTER=Object.freeze({
    DEFAULT_TAB_SELECTORS,discoverTabs,activeKey,activate,mount
  });
})(window);

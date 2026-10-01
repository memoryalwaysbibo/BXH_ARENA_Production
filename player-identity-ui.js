/* BXH ARENA — player identity badge (name + equipped title). UI only. */
(function(global){
  "use strict";
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function normalize(data){
    data=data||{};
    const name=String(data.displayName||data.publicName||data.nickname||data.name||"玩家").trim()||"玩家";
    const title=data.equippedTitle||data.title||null;
    if(!title)return {name,title:null};
    if(typeof title==="string")return {name,title:{label:title,icon:""}};
    return {name,title:{label:String(title.label||title.name||title.title||"").trim(),icon:String(title.icon||title.iconUrl||title.image||"").trim()}};
  }
  function render(host,data,options){
    if(!host)return false;
    const d=normalize(data),o=options||{},layout=o.layout==="inline"?"inline":"stacked";
    const title=d.title&&d.title.label?d.title:null;
    host.className="bxh-player-identity bxh-player-identity--"+layout;
    host.innerHTML='<div class="bxh-player-identity__name">'+esc(d.name)+'</div>'
      +(title?'<div class="bxh-player-identity__title">'
        +(title.icon?'<img class="bxh-player-identity__title-icon" src="'+esc(title.icon)+'" alt="" loading="lazy">':"")
        +'<span>'+esc(title.label)+'</span></div>':"");
    return true;
  }
  global.BXH_PLAYER_IDENTITY=Object.freeze({normalize,render});
})(window);

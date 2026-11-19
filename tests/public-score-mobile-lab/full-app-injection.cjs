"use strict";
// Test-server transformation only. Never included in production assets.
function once(s,a,b){if(s.split(a).length!==2)throw Error('ambiguous integration anchor '+a);return s.replace(a,b);}
function injectCore(s){
 s=once(s,'? window.cloudSync.subscribePublic(code, applyRemoteState)','? window.BXHFullAppLab.subscribe(code, data, applyRemoteState, ()=>{if(state.cloudCode!==code)return;state=Object.assign(defaultState(state.id),{cloudCode:code});queueMicrotask(render);})');
 s=once(s,'function render(){','function render(){\n  window.BXHFullAppLab?.context({phase:appPhase,tab:activeTab,identity:firebaseUser?.uid||"guest",private:publicWatchUsesPrivateData,room:state.cloudCode});');
 return s;
}
module.exports={injectCore};

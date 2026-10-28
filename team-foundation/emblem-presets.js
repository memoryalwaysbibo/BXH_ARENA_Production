(function(root){
'use strict';
const choices=Object.freeze([{id:'shield',name:'盾徽'},{id:'wings',name:'雙翼'},{id:'crown',name:'王冠'},{id:'flame',name:'烈焰'},{id:'bolt',name:'閃電'},{id:'star',name:'星芒'}]);
function normalize(value){
 if(value===undefined)return {id:'shield',color:'#EC536E'};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['id','color'].includes(k))||!choices.some(x=>x.id===value.id)||typeof value.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value.color))throw Error('invalid-emblem-preset');
 return {id:value.id,color:value.color.toUpperCase()};
}
const shapes={shield:'<path d="M32 5 55 14v19c0 13-11 22-23 28C20 55 9 46 9 33V14z"/>',wings:'<path d="m32 24 24-14-8 24-16 20-16-20-8-24zm0 9-16-13 6 14 10 11 10-11 6-14z"/>',crown:'<path d="m7 17 15 12L32 8l10 21 15-12-7 35H14zM15 56h34v5H15z"/>',flame:'<path d="M34 3c6 17 22 22 22 37a24 24 0 0 1-48 0c0-10 7-19 15-26-2 14 4 17 7 18 6-7 6-16 4-29z"/>',bolt:'<path d="M32 3 11 36h17l-3 25 28-38H35L45 3z"/>',star:'<path d="m32 3 9 19 21 3-15 15 3 21-18-10-18 10 3-21L2 25l21-3z"/>'};
function render(value){if(value===null)return '';let preset;try{preset=normalize(value);}catch{return '';}
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="戰隊隊徽" style="max-width:100%;color:'+preset.color+'"><g fill="currentColor" fill-rule="evenodd">'+shapes[preset.id]+'</g></svg>';
}
const api={choices,normalize,render};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHTeamEmblemPresets=api;
})(typeof window==='object'?window:globalThis);

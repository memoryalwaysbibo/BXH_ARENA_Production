'use strict';
// Isolated HTTP fixture: only V2/shared UI assets, never the production app or Firebase.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(process.env.BXH_PILOT_ROOT||process.cwd());
const port=Number(process.env.BXH_PILOT_PORT||4183);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=['modules/management-v2/navigation.js','modules/management-v2/adapter.js',
 'interface-preference.js','my-interface-ui.js','player-identity-ui.js','modules/management-v2/bootstrap.js'];
const styles=['modules/management-v2/styles.css','interface-preference.css','player-identity-ui.css'];
const legacy=['management-ui-v2.js','management-ui-v2-adapter.js','management-ui-v2-bootstrap.js','management-ui-v2.css'];
const allowed=new Set([...scripts,...styles,...legacy,'tests/management-ui-v2-smoke.html']);
function tag(file,kind){
 const matches=Array.from(html.matchAll(kind==='script'?/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g:/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g));
 const found=matches.filter(m=>m[1].split('?')[0]===file);
 if(found.length!==1)throw Error('Expected exactly one entrypoint resource: '+file);
 return found[0][0];
}
const head=styles.map(x=>tag(x,'style')).join('\n');
const tail=scripts.map(x=>tag(x,'script')).join('\n');
const roles={admin:'management,registrations,settings,people,live,bracket,referee,duty,ladder,member-raffles,inventory-admin,operations,history,version',
 staff:'live,bracket,duty,ladder,operations,history,version'};
function fixture(role){
 const tabs=roles[role];if(!tabs)return null;
 return `<!doctype html><html lang="zh-Hant" data-bxh-management-ui="v1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
 <style>:root{--bg-soft:#111;--border:#333;--metal:#aaa;--font-d:Arial;--gold:#d9b95c;--neon:#e9ff2e;--neon-dim:#b9c918}body{margin:0;background:#08090a;color:#fff}header,main{padding:16px}</style>${head}</head><body>
 <header id="kept-header">BXH ARENA</header><div id="bxh-management-v2-nav" data-active-tab="live" data-visible-tabs="${tabs}"></div>
 <main id="kept-content">CANONICAL CONTENT UNCHANGED</main><button id="bxh-my-interface-entry">我的介面</button>
 <script>window.__actions=[];document.body.addEventListener('click',e=>{const b=e.target.closest('[data-action="switch-tab"]');if(b)window.__actions.push(b.dataset.tab);});</script>${tail}</body></html>`;
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');let data,type;
 if(url.pathname==='/fixture') {data=fixture(url.searchParams.get('role')||'admin');type='text/html';}
 else {const file=url.pathname.slice(1);if(allowed.has(file)){data=fs.readFileSync(path.join(root,file));type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html';}}
 if(data==null){res.writeHead(404);res.end('Not in isolated fixture allowlist');return;}
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(data);
});
server.listen(port,'127.0.0.1',()=>console.log('V2 isolated HTTP fixture ready on '+port));

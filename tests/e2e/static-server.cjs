'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const port = Number(process.env.PORT || 4173);
const emulatorMode = process.env.BXH_E2E_EMULATOR === '1';

const types = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.cjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json; charset=utf-8'
};

function safePath(urlPath) {
  const clean = decodeURIComponent((urlPath || '/').split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep) && full !== path.join(root, 'index.html')) return null;
  return full;
}

function replaceOnce(source, needle, replacement, label) {
  const at = source.indexOf(needle);
  if (at < 0) throw new Error('E2E emulator injection point missing: ' + label);
  if (source.indexOf(needle, at + needle.length) >= 0 && label !== 'project-id') {
    throw new Error('E2E emulator injection point is ambiguous: ' + label);
  }
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

function injectFirebaseEmulators(html) {
  let out = html;

  out = replaceOnce(
    out,
    'projectId: "bxh-arena",',
    'projectId: "demo-bxh-arena-e2e",',
    'project-id'
  );

  out = replaceOnce(
    out,
    'FIREBASE_CONFIG.projectId === "bxh-arena"',
    '["bxh-arena","demo-bxh-arena-e2e"].includes(FIREBASE_CONFIG.projectId)',
    'config-presence'
  );

  out = replaceOnce(
    out,
    'dbHandle = fsMod.getFirestore(app);',
    'dbHandle = fsMod.getFirestore(app);\n        const __bxhE2E = location.hostname==="127.0.0.1" && new URLSearchParams(location.search).get("bxh_e2e")==="1";\n        if(__bxhE2E) fsMod.connectFirestoreEmulator(dbHandle,"127.0.0.1",8080);',
    'firestore'
  );

  out = replaceOnce(
    out,
    'functionsHandle = functionsMod.getFunctions(app,"asia-east1");',
    'functionsHandle = functionsMod.getFunctions(app,"asia-east1");\n          if(__bxhE2E) functionsMod.connectFunctionsEmulator(functionsHandle,"127.0.0.1",5001);',
    'functions'
  );

  const authNeedle = 'authHandle = authMod.initializeAuth(app, {\n          persistence: [authMod.browserLocalPersistence, authMod.browserSessionPersistence]\n        });';
  out = replaceOnce(
    out,
    authNeedle,
    authNeedle + '\n        if(__bxhE2E) authMod.connectAuthEmulator(authHandle,"http://127.0.0.1:9099",{disableWarnings:true});',
    'auth'
  );

  if (!out.includes('demo-bxh-arena-e2e') ||
      !out.includes('connectFirestoreEmulator') ||
      !out.includes('connectAuthEmulator') ||
      !out.includes('connectFunctionsEmulator')) {
    throw new Error('E2E emulator injection integrity check failed');
  }
  return out;
}

const server = http.createServer((req,res)=>{
  const file = safePath(req.url);
  if (!file) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file,(err,st)=>{
    if (err || !st.isFile()) {
      res.writeHead(404, {'content-type':'text/plain; charset=utf-8'});
      res.end('Not Found');
      return;
    }

    if (emulatorMode && file === path.join(root, 'index.html')) {
      try {
        const original = fs.readFileSync(file, 'utf8');
        const transformed = injectFirebaseEmulators(original);
        res.writeHead(200, {
          'content-type':'text/html; charset=utf-8',
          'cache-control':'no-store',
          'x-bxh-e2e-emulator':'1'
        });
        res.end(transformed);
      } catch (error) {
        console.error(error);
        res.writeHead(500, {'content-type':'text/plain; charset=utf-8'});
        res.end('E2E emulator injection failed');
      }
      return;
    }

    res.writeHead(200,{
      'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control':'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port,'127.0.0.1',()=>{
  console.log(`BXH ARENA test server listening on http://127.0.0.1:${port} emulatorMode=${emulatorMode}`);
});

let functionStub = null;
if (emulatorMode) {
  functionStub = http.createServer((req,res)=>{
    res.setHeader('access-control-allow-origin','*');
    res.setHeader('access-control-allow-headers','content-type,authorization,x-firebase-appcheck,x-firebase-gmpid');
    res.setHeader('access-control-allow-methods','POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }
    let body='';
    req.on('data',chunk=>{ body += chunk; });
    req.on('end',()=>{
      const name=String(req.url||'').split('/').filter(Boolean).pop()||'unknown';
      const okNames=new Set(['getEngagementHealth','onlinePresence']);
      const payload=okNames.has(name)
        ? {data:{ok:true,serverTime:Date.now(),messages:[]}}
        : {data:{ok:false,error:'e2e-function-stub',function:name}};
      res.writeHead(200,{'content-type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(payload));
    });
  });
  functionStub.listen(5001,'127.0.0.1',()=>{
    console.log('BXH ARENA E2E callable stub listening on http://127.0.0.1:5001');
  });
}

function shutdown(){
  server.close(()=>{});
  if(functionStub) functionStub.close(()=>{});
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);

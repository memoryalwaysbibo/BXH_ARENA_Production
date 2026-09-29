'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const port = Number(process.env.PORT || 4173);

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
    res.writeHead(200,{
      'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control':'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port,'127.0.0.1',()=>{
  console.log(`BXH ARENA test server listening on http://127.0.0.1:${port}`);
});

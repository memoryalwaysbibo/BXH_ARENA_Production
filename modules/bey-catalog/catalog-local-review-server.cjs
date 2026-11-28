'use strict';
/** Local read-only UI transport. Never an ARENA route or cloud deployment. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {readTw12CatalogQueue, assertDeps} = require('./catalog-tw12-secure-read.cjs');
const {parseRequest} = require('./catalog-tw08-read-gateway.cjs');
const {errorStatus} = require('./catalog-tw13-http-v2.cjs');
const PROJECT = 'demo-bxh-catalog-db01';
const APP_ID = 'local-review-emulator-app';
const APP_TOKEN = 'local-review-emulator-app-check-substitute';
function assertLocal(target, dependencies) {
 if (target?.mode !== 'emulator' || target.projectId !== PROJECT ||
     target.emulatorHost !== '127.0.0.1:8189' ||
     process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8189' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098' ||
     dependencies?.adminFirestore?.projectId !== PROJECT)
  throw Error('LOCAL_REVIEW_EMULATORS_REQUIRED');
}
async function readBody(req) {
 if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
  throw Error('LOCAL_REVIEW_INVALID_REQUEST');
 const chunks = []; let size = 0;
 for await (const chunk of req) {
  size += chunk.length;
  if (size <= 4096) chunks.push(chunk);
 }
 if (size > 4096) throw Error('LOCAL_REVIEW_INVALID_REQUEST');
 try {
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
  return value;
 } catch { throw Error('LOCAL_REVIEW_INVALID_REQUEST'); }
}
async function signInWithLocalAuth({email, password}) {
 if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098')
  throw Error('LOCAL_REVIEW_EMULATORS_REQUIRED');
 const response = await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-only', {
  method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({email, password, returnSecureToken: true}),
  signal: AbortSignal.timeout(10000), redirect: 'error'
 });
 if (!response.ok) {
  if (response.status === 400) throw Object.assign(Error('UNAUTHENTICATED'), {code: 'auth/invalid-id-token'});
  throw Error('LOCAL_REVIEW_AUTH_UNAVAILABLE');
 }
 const result = await response.json();
 if (typeof result.idToken !== 'string' || !result.idToken || result.idToken.length > 8192)
  throw Error('LOCAL_REVIEW_AUTH_UNAVAILABLE');
 // Refresh token, email, uid and Auth diagnostic fields never leave this adapter.
 return {idToken: result.idToken};
}
async function startLocalReviewServer({target, dependencies, signIn = signInWithLocalAuth, port = 0} = {}) {
 assertLocal(target, dependencies);
 if (typeof signIn !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535)
  throw Error('LOCAL_REVIEW_CONFIG_REQUIRED');
 const bound = {...dependencies, allowedAppIds: [APP_ID], adminAppCheck: {
  verifyToken: async token => {
   if (token !== APP_TOKEN) throw Error('INVALID_APP_CHECK');
   return {appId: APP_ID};
  }
 }};
 assertDeps(bound);
 const root = path.resolve(__dirname, '../..');
 const assets = new Map([
  ['/', ['text/html; charset=utf-8', fs.readFileSync(path.join(root, 'bey-catalog-local-review.html'))]],
  ['/modules/bey-catalog/catalog-local-review-ui.js', ['text/javascript; charset=utf-8', fs.readFileSync(path.join(__dirname, 'catalog-local-review-ui.js'))]]
 ]);
 let origin;
 const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const reply = (status, body) => {
   res.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
   res.end(JSON.stringify(body));
  };
  try {
   assertLocal(target, dependencies);
   // Host check also rejects DNS rebinding. API calls require exact same origin.
   if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(origin).host)
    return reply(403, {error: 'ORIGIN_DENIED'});
   const asset = assets.get(req.url);
   if (asset && req.method === 'GET') {
    res.writeHead(200, {'content-type': asset[0]}); res.end(asset[1]); return;
   }
   if (!['/api/session', '/api/review'].includes(req.url)) return reply(404, {error: 'NOT_FOUND'});
   if (req.headers.origin !== origin) return reply(403, {error: 'ORIGIN_DENIED'});
   if (req.method !== 'POST') return reply(405, {error: 'METHOD_NOT_ALLOWED'});
   const body = await readBody(req);
   if (req.url === '/api/session') {
    if (Object.keys(body).some(k => !['email', 'password'].includes(k)) ||
        typeof body.email !== 'string' || body.email.length > 254 || !body.email.includes('@') ||
        typeof body.password !== 'string' || !body.password || body.password.length > 256)
     return reply(400, {error: 'INVALID_REQUEST'});
    const result = await signIn(body);
    if (typeof result?.idToken !== 'string' || !result.idToken || result.idToken.length > 8192)
     throw Error('LOCAL_REVIEW_AUTH_UNAVAILABLE');
    reply(200, {idToken: result.idToken}); return;
   }
   if (Object.keys(body).some(k => !['filter', 'query', 'limit', 'cursor'].includes(k)))
    return reply(400, {error: 'INVALID_REQUEST'});
   const request = parseRequest(body);
   const match = /^Bearer ([A-Za-z0-9._~-]{10,8192})$/.exec(req.headers.authorization || '');
   if (!match) return reply(401, {error: 'UNAUTHENTICATED'});
   const result = await readTw12CatalogQueue({dependencies: bound, appCheckToken: APP_TOKEN, idToken: match[1], request});
   if (result.access === 'denied') return reply(403, {error: 'FORBIDDEN'});
   reply(200, result);
  } catch (error) {
   const [status, code] = error.message === 'LOCAL_REVIEW_INVALID_REQUEST' ? [400, 'INVALID_REQUEST'] : errorStatus(error);
   if (!res.headersSent) reply(status, {error: code}); else res.end();
  }
 });
 server.requestTimeout = 15000;
 server.headersTimeout = 15000;
 await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
 origin = 'http://127.0.0.1:' + server.address().port;
 return {url: origin, close: () => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
 })};
}
module.exports = {startLocalReviewServer, signInWithLocalAuth};

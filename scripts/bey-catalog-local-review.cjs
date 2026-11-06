'use strict';
/** Start against an ALREADY validated private Emulator snapshot. No imports. */
const {startLocalReviewServer} = require('../modules/bey-catalog/catalog-local-review-server.cjs');
async function main() {
 if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8189' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9098')
  throw Error('LOCAL_REVIEW_EMULATORS_REQUIRED');
 const {initializeApp, deleteApp} = require('firebase-admin/app');
 const {getAuth} = require('firebase-admin/auth');
 const {getFirestore, Timestamp, FieldValue} = require('firebase-admin/firestore');
 const {createData01bEmulatorLoader} = require('../modules/bey-catalog/catalog-data01b-private-emulator-loader.cjs');
 const {createTw15AdminEmulatorGuards} = require('../modules/bey-catalog/catalog-tw15-admin-emulator.cjs');
 const target = {mode: 'emulator', projectId: 'demo-bxh-catalog-db01', emulatorHost: '127.0.0.1:8189'};
 const app = initializeApp({projectId: target.projectId}, 'catalog-local-review');
 const db = getFirestore(app);
 try {
  const loader = createData01bEmulatorLoader({db, target, fixtureFile: process.env.BXH_CATALOG_DATA01B_FILE});
  await loader.loadOriginal(); // Read-only check; fail before opening the page if snapshot is absent/invalid.
  const guards = createTw15AdminEmulatorGuards({db, target, Timestamp, FieldValue, secret: process.env.BXH_CATALOG_LOCAL_SECRET});
  const server = await startLocalReviewServer({target, port: 5019, dependencies: {
   adminAuth: getAuth(app), adminFirestore: db, loadResearchBatch: loader.loadResearchBatch, ...guards
  }});
  process.stdout.write('隔離唯讀頁：' + server.url + '\n僅使用 Auth Emulator 測試帳號。App Check 為替身，沒有核准或發布功能。\n');
  let closing = false;
  const close = async () => {if (closing) return; closing = true; await server.close(); await deleteApp(app);};
  process.once('SIGINT', close); process.once('SIGTERM', close);
 } catch (error) {await deleteApp(app); throw error;}
}
main().catch(() => {process.stderr.write('無法啟動：請核對本機 Emulators、既有已驗證資料快照與私有來源檔。未執行匯入。\n'); process.exitCode = 1;});

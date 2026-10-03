'use strict';
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } = require('firebase/firestore');
const { assertIsolated, PROJECT } = require('./preflight.cjs');
assertIsolated(process.env);
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180')
  throw Error('emulator-required');
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8180, rules: fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, role, active] of [['staff1','staff',true], ['staff2','staff',true],
      ['admin1','admin',true], ['disabled','staff',false], ['player1','player',true]])
      await setDoc(doc(db,'hcActors',uid), { role, active });
    await setDoc(doc(db,'hcActors','frozen'), { role:'staff', active:true, accountStatus:'frozen' });
    await setDoc(doc(db,'hcActors','deleted'), { role:'staff', active:true, deleted:true });
    await setDoc(doc(db,'hcChallenges','c1'), { environment:'sandbox', participants:['staff1','staff2','disabled','player1','frozen','deleted'] });
    await setDoc(doc(db,'hcChallenges','production'), { environment:'production', participants:['staff1'] });
    await setDoc(doc(db,'hcResults','r1'), { status:'verified' });
    await setDoc(doc(db,'users','staff1'), { lifetime:123 });
  });
});
after(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });
test('active assigned internal actor can read sandbox challenge', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('staff1').firestore(),'hcChallenges','c1')));
});
test('anonymous and unrelated privileged actors cannot read private challenges', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'hcChallenges','c1')));
  await assertFails(getDoc(doc(env.authenticatedContext('admin1').firestore(),'hcChallenges','c1')));
});
test('disabled actor and forged role claims cannot bypass trusted actor record', async () => {
  for (const uid of ['disabled','player1','unknown','frozen','deleted'])
    await assertFails(getDoc(doc(env.authenticatedContext(uid,{role:'super_admin'}).firestore(),'hcChallenges','c1')));
});
test('cross-environment challenge and broad queries are denied', async () => {
  const db=env.authenticatedContext('staff1').firestore();
  await assertFails(getDoc(doc(db,'hcChallenges','production')));
  await assertFails(getDocs(collection(db,'hcChallenges')));
});
test('clients cannot create, overwrite, or delete server-owned results and ledgers', async () => {
  for (const uid of ['staff1','admin1']) {
    const db=env.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db,'hcChallenges','new'),{environment:'sandbox',participants:[uid]}));
    await assertFails(updateDoc(doc(db,'hcChallenges','c1'),{participants:[uid]}));
    await assertFails(deleteDoc(doc(db,'hcChallenges','c1')));
    for (const name of ['hcResults','hcSettlementLedger','hcAuditEvents','hcActors'])
      await assertFails(setDoc(doc(db,name,'unauthorized'),{status:'settled',role:'super_admin'}));
  }
});
test('demo rules deny legacy lifetime, ladder and mailbox access', async () => {
  const db=env.authenticatedContext('staff1').firestore();
  for (const name of ['users','ladder','mailboxes']) {
    await assertFails(getDoc(doc(db,name,'staff1')));
    await assertFails(setDoc(doc(db,name,'staff1'),{lifetime:0}));
  }
});

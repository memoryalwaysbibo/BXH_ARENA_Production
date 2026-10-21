'use strict';
// Dedicated demo-only Firestore persistence probe. This does NOT execute production pushUpdate.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const PROJECT = 'demo-bxh-arena-e2e';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT, PROJECT, 'demo project required');
assert.match(host || '', /^(127\.0\.0\.1|localhost):8080$/, 'local emulator required');
const url = `http://${host}/v1/projects/${PROJECT}/databases/(default)/documents/roomOwnerLab/${randomUUID()}`;
const creator = 'creator-fixture', editor = 'editor-fixture';
const stringField = s => ({ stringValue:s });
async function send(method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    ...(body ? {body:JSON.stringify(body)} : {})
  });
  const text = await res.text();
  assert.ok(res.ok, `${method} failed (${res.status}): ${text.slice(0,500)}`);
  return text ? JSON.parse(text) : {};
}
(async () => {
  try {
    await send('PATCH', {fields:{createdBy:stringField(creator),createdByName:stringField('翔宇'),hostName:stringField('翔宇'),lastEditor:stringField(creator)}});
    const initial = await send('GET');
    assert.equal(initial.fields.createdBy.stringValue,creator);
    // Editor updates unrelated fields only; original creator should persist in Firestore.
    const changed = await fetch(url+'?updateMask.fieldPaths=lastEditor', {
      method:'PATCH', headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},
      body:JSON.stringify({fields:{lastEditor:stringField(editor)}})
    });
    assert.ok(changed.ok, 'emulator masked update failed: '+(await changed.text()).slice(0,500));
    const after = await send('GET');
    assert.equal(after.fields.createdBy.stringValue,creator);
    assert.equal(after.fields.createdByName.stringValue,'翔宇');
    assert.equal(after.fields.hostName.stringValue,'翔宇');
    assert.equal(after.fields.lastEditor.stringValue,editor);
    console.log('PASS: demo Firestore persisted original owner across isolated editor update');
  } finally {
    await fetch(url,{method:'DELETE',headers:{Authorization:'Bearer owner'}}).catch(()=>{});
  }
})().catch(err=>{console.error(err);process.exitCode=1});

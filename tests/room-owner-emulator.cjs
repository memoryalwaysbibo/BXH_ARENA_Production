'use strict';
// Dedicated demo-only Firestore persistence probe. This does NOT execute production pushUpdate.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const PROJECT = 'demo-bxh-arena-e2e';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT, PROJECT, 'demo project required');
assert.match(host || '', /^(127\.0\.0\.1|localhost):8080$/, 'local emulator required');
const id = randomUUID();
const base = `http://${host}/v1/projects/${PROJECT}/databases/(default)/documents`;
const url = `${base}/roomOwnerLab/${id}`;
const publicUrl = `${base}/roomOwnerLabPublic/${id}`;
const creator = 'creator-fixture', editor = 'editor-fixture';
const stringField = s => ({ stringValue:s });
async function send(method, body, target=url) {
  const res = await fetch(target, {
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
    await send('PATCH', {fields:{createdBy:stringField(creator),createdByName:stringField('翔宇'),hostName:stringField('翔宇')}}, publicUrl);
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
    const mirror = await send('GET', null, publicUrl);
    assert.equal(mirror.fields.createdBy.stringValue,after.fields.createdBy.stringValue,'public owner UID must match private');
    assert.equal(mirror.fields.createdByName.stringValue,after.fields.createdByName.stringValue,'public creator label must match private');
    assert.equal(mirror.fields.hostName.stringValue,after.fields.hostName.stringValue,'public lobby host must match private');
    // Deliberate negative fixture: a stale public host produces a detectable mismatch.
    await send('PATCH', {fields:{hostName:stringField('黑爸')}}, publicUrl+'?updateMask.fieldPaths=hostName');
    const stale = await send('GET',null,publicUrl);
    assert.notEqual(stale.fields.hostName.stringValue,after.fields.createdByName.stringValue,'stale public host mismatch must be detectable');
    console.log('PASS: demo Firestore persistence, private/public identity consistency, and stale-mirror detection');
  } finally {
    await Promise.all([url,publicUrl].map(target=>fetch(target,{method:'DELETE',headers:{Authorization:'Bearer owner'}}).catch(()=>{})));
  }
})().catch(err=>{console.error(err);process.exitCode=1});

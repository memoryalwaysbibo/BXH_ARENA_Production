import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

test("forwards Firebase Auth helper requests to the fixed upstream", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (request, options) => {
    captured = { request, options };
    return new Response("firebase-helper", { status: 200 });
  };

  try {
    const response = await worker.fetch(new Request(
      "https://arena.bxh.com.tw/__/auth/handler?apiKey=test&mode=select",
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "credential=sample" },
    ));

    assert.equal(captured.request.url, "https://bxh-arena.firebaseapp.com/__/auth/handler?apiKey=test&mode=select");
    assert.equal(captured.request.method, "POST");
    assert.equal(await captured.request.text(), "credential=sample");
    assert.deepEqual(captured.options, { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "firebase-helper");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supports the Firebase init endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let target;
  globalThis.fetch = async request => {
    target = request.url;
    return new Response('{"projectId":"bxh-arena"}', { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://arena.bxh.com.tw/__/firebase/init.json"));
    assert.equal(target, "https://bxh-arena.firebaseapp.com/__/firebase/init.json");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /bxh-arena/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unrelated paths and unsupported methods", async () => {
  const unrelated = await worker.fetch(new Request("https://arena.bxh.com.tw/private?x=1"));
  assert.equal(unrelated.status, 404);

  const unsupported = await worker.fetch(new Request("https://arena.bxh.com.tw/__/auth/handler", { method: "PUT" }));
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("allow"), "GET, HEAD, POST, OPTIONS");
});

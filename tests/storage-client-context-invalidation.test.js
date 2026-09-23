"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../core/storage-client.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;

let sendCalls = 0;
let storageGetCalls = 0;
let storageSetCalls = 0;

const invalidated = () => new Error("Extension context invalidated.");

globalThis.chrome = {
  runtime: {
    get lastError() { throw invalidated(); },
    sendMessage() {
      sendCalls += 1;
      throw invalidated();
    }
  },
  storage: {
    local: {
      get() {
        storageGetCalls += 1;
        throw invalidated();
      },
      set() {
        storageSetCalls += 1;
        throw invalidated();
      }
    }
  }
};

require("../jobs/core.js");
require("../core/storage-client.js");
const storage = globalThis.OWEH.core.storage;

(async () => {
  const first = await storage.runtimeRequest({ type: "diagnosticLogAppend" });
  assert.equal(first.ok, false);
  assert.equal(first.contextInvalidated, true);
  assert.equal(first.error, "extension-context-invalidated");
  assert.equal(storage.isExtensionContextInvalidated(), true);

  const second = await storage.runtimeRequest({ type: "getWorkerStatus" });
  assert.equal(second.contextInvalidated, true);
  assert.equal(sendCalls, 1, "once invalidated, old content context must stop calling chrome.runtime.sendMessage");

  assert.equal(await storage.storageGet("normal", "fallback"), "fallback");
  assert.deepEqual(await storage.storageGetMany({ one: 1, two: 2 }), { one: 1, two: 2 });
  assert.deepEqual(await storage.getPetsByIds(["7"]), {});
  assert.equal(await storage.storageSet({ normal: "value" }), false);
  assert.equal(storageGetCalls, 0, "invalidated context must not keep calling chrome.storage.local.get");
  assert.equal(storageSetCalls, 0, "invalidated context must not keep calling chrome.storage.local.set");

  console.log("storage client invalidated-context soft shutdown tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../core/storage-client.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;

const local = { normal: "stored" };
const runtimeMessages = [];
const localWrites = [];
let petDb = { 7: { id: "7", name: "pet" } };

globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      runtimeMessages.push(message);
      if (message.type === "petDbGetAll") return callback({ ok: true, pets: petDb });
      if (message.type === "petDbGetMany") {
        const pets = {};
        for (const id of message.ids || []) {
          if (Object.prototype.hasOwnProperty.call(petDb, String(id))) pets[String(id)] = petDb[String(id)];
        }
        return callback({ ok: true, pets });
      }
      if (message.type === "petDbMerge") {
        petDb = { ...petDb, ...message.pets };
        return callback({ ok: true });
      }
      return callback({ ok: true, echoed: message.type });
    }
  },
  storage: {
    local: {
      get(defaults, callback) {
        const result = {};
        for (const [key, fallback] of Object.entries(defaults || {})) {
          result[key] = Object.prototype.hasOwnProperty.call(local, key) ? local[key] : fallback;
        }
        callback(result);
      },
      set(values, callback) {
        localWrites.push({ ...values });
        Object.assign(local, values);
        callback?.();
      }
    }
  }
};

require("../jobs/core.js");
require("../core/storage-client.js");
const storage = globalThis.OWEH.core.storage;

(async () => {
  assert.equal((await storage.runtimeRequest({ type: "ping" })).echoed, "ping");
  assert.deepEqual(await storage.storageGet("owehPets", {}), petDb, "pet reads must use the IndexedDB background facade");
  assert.equal(await storage.storageGet("normal", "fallback"), "stored");
  assert.equal(await storage.storageGet("missing", "fallback"), "fallback");
  assert.deepEqual(await storage.getPetsByIds(["7", "missing", "7"]), { 7: petDb[7] },
    "targeted pet reads must use the background get-many facade and deduplicate IDs");

  await storage.storageSet({ owehPets: { 8: { id: "8", name: "new" } }, normal: "updated" });
  assert.equal(petDb[8].name, "new", "pet writes must be merged through the background facade");
  assert.equal(local.normal, "updated");
  assert.equal(localWrites.some(write => Object.prototype.hasOwnProperty.call(write, "owehPets")), false,
    "successful pet DB merges must not duplicate the pet object into chrome.storage.local");

  const many = await storage.storageGetMany({ normal: "fallback", another: 3 });
  assert.deepEqual(many, { normal: "updated", another: 3 });
  assert.ok(runtimeMessages.some(message => message.type === "petDbGetAll"));
  assert.ok(runtimeMessages.some(message => message.type === "petDbGetMany"));
  assert.ok(runtimeMessages.some(message => message.type === "petDbMerge"));

  console.log("storage client behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

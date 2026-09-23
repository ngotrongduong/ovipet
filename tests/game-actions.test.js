"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calls = [];
const hatchCalls = [];
let directResult = { ok: true };
let observedEnclosure = null;
const sandbox = vm.createContext({
  console,
  Promise,
  Object,
  String,
  Number,
  RegExp,
  setTimeout: fn => { fn(); return 1; },
  OWEH: {
    core: {
      storage: {
        storageGet: async (key, fallback) => key === "owehEnclosureIds" ? { "FF ** **": "3" } : fallback
      },
      gameBridge: {
        sendGameCommand: async (...args) => { calls.push(args); return directResult; },
        sendOwnHatchCommand: async (...args) => { hatchCalls.push(args); return directResult; }
      }
    },
    dom: {
      overview: { overviewEnclosureForPet: () => observedEnclosure }
    },
    domain: {
      breedingPlan: { normalizeEnclosureLabel: value => String(value || "").replace(/\s+/g, "").toUpperCase() }
    }
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../core/game-actions.js"), "utf8"), sandbox, { filename: "game-actions.js" });
const actions = sandbox.OWEH.core.gameActions;

(async () => {
  assert.equal((await actions.feedPet("nope")).reason, "invalid-pet");
  assert.equal((await actions.hatchOwnEgg("nope")).reason, "invalid-pet");
  assert.equal((await actions.requestFriend("x")).reason, "invalid-user");
  assert.equal((await actions.breedPairDirect("1", "x")).reason, "invalid-breeding-pair");

  calls.length = 0;
  await actions.feedPet("12");
  assert.equal(calls[0][0], "pet_feed");
  assert.equal(calls[0][1], "12");
  assert.equal(calls[0][4], true, "feed remains fire-and-forget");

  hatchCalls.length = 0;
  directResult = { ok: true };
  await actions.hatchOwnEgg("13");
  assert.equal(hatchCalls[0][0], "13");
  assert.equal(hatchCalls[0][1], 3000);

  calls.length = 0;
  await actions.requestFriend("77");
  assert.equal(calls[0][0], "friend_request");
  assert.equal(calls[0][4], true, "friend request remains fire-and-forget");

  calls.length = 0;
  directResult = { ok: true };
  const moved = await actions.fastMovePetToEnclosure("9", "FF ** **");
  assert.equal(moved.moved, true);
  assert.equal(calls[0][0], "pets_enclosure");
  assert.equal(calls[0][2].Enclosure, "3");

  directResult = { ok: false, reason: "bridge-timeout" };
  observedEnclosure = "FF ** **";
  const verified = await actions.fastMovePetToEnclosure("9", "FF ** **");
  assert.equal(verified.moved, true);
  assert.equal(verified.verifiedByOverview, true);

  const missing = await actions.fastMovePetToEnclosure("9", "Missing");
  assert.equal(missing.moved, false);
  assert.match(missing.reason, /missing-enclosure-id/);

  console.log("game action adapter behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../core/storage-client.js", "../core/game-bridge.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;

class FakeCustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}
class FakeDocument {
  constructor() { this.listeners = new Map(); this.respond = true; this.commands = []; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, detail) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn(new FakeCustomEvent(type, { detail }));
  }
  dispatchEvent(event) {
    this.commands.push(event);
    if (!this.respond) return true;
    if (event.type === "oweh:game-command") {
      const request = JSON.parse(event.detail);
      queueMicrotask(() => this.emit("oweh:game-command-result", JSON.stringify({ requestId: request.requestId, ok: true, reason: "ok" })));
    } else if (event.type === "oweh:game-ping") {
      const request = JSON.parse(event.detail);
      queueMicrotask(() => this.emit("oweh:game-command-result", JSON.stringify({ requestId: request.requestId, ok: true, reason: "ready" })));
    }
    return true;
  }
}

const runtimeMessages = [];
globalThis.CustomEvent = FakeCustomEvent;
globalThis.document = new FakeDocument();
globalThis.location = { href: "https://ovipets.com/#!/?pet=7", hash: "#!/?pet=7" };
globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      runtimeMessages.push(message);
      if (message.type === "commandJournalBegin") return callback({ ok: true });
      if (message.type === "commandJournalUpdate") return callback({ ok: true });
      return callback({ ok: true });
    }
  },
  storage: { local: { get(_d, cb) { cb({}); }, set(_v, cb) { cb?.(); } } }
};

require("../jobs/core.js");
require("../core/storage-client.js");
require("../core/game-bridge.js");
const bridge = globalThis.OWEH.core.gameBridge;

(async () => {
  assert.equal((await bridge.pingGameBridge(50)).ok, true, "ping must resolve from the page-side result event");
  const result = await bridge.sendGameCommand("pet_rename", 7, { sample: 1 }, 50, false, "rename:7");
  assert.equal(result.ok, true);
  const dispatched = document.commands.find(event => event.type === "oweh:game-command");
  assert.ok(dispatched, "command event must cross the isolated/page boundary");
  assert.deepEqual(JSON.parse(dispatched.detail).fields, { sample: 1 });

  const journal = runtimeMessages.filter(message => message.type === "commandJournalUpdate");
  assert.equal(journal[0].patch.status, "dispatched", "journal must persist the no-return boundary before dispatch");
  assert.equal(journal.at(-1).patch.status, "callback-confirmed", "successful callback must confirm the journal entry");

  document.respond = false;
  const timeout = await bridge.sendGameCommand("pet_rename", 8, {}, 5);
  assert.deepEqual(timeout, { ok: false, reason: "bridge-timeout" });

  const beforeBlocked = document.commands.length;
  const blockedTurn = await bridge.sendGameCommand("pet_turn_egg", 9, {}, 50);
  assert.deepEqual(blockedTurn, { ok: false, reason: "ui-only-command" });
  assert.equal(document.commands.length, beforeBlocked, "UI-only Turn Egg must not dispatch a page event");

  const wrongRouteHatch = await bridge.sendOwnHatchCommand("9", 50);
  assert.deepEqual(wrongRouteHatch, { ok: false, reason: "own-hatchery-required" });
  document.respond = true;
  location.hash = "#!/?src=pets&sub=hatchery";
  const hatch = await bridge.sendOwnHatchCommand("9", 50);
  assert.equal(hatch.ok, true);
  const hatchEvent = document.commands.at(-1);
  const hatchPayload = JSON.parse(hatchEvent.detail);
  assert.equal(hatchPayload.command, "pet_turn_egg");
  assert.equal(hatchPayload.purpose, "own-hatch");
  assert.equal(hatchPayload.fireAndForget, true);

  console.log("game bridge behavior tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

// Friend Sweep Lite service worker with the shared Name-the-Species modules: Lite 0.1 data is
// kept, the safety pause stops the sweep and blocks Start until Resume, confirmed silhouettes
// are learned.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "friend-sweep-lite");
const clone = value => JSON.parse(JSON.stringify(value));
const local = {
  owehLiteSpeciesStats: { correct: 5, wrong: 2 },
  owehLiteSpeciesWrongCases: [{ id: "old", eggId: "1", wrongSpecies: "Canis", shape: "", options: ["Canis", "Lupus"], correctSpecies: "" }]
};
const session = {};
const tabs = [{ id: 1, windowId: 3, url: "https://ovipets.com/#!/" }];
const sent = [];
let listener = null;
const area = store => ({
  async get(defaults) {
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in store ? clone(store[key]) : fallback]));
  },
  async set(values) { Object.assign(store, clone(values)); },
  async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
});
const chrome = {
  storage: { local: area(local), session: area(session) },
  runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL: file => `chrome-extension://lite/${file}` },
  tabs: {
    async query() { return tabs; },
    async get(id) { const tab = tabs.find(entry => entry.id === id); if (!tab) throw new Error("no tab"); return tab; },
    async create(props) { const tab = { id: tabs.length + 10, windowId: 3, ...props }; tabs.push(tab); return tab; },
    async update(id, props) { const tab = tabs.find(entry => entry.id === id); if (tab) Object.assign(tab, props); return tab; },
    async remove() {},
    async sendMessage(id, message) { sent.push([id, message.type, message.reason || ""]); },
    onRemoved: { addListener() {} }
  },
  windows: { async update() { return {}; } },
  alarms: { async create() {}, async clear() {}, onAlarm: { addListener() {} } },
  declarativeNetRequest: { async updateSessionRules() {} }
};
const sandbox = vm.createContext({
  chrome, console, Promise, Object, Array, Number, String, Boolean, Set, Map, Math, Date, JSON, RegExp, URL, Uint8Array,
  setTimeout, clearTimeout, btoa: value => Buffer.from(value, "binary").toString("base64"), fetch: async () => ({ ok: false, status: 404 }),
  globalThis: null
});
sandbox.globalThis = sandbox;
sandbox.importScripts = (...files) => {
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
};
vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), sandbox, { filename: "background.js" });

function send(message, tabId = 1) {
  return new Promise((resolve, reject) => {
    const kept = listener(message, { tab: { id: tabId, windowId: 3 } }, resolve);
    if (kept !== true) reject(new Error(`no handler kept the channel open for ${message.type}`));
  });
}
const wrong = () => send({ type: "speciesStatsBump", auto: true, patch: { wrong: 1 } }, 21);
const queue = [{ id: "50", name: "Friend", hatchery: "#!/?src=pets&sub=hatchery&usr=50" }];
const shape = "f".repeat(16) + "0".repeat(240);

(async () => {
  // Lite 0.1 totals and wrong cases move to the shared keys.
  const first = await send({ type: "liteGetState" });
  assert.equal(first.ok, true);
  assert.deepEqual(clone(first.stats), { correct: 5, wrong: 2 });
  assert.equal(first.paused, null);
  assert.deepEqual(local.owehSpeciesStats, { correct: 5, wrong: 2 });
  assert.equal(local.owehSpeciesWrongCases.length, 1);
  assert.equal("owehLiteSpeciesStats" in local, false);
  assert.equal("owehLiteSpeciesWrongCases" in local, false);
  assert.equal((await send({ type: "speciesWrongCasesGet" })).count, 1);

  assert.equal((await send({ type: "liteStartSweep", queue })).ok, true);
  assert.equal(local.owehLiteSweep.active, true);

  // A confirmed answer is counted and its silhouette learned.
  assert.equal((await send({ type: "speciesStatsBump", auto: true, patch: { correct: 1 } }, 21)).stats.correct, 6);
  assert.equal((await send({ type: "speciesConfirmedShape", species: "Lepus", shape }, 21)).added, true);
  assert.deepEqual(local.owehSpeciesLearned_Lepus.examples, [shape]);
  assert.deepEqual(clone((await send({ type: "speciesLearnedGet" })).library.Lepus.examples), [shape]);

  // Three wrong answers in a row: the sweep stops, the worker tab is told, the review page opens.
  assert.equal((await wrong()).tripped, false);
  await send({ type: "speciesWrongCaseRecord", case: { eggId: "9", shape, options: ["Lepus", "Lotor"], wrongSpecies: "Lotor", method: "shape-match" } }, 21);
  assert.equal((await wrong()).tripped, false);
  assert.equal(local.owehLiteSweep.active, true);
  const third = await wrong();
  assert.equal(third.tripped, true);
  assert.equal(third.guard.paused.reason, "3 wrong answers in a row");
  assert.equal(local.owehLiteSweep.active, false, "the pause stops the sweep");
  assert.deepEqual(sent.at(-1), [1, "liteSpeciesPaused", "3 wrong answers in a row"]);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(tabs.some(tab => tab.url === "chrome-extension://lite/review/species-review.html"), "the review page opens");
  assert.equal((await send({ type: "liteGetState" })).paused.reason, "3 wrong answers in a row");

  // Start is refused until Resume.
  const refused = await send({ type: "liteStartSweep", queue });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "species-paused");
  assert.equal(local.owehLiteSweep.active, false);
  assert.equal((await send({ type: "speciesGuardResume" })).guard.paused, null);
  assert.equal((await send({ type: "liteStartSweep", queue })).ok, true);

  // An egg tab that reports the pause stops the sweep even without a batch.
  await send({ type: "liteEggResult", eggId: "9", state: "failed", reason: "species-paused" }, 21);
  assert.equal(local.owehLiteSweep.active, false);

  // The owner's label goes through the shared checks: a species the game rejected is refused.
  const saved = local.owehSpeciesWrongCases.find(item => item.eggId === "9");
  assert.equal((await send({ type: "speciesOwnerLabel", id: saved.id, species: "Lotor" })).reason, "rejected-by-game");
  assert.equal((await send({ type: "speciesOwnerLabel", id: saved.id, species: "Lepus" })).ok, true);

  console.log("Friend Sweep Lite species wiring tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

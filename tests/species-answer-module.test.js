"use strict";

// Behavioral test for the always-on Name the Species answerer. The live contract distinguishes
// a retryable incorrect-answer Error from the terminal "egg can no longer be turned" Error.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clickListeners = [];
const messages = [];
const statuses = [];
const store = {};

class FakeElement {
  constructor(text, { tag = "button", onClick = null } = {}) {
    this.text = text; this.tag = tag; this.onClick = onClick; this.visible = true; this.disabled = false; this.clicks = 0;
  }
  get textContent() { return this.text; }
  get offsetParent() { return this.visible ? {} : null; }
  closest(selector) { return selector === "button, label, [role=radio]" ? this : null; }
  click() {
    this.clicks += 1;
    for (const listener of clickListeners) listener({ target: this });
    this.onClick?.(this);
  }
}

const options = ["Ash", "Bay", "Cedar"].map(name => new FakeElement(name));
const ok = new FakeElement("Ok");
const errorOk = new FakeElement("Ok");
const image = {
  currentSrc: "https://ovipets.com/img/verify/a1.png?nonce=1",
  src: "https://ovipets.com/img/verify/a1.png?nonce=1",
  complete: false, naturalWidth: 0,
  getAttribute(name) { return name === "src" ? this.src : null; }
};
const dialog = {
  visible: false, okHides: true,
  get textContent() { return "Name the Species Ash Bay Cedar Ok"; },
  get offsetParent() { return this.visible ? {} : null; },
  closest(selector) { return selector === ".ui-dialog" ? this : null; },
  querySelectorAll() { return [...options, ok]; },
  querySelector(selector) { return selector === 'img[title="Name the Species"]' ? image : null; },
  scrollIntoView() {}
};
ok.onClick = () => { if (dialog.okHides) dialog.visible = false; };
const errorDialog = {
  visible: false,
  get textContent() { return "Error The answer is incorrect, please try again. Ok"; },
  get offsetParent() { return this.visible ? {} : null; },
  closest(selector) { return selector === ".ui-dialog" ? this : null; },
  querySelectorAll() { return [errorOk]; },
  querySelector() { return null; }
};
errorOk.onClick = () => { errorDialog.visible = false; dialog.visible = false; };
const terminalDialog = {
  visible: false,
  get textContent() { return "Error The egg can no longer be turned. Ok"; },
  get offsetParent() { return this.visible ? {} : null; },
  closest(selector) { return selector === ".ui-dialog" ? this : null; },
  querySelectorAll() { return [errorOk]; },
  querySelector() { return null; }
};

const statsLine = { textContent: "" };
const document = {
  querySelectorAll: () => [dialog, errorDialog, terminalDialog],
  querySelector: selector => (selector === "#oweh-species-stats" ? statsLine : null),
  addEventListener(type, listener) { if (type === "click") clickListeners.push(listener); }
};
const chrome = { runtime: { lastError: null, sendMessage(message, callback) { messages.push(message); callback?.(); } } };
const sandbox = vm.createContext({ document, chrome, console, setTimeout, clearTimeout, Math, Date, Object, Array, Set, Promise });
for (const file of ["core.js", "species-answer.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", file), "utf8"), sandbox, { filename: file });
}
const helpers = {
  storageGet: async (key, fallback) => (key in store ? JSON.parse(JSON.stringify(store[key])) : fallback),
  storageSet: async values => { Object.assign(store, JSON.parse(JSON.stringify(values))); },
  sleep: async () => {}, setStatus: text => statuses.push(text), getPageLoadDelayMs: () => 0
};
const api = sandbox.OWEH.boot(helpers)["species-answer"].api;

function chosenOption() { return options.find(option => option.clicks > 0)?.text || null; }
function resetClicks() { for (const element of [...options, ok, errorOk]) element.clicks = 0; }
async function openAndAnswer() { resetClicks(); dialog.visible = true; await api.monitor(); }

(async () => {
  await api.monitor();
  assert.equal(ok.clicks, 0);

  await openAndAnswer();
  assert.equal(options.filter(option => option.clicks).length, 1);
  assert.equal(ok.clicks, 1);

  await api.monitor();
  await openAndAnswer();
  assert.equal(ok.clicks, 1, "same reused dialog node must re-arm after close");

  dialog.okHides = false;
  await api.monitor();
  await openAndAnswer();
  const clicksAfterFirst = ok.clicks;
  await api.monitor();
  assert.equal(ok.clicks, clicksAfterFirst, "still-open dialog must not double answer");
  dialog.visible = false; dialog.okHides = true; await api.monitor();

  // Retryable incorrect answer: remember the wrong species, dismiss Error, then the same egg
  // may ask again. The previous species must not be selected again.
  store.owehSpeciesMemory = {};
  dialog.okHides = false;
  await openAndAnswer();
  const firstWrong = chosenOption();
  errorDialog.visible = true;
  const retryable = await api.checkRejected();
  assert.equal(retryable.terminal, false);
  assert.equal(retryable.reason, "species-incorrect");
  assert.equal(errorOk.clicks, 1, "retryable Error must be dismissed");
  assert.equal(errorDialog.visible, false);
  assert.ok(store.owehSpeciesMemory["https://ovipets.com/img/verify/a1.png"].wrong[firstWrong] >= 1);
  dialog.okHides = true;
  await api.monitor();
  await openAndAnswer();
  assert.notEqual(chosenOption(), firstWrong, "same egg must exclude the previously-wrong species");
  dialog.visible = false; await api.monitor();

  // A still-open reused question without an explicit Error is not enough evidence to call an
  // answer wrong. Never manufacture negative learning from timeout/silence.
  store.owehSpeciesMemory = {};
  dialog.okHides = false;
  await openAndAnswer();
  const silent = await api.checkRejected();
  assert.equal(silent, false);
  assert.deepEqual(store.owehSpeciesMemory, {});
  dialog.visible = false; dialog.okHides = true; await api.monitor();

  // Terminal Error is distinct and closes the egg through the egg-tab runner.
  terminalDialog.visible = true;
  const terminal = await api.checkRejected();
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.reason, "egg-can-no-longer-be-turned");
  terminalDialog.visible = false;

  // Confirmed answer is reused deterministically.
  await openAndAnswer();
  const confirmed = chosenOption();
  await api.settleTurnResult({ ok: true, reason: "ui-confirmed" });
  const key = "https://ovipets.com/img/verify/a1.png";
  assert.equal(store.owehSpeciesMemory[key].species, confirmed);
  await api.monitor();
  for (let round = 0; round < 6; round += 1) {
    await openAndAnswer();
    assert.equal(chosenOption(), confirmed);
    await api.settleTurnResult({ ok: true, reason: "ui-confirmed" });
    await api.monitor();
  }

  // A generic timeout is NOT a wrong-answer signal.
  store.owehSpeciesMemory = {};
  await openAndAnswer();
  const timedChoice = chosenOption();
  await api.settleTurnResult({ ok: false, reason: "ui-turn-timeout" });
  assert.equal(store.owehSpeciesMemory[key]?.wrong?.[timedChoice] || 0, 0);

  assert.ok(store.owehSpeciesStats.detected >= 5);
  console.log("species answer module tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

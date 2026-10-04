"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clickListeners = [];
const statuses = [];
const wrongCases = [];
const resolvedCases = [];
const store = {};

class FakeElement {
  constructor(text, { onClick = null } = {}) {
    this.text = text;
    this.onClick = onClick;
    this.visible = true;
    this.disabled = false;
    this.clicks = 0;
  }
  get textContent() { return this.text; }
  get offsetParent() { return this.visible ? {} : null; }
  closest(selector) { return selector === "button, label, [role=radio]" ? this : null; }
  click() {
    this.clicks += 1;
    for (const listener of clickListeners) listener({ target: this });
    this.onClick?.();
  }
}

const TEST_SHAPE = "f".repeat(16) + "0".repeat(240);
function rgbaFromShape(shape) {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  let pixel = 0;
  for (const nibble of shape) {
    const value = parseInt(nibble, 16);
    for (let bit = 3; bit >= 0; bit -= 1) {
      data[pixel * 4 + 3] = (value & (1 << bit)) ? 255 : 0;
      pixel += 1;
    }
  }
  return data;
}

const options = ["Feline", "Lupus", "Raptor"].map(name => new FakeElement(name));
const ok = new FakeElement("Ok");
const errorOk = new FakeElement("Ok");
const image = {
  currentSrc: "https://app.ovipets.com/img/pet/9001/credit-challenge?size=200",
  src: "https://app.ovipets.com/img/pet/9001/credit-challenge?size=200",
  complete: true,
  naturalWidth: 200,
  getAttribute(name) { return name === "src" ? this.src : null; }
};
const dialog = {
  visible: false,
  okHides: true,
  get textContent() { return "Name the Species Feline Lupus Raptor Ok"; },
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
  querySelector: selector => selector === "#oweh-species-stats" ? statsLine : null,
  addEventListener(type, listener) { if (type === "click") clickListeners.push(listener); },
  createElement(tag) {
    if (tag === "canvas") {
      return {
        width: 0, height: 0,
        getContext() {
          return {
            clearRect() {},
            drawImage() {},
            getImageData() { return { data: rgbaFromShape(TEST_SHAPE) }; }
          };
        }
      };
    }
    if (tag === "img") return { addEventListener() {}, complete: false, naturalWidth: 0 };
    throw new Error(`unexpected tag ${tag}`);
  }
};

const location = {
  href: "https://ovipets.com/#!/?src=pets&sub=profile&usr=44&pet=9001",
  hash: "#!/?src=pets&sub=profile&usr=44&pet=9001"
};
const sandbox = vm.createContext({
  document, location, URL, console, setTimeout, clearTimeout, Math, Date, Object, Array, Set, Promise,
  Uint8ClampedArray, Number, String, Boolean, RegExp, globalThis: null
});
sandbox.globalThis = sandbox;
for (const file of ["jobs/core.js", "domain/species-shape.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
}
sandbox.OWEH_STATIC_SPECIES = {
  meta: { species: 3 },
  library: {
    Feline: { examples: [TEST_SHAPE] },
    Lupus: { examples: ["0".repeat(16) + "f".repeat(16) + "0".repeat(224)] },
    Raptor: { examples: ["0".repeat(32) + "f".repeat(16) + "0".repeat(208)] }
  }
};
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", "species-answer.js"), "utf8"), sandbox, { filename: "species-answer.js" });

const helpers = {
  storageGet: async (key, fallback) => key in store ? JSON.parse(JSON.stringify(store[key])) : fallback,
  storageSet: async values => Object.assign(store, JSON.parse(JSON.stringify(values))),
  sleep: async () => {},
  setStatus: text => statuses.push(text),
  runtimeRequest: async message => {
    if (message.type === "speciesStatsBump") {
      const current = store.owehSpeciesStats || { correct: 0, wrong: 0 };
      store.owehSpeciesStats = {
        correct: Number(current.correct || 0) + Number(message.patch?.correct || 0),
        wrong: Number(current.wrong || 0) + Number(message.patch?.wrong || 0)
      };
      return { ok: true, stats: store.owehSpeciesStats };
    }
    if (message.type === "speciesWrongCaseRecord") {
      wrongCases.push(JSON.parse(JSON.stringify(message.case)));
      return { ok: true, count: wrongCases.length };
    }
    if (message.type === "speciesWrongCaseResolve") {
      resolvedCases.push(JSON.parse(JSON.stringify(message.case)));
      return { ok: true, updated: 1 };
    }
    if (message.type === "speciesImageFetch") return { ok: false };
    if (message.type === "speciesVerificationRequired") return { ok: true };
    return { ok: false };
  }
};
const api = sandbox.OWEH.boot(helpers)["species-answer"].api;

function resetClicks() { for (const element of [...options, ok, errorOk]) element.clicks = 0; }
function chosenOption() { return options.find(option => option.clicks > 0)?.text || null; }
async function openAndAnswer() {
  resetClicks();
  dialog.visible = true;
  await api.monitor();
}

(async () => {
  await api.updateStats({});
  assert.equal(statsLine.textContent, "Name the Species: 0 correct · 0 wrong · static 3 species");

  await openAndAnswer();
  assert.equal(chosenOption(), "Feline", "built-in silhouette must select the matching option");
  assert.equal(ok.clicks, 1);

  // A confirmed answer stores only the aggregate correct count.
  await api.settleTurnResult({ ok: true, reason: "ui-confirmed" });
  assert.deepEqual(store.owehSpeciesStats, { correct: 1, wrong: 0 });
  assert.equal("owehSpeciesMemory" in store, false);
  assert.equal("owehSpeciesShapes" in store, false);

  // New egg: explicit Error increments wrong and excludes that choice only in transient RAM.
  location.hash = "#!/?src=pets&sub=profile&usr=44&pet=9002";
  location.href = "https://ovipets.com/" + location.hash;
  image.currentSrc = "https://app.ovipets.com/img/pet/9002/credit-challenge?size=200";
  image.src = image.currentSrc;
  dialog.okHides = false;
  dialog.visible = false;
  await api.monitor();
  await openAndAnswer();
  const firstWrong = chosenOption();
  assert.equal(firstWrong, "Feline");
  errorDialog.visible = true;
  const retryable = await api.checkRejected();
  assert.equal(retryable.terminal, false);
  assert.equal(retryable.reason, "species-incorrect");
  assert.deepEqual(store.owehSpeciesStats, { correct: 1, wrong: 1 });
  assert.equal("owehSpeciesMemory" in store, false);
  assert.equal(wrongCases.length, 1);
  assert.equal(wrongCases[0].eggId, "9002");
  assert.equal(wrongCases[0].wrongSpecies, "Feline");
  assert.deepEqual(wrongCases[0].options, ["Feline", "Lupus", "Raptor"]);
  assert.equal(wrongCases[0].shape, TEST_SHAPE);
  assert.equal(wrongCases[0].method, "shape-match");

  dialog.okHides = true;
  await api.monitor();
  await openAndAnswer();
  const accepted = chosenOption();
  assert.notEqual(accepted, firstWrong, "same egg must not repeat a rejected answer");
  await api.settleTurnResult({ ok: true, reason: "ui-confirmed" });
  assert.equal(resolvedCases.length, 1);
  assert.equal(resolvedCases[0].eggId, "9002");
  assert.equal(resolvedCases[0].correctSpecies, accepted);

  // Generic timeout is not evidence of a wrong answer.
  const beforeTimeout = { ...store.owehSpeciesStats };
  await api.settleTurnResult({ ok: false, reason: "ui-turn-timeout" });
  assert.deepEqual(store.owehSpeciesStats, beforeTimeout);
  assert.equal(wrongCases.length, 1);

  terminalDialog.visible = true;
  const terminal = await api.checkRejected();
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.reason, "egg-can-no-longer-be-turned");

  console.log("production species answer module tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

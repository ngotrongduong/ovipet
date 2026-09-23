"use strict";

// Species Inspector v2: captures Answer IDs, obtains a cross-origin-safe visual fingerprint
// through the background fetch fallback, and learns success/failed directly from OviPets's
// pet_turn_egg network response.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class TestCustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
}
class FakeInput {
  constructor(id, value) {
    this.id = id; this.value = value; this.tagName = "INPUT";
    this.attributes = [{ name: "id", value: id }, { name: "name", value: "Answer" }, { name: "value", value }];
  }
  getAttribute(name) { return name === "id" ? this.id : name === "value" ? this.value : name === "name" ? "Answer" : null; }
}
class FakeOption {
  constructor(text, input) {
    this.textContent = text; this.tagName = "LABEL"; this.input = input;
    this.attributes = [{ name: "for", value: input.id }];
  }
  get offsetParent() { return {}; }
  closest() { return this; }
  getAttribute(name) { return name === "for" ? this.input.id : null; }
  querySelector(selector) { return selector.includes("input") ? this.input : null; }
}

const inputs = [new FakeInput("a1", "10"), new FakeInput("a2", "15"), new FakeInput("a3", "2")];
const options = [new FakeOption("Canis", inputs[0]), new FakeOption("Raptor", inputs[1]), new FakeOption("Feline", inputs[2])];
const image = {
  tagName: "IMG", attributes: [], complete: false, naturalWidth: 0,
  currentSrc: "https://app.ovipets.com/img/pet/9001/credit-challenge?size=200",
  src: "https://app.ovipets.com/img/pet/9001/credit-challenge?size=200",
  getAttribute(name) { return name === "src" ? this.src : null; }
};
const dialog = {
  tagName: "DIV", attributes: [], outerHTML: '<div class="ui-dialog"><img title="Name the Species"><label>Canis</label></div>',
  textContent: "Name the Species Canis Raptor Feline Ok",
  get offsetParent() { return {}; },
  closest(selector) { return selector === ".ui-dialog" ? this : null; },
  querySelectorAll(selector) { return selector.includes('input[name="Answer"]') ? inputs : options; },
  querySelector(selector) { return selector.includes("img") ? image : null; },
  contains(target) { return options.includes(target); }
};

const doc = new EventTarget();
doc.querySelectorAll = () => [dialog];
doc.body = { appendChild() {} };
doc.createElement = tag => {
  if (tag === "canvas") {
    return {
      width: 0, height: 0,
      getContext() {
        return {
          drawImage() {},
          getImageData() {
            const data = new Uint8ClampedArray(16 * 16 * 4);
            for (let i = 0; i < data.length; i += 4) {
              const px = (i / 4) % 16;
              const py = Math.floor((i / 4) / 16);
              data[i] = px * 16; data[i + 1] = py * 16; data[i + 2] = (px + py) * 8; data[i + 3] = 255;
            }
            return { data };
          }
        };
      },
      toDataURL() { return "data:image/jpeg;base64,thumb"; }
    };
  }
  if (tag === "img") {
    const listeners = {};
    const fake = {
      complete: false, naturalWidth: 0,
      addEventListener(type, cb) { listeners[type] = cb; }
    };
    Object.defineProperty(fake, "src", {
      set() { fake.complete = true; fake.naturalWidth = 200; queueMicrotask(() => listeners.load?.()); }
    });
    return fake;
  }
  if (tag === "a") return { click() {}, remove() {}, set hidden(v) {}, set href(v) {}, set download(v) {} };
  throw new Error(`unexpected element ${tag}`);
};

const store = {};
const statuses = [];
const location = { href: "https://ovipets.com/#!/?src=pets&sub=profile&usr=44&pet=9001", host: "ovipets.com", hash: "#!/?src=pets&sub=profile&usr=44&pet=9001" };
const sandbox = vm.createContext({
  console, document: doc, CustomEvent: TestCustomEvent, location,
  URL, Date, Object, Array, Set, Map, Promise, JSON, Math, Number, String, Boolean, RegExp, Uint8ClampedArray,
  Blob, setTimeout, clearTimeout, queueMicrotask,
  chrome: { runtime: { getManifest: () => ({ version: "5.3.6" }) } }
});
for (const file of ["core.js", "species-inspector.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", file), "utf8"), sandbox, { filename: file });
}
const helpers = {
  storageGet: async (key, fallback) => key in store ? JSON.parse(JSON.stringify(store[key])) : fallback,
  storageSet: async values => Object.assign(store, JSON.parse(JSON.stringify(values))),
  setStatus: value => statuses.push(value),
  runtimeRequest: async message => {
    assert.equal(message.type, "speciesImageFetch");
    return { ok: true, dataUrl: "data:image/png;base64,AA==" };
  }
};
const api = sandbox.OWEH.boot(helpers)["species-inspector"].api;
async function settle() { await new Promise(resolve => setTimeout(resolve, 10)); }

(async () => {
  await api.monitor();
  await settle();
  let trace = store.owehSpeciesInspectorV1;
  assert.equal(trace.sessions.length, 1);
  let session = trace.sessions[0];
  assert.equal(session.eggId, "9001");
  assert.ok(session.question.image.fingerprint?.startsWith("visual:"), "background-fetched image must produce a fingerprint");
  assert.equal(session.question.image.captureMethod, "background-fetch");
  assert.equal(session.question.image.thumbnail, "data:image/jpeg;base64,thumb");
  assert.deepEqual(session.question.options.map(item => [item.text, item.answerId]), [["Canis", "10"], ["Raptor", "15"], ["Feline", "2"]]);
  assert.equal(store.owehSpeciesAnswerIds.Raptor.preferred, "15");

  // Real click capture + authoritative failed network response should resolve the attempt and
  // update both stats and learned memory without waiting for the DOM Error observer.
  const click = new Event("click");
  Object.defineProperty(click, "target", { value: options[1] });
  doc.dispatchEvent(click);
  await settle();
  doc.dispatchEvent(new TestCustomEvent("oweh:species-trace-network", {
    detail: JSON.stringify({
      sessionId: session.id, kind: "xhr", method: "POST", url: "https://ovipets.com/cmd.php",
      request: { cmd: "pet_turn_egg", PetID: "9001", Answer: "15" }, status: 200,
      response: 'cb({"type":"cmd","cmd":"pet_turn_egg","status":"failed","message":"The answer is incorrect, please try again."})'
    })
  }));
  await settle();
  trace = store.owehSpeciesInspectorV1;
  session = trace.sessions[0];
  assert.equal(session.attempts[0].species, "Raptor");
  assert.equal(session.attempts[0].answerId, "15");
  assert.equal(session.attempts[0].result, "wrong");
  assert.equal(store.owehSpeciesStats.wrong, 1);
  const visualKey = session.question.image.fingerprint;
  assert.equal(store.owehSpeciesMemory[visualKey].wrong.Raptor, 1);
  assert.equal(session.terminal, undefined, "ordinary incorrect answer is retryable, not terminal");

  // New egg, same visual challenge, successful Feline response learns a positive mapping.
  location.hash = "#!/?src=pets&sub=profile&usr=44&pet=9002";
  image.currentSrc = "https://app.ovipets.com/img/pet/9002/credit-challenge?size=200";
  image.src = image.currentSrc;
  await api.monitor();
  await settle();
  trace = store.owehSpeciesInspectorV1;
  const second = trace.sessions.at(-1);
  doc.dispatchEvent(new TestCustomEvent("oweh:species-trace-network", {
    detail: JSON.stringify({
      sessionId: second.id, kind: "xhr", method: "POST", url: "https://ovipets.com/cmd.php",
      request: { cmd: "pet_turn_egg", PetID: "9002", Answer: "2" }, status: 200,
      response: 'cb({"type":"cmd","cmd":"pet_turn_egg","status":"success"})'
    })
  }));
  await settle();
  assert.equal(store.owehSpeciesStats.correct, 1);
  assert.equal(store.owehSpeciesMemory[visualKey].species, "Feline");

  // Terminal server response is recorded separately and does not manufacture another wrong answer.
  doc.dispatchEvent(new TestCustomEvent("oweh:species-trace-network", {
    detail: JSON.stringify({
      sessionId: second.id, kind: "xhr", method: "POST", url: "https://ovipets.com/cmd.php",
      request: { cmd: "pet_turn_egg", PetID: "9002" }, status: 200,
      response: 'cb({"type":"cmd","cmd":"pet_turn_egg","status":"failed","message":"The egg can no longer be turned."})'
    })
  }));
  await settle();
  assert.equal(store.owehSpeciesInspectorV1.sessions.at(-1).terminal.reason, "egg-can-no-longer-be-turned");

  const summary = await api.getSummary();
  assert.equal(summary.correct, 1);
  assert.equal(summary.wrong, 1);
  const identity = await api.getActiveQuestionIdentity();
  assert.ok(identity.keys.includes(visualKey));

  // Learning DB import is portable and idempotent. It accepts both the compact backup format
  // and the existing full Inspector export shape so an older dataset can restore a new machine.
  const imported = await api.importDatabase({
    format: "ovipets-species-learning-db",
    formatVersion: 1,
    learnedMemory: {
      [visualKey]: { votes: { Feline: 2 }, wrong: { Raptor: 3 }, species: "Feline", updatedAt: 10 },
      "visual:portable": { votes: { Gekko: 4 }, wrong: { Canis: 1 }, species: "Gekko", updatedAt: 20 }
    },
    answerIds: {
      Gekko: { ids: { "15": 4 }, preferred: "15", updatedAt: 20 }
    },
    stats: { correct: 8, wrong: 6, detected: 12 }
  });
  assert.ok(imported.memoryKeys >= 2);
  assert.equal(store.owehSpeciesMemory[visualKey].votes.Feline, 2);
  assert.equal(store.owehSpeciesMemory[visualKey].wrong.Raptor, 3);
  assert.equal(store.owehSpeciesMemory["visual:portable"].species, "Gekko");
  assert.equal(store.owehSpeciesAnswerIds.Gekko.preferred, "15");
  assert.equal(store.owehSpeciesStats.correct, 8);
  await api.importDatabase({
    format: "ovipets-species-inspector",
    formatVersion: 2,
    learnedMemory: { [visualKey]: { votes: { Feline: 2 }, wrong: { Raptor: 3 } } },
    answerIds: { Gekko: { ids: { "15": 4 }, preferred: "15" } },
    stats: { correct: 8, wrong: 6 }
  });
  assert.equal(store.owehSpeciesMemory[visualKey].votes.Feline, 2, "re-importing the same backup must not inflate votes");
  assert.equal(store.owehSpeciesMemory[visualKey].wrong.Raptor, 3, "re-importing the same backup must not inflate wrong counts");

  // Old Inspector exports (formatVersion 1) may have empty learnedMemory/answerIds even though
  // the trace contains real server outcomes. Import must mine that trace so early datasets are not wasted.
  const legacyKey = "https://app.ovipets.com/img/pet/777/credit-challenge";
  await api.importDatabase({
    format: "ovipets-species-inspector",
    formatVersion: 1,
    trace: {
      sessions: [{
        question: {
          key: legacyKey,
          capturedAt: 123,
          image: { sources: [legacyKey], fingerprint: null, thumbnail: null },
          options: [{ text: "Gekko" }, { text: "Feline" }]
        },
        attempts: [{ index: 1, species: "Gekko", result: null }],
        network: [{
          at: 456,
          request: { cmd: "pet_turn_egg", PetID: "777", Answer: "15" },
          response: 'cb({"type":"cmd","cmd":"pet_turn_egg","status":"success"})'
        }]
      }]
    },
    learnedMemory: {},
    answerIds: {},
    stats: {}
  });
  assert.equal(store.owehSpeciesMemory[legacyKey].species, "Gekko", "legacy trace must recover the successful species mapping");
  assert.equal(store.owehSpeciesAnswerIds.Gekko.preferred, "15", "legacy trace must recover species Answer IDs");

  await api.clearData();
  assert.equal(store.owehSpeciesInspectorV1.sessions.length, 0);
  assert.ok(store.owehSpeciesMemory[visualKey], "clearing traces must keep learned memory");
  assert.match(statuses.at(-1), /trace cleared/i);
  console.log("species inspector behavior tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

"use strict";

// Friend Sweep Lite egg tab, end to end against a fake page: the answerer uses learned
// silhouettes, learns what the game confirms, and obeys the safety pause.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "friend-sweep-lite");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const A = "f".repeat(16) + "0".repeat(240);
const B = "0".repeat(16) + "f".repeat(16) + "0".repeat(224);
const C = "0".repeat(32) + "f".repeat(16) + "0".repeat(208);
// 128 bits from every built-in example: only a learned silhouette can decide it.
const OTHER = "0".repeat(64) + "f".repeat(16) + "0".repeat(176);

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

// Runs one egg tab until it reports its result; returns what it sent and what it clicked.
function eggTab({ canvasShape, correct, learned = {}, paused = null, tripOnWrong = false }) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const clicks = [];
    const page = { turnVisible: true, quizOpen: false, errorOpen: false, chosen: null };
    const control = (text, onClick) => ({ textContent: text, offsetParent: {}, disabled: false, click() { clicks.push(text); onClick?.(); } });
    const options = ["Feline", "Lupus", "Raptor"].map(name => control(name, () => { page.chosen = name; }));
    const ok = control("Ok", () => {
      page.quizOpen = false;
      if (page.chosen === correct) page.turnVisible = false;
      else page.errorOpen = true;
    });
    const errorOk = control("Ok", () => { page.errorOpen = false; });
    const src = "https://app.ovipets.com/img/pet/77/credit-challenge?size=200";
    const image = { complete: true, naturalWidth: 500, currentSrc: src, src, getAttribute: () => src };
    const dialog = (text, isOpen, buttons, all, picture = null) => {
      const node = {
        get textContent() { return text; },
        get offsetParent() { return isOpen() ? {} : null; },
        closest: () => node,
        querySelectorAll: selector => (selector === "button" ? buttons : all),
        querySelector: selector => (selector.includes("Name the Species") ? picture : null)
      };
      return node;
    };
    const quiz = dialog("Name the Species Feline Lupus Raptor Ok", () => page.quizOpen, [ok], [...options, ok], image);
    const error = dialog("Error The answer is incorrect, please try again. Ok", () => page.errorOpen, [errorOk], [errorOk]);
    const turn = control("Turn Egg", () => { page.chosen = null; page.quizOpen = true; });
    const document = {
      hidden: false,
      readyState: "complete",
      body: { appendChild() {} },
      getElementById: () => null,
      querySelector(selector) {
        if (selector.includes("pet_turn_egg")) return page.turnVisible ? turn : null;
        if (selector === "main") return { children: [1] };
        return null;
      },
      querySelectorAll: selector => (selector.includes("dialog") ? [quiz, error] : []),
      createElement(tag) {
        if (tag !== "canvas") throw new Error(`unexpected element ${tag}`);
        return { width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: rgbaFromShape(canvasShape) }) }) };
      }
    };
    const store = { owehSpeciesGuard: paused ? { paused } : null };
    for (const [species, examples] of Object.entries(learned)) store[`owehSpeciesLearned_${species}`] = { examples };
    const chrome = {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(message, respond) {
          messages.push(JSON.parse(JSON.stringify(message)));
          if (message.type === "liteAssignment") return respond({ ok: true, assignment: { eggId: "77" } });
          if (message.type === "liteSpeciesImage") return respond({ ok: false });
          if (message.type === "speciesStatsBump") return respond({ ok: true, stats: {}, tripped: Boolean(tripOnWrong && message.patch.wrong) });
          if (message.type === "liteEggResult") {
            respond({ ok: true });
            return resolve({ messages, clicks, result: message });
          }
          return respond({ ok: true });
        }
      },
      storage: { local: { get: async defaults => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, store[key] ?? fallback])) } }
    };
    const sandbox = vm.createContext({
      chrome, document, console, Promise, Object, Array, Set, Map, Math, Date, JSON, Number, String, Boolean, RegExp, URL, Uint8Array,
      location: { hash: "#!/?src=pets&sub=profile&usr=5&pet=77", href: "https://ovipets.com/#!/?src=pets&sub=profile&usr=5&pet=77" },
      window: { addEventListener() {} },
      // The page's waits are irrelevant here: run every timer at once.
      setTimeout: fn => setTimeout(fn, 0), clearTimeout,
      globalThis: null
    });
    sandbox.globalThis = sandbox;
    sandbox.OWEH_STATIC_SPECIES = { library: { Feline: { examples: [A] }, Lupus: { examples: [B] }, Raptor: { examples: [C] } } };
    try {
      vm.runInContext(source("domain/species-shape.js"), sandbox, { filename: "species-shape.js" });
      vm.runInContext(source("content.js"), sandbox, { filename: "content.js" });
    } catch (failure) {
      reject(failure);
    }
    setTimeout(() => reject(new Error("the egg tab never reported a result")), 10000).unref();
  });
}

const ofType = (run, type) => run.messages.filter(message => message.type === type);

(async () => {
  // A learned silhouette decides a picture the built-in library can not, and the accepted
  // answer is learned in turn.
  {
    const run = await eggTab({ canvasShape: OTHER, correct: "Raptor", learned: { Raptor: [OTHER] } });
    assert.deepEqual(run.clicks, ["Turn Egg", "Raptor", "Ok"]);
    assert.equal(run.result.state, "turned");
    assert.deepEqual(ofType(run, "speciesStatsBump").map(message => message.patch), [{ correct: 1 }]);
    assert.deepEqual(ofType(run, "speciesConfirmedShape").map(message => [message.species, message.shape]), [["Raptor", OTHER]]);
    assert.equal(ofType(run, "speciesWrongCaseRecord").length, 0);
  }

  // An outline the built-in library already has is answered and not learned again.
  {
    const run = await eggTab({ canvasShape: A, correct: "Feline" });
    assert.deepEqual(run.clicks, ["Turn Egg", "Feline", "Ok"]);
    assert.equal(ofType(run, "speciesConfirmedShape").length, 0);
  }

  // Wrong first: the case is saved with its silhouette, the retry skips that answer, and the
  // species the game then accepts is learned and resolves the case for that same picture.
  {
    const run = await eggTab({ canvasShape: A, correct: "Lupus" });
    assert.deepEqual(run.clicks, ["Turn Egg", "Feline", "Ok", "Ok", "Turn Egg", "Lupus", "Ok"]);
    assert.equal(run.result.state, "turned");
    assert.deepEqual(ofType(run, "speciesStatsBump").map(message => message.patch), [{ wrong: 1 }, { correct: 1 }]);
    const [saved] = ofType(run, "speciesWrongCaseRecord");
    assert.equal(saved.case.wrongSpecies, "Feline");
    assert.equal(saved.case.shape, A);
    assert.equal(saved.case.eggId, "77");
    assert.deepEqual(saved.case.options, ["Feline", "Lupus", "Raptor"]);
    const [resolved] = ofType(run, "speciesWrongCaseResolve");
    assert.deepEqual([resolved.case.correctSpecies, resolved.case.shape, resolved.case.eggId], ["Lupus", A, "77"]);
    assert.deepEqual(ofType(run, "speciesConfirmedShape").map(message => [message.species, message.shape]), [["Lupus", A]]);
  }

  // The wrong answer that trips the safety pause ends the egg at once: no second try.
  {
    const run = await eggTab({ canvasShape: A, correct: "Lupus", tripOnWrong: true });
    assert.deepEqual(run.clicks, ["Turn Egg", "Feline", "Ok"]);
    assert.deepEqual([run.result.state, run.result.reason], ["failed", "species-paused"]);
  }

  // While paused nothing is answered at all.
  {
    const run = await eggTab({ canvasShape: A, correct: "Feline", paused: { at: 1, reason: "3 wrong answers in a row" } });
    assert.deepEqual(run.clicks, ["Turn Egg"]);
    assert.deepEqual([run.result.state, run.result.reason], ["failed", "species-paused"]);
    assert.equal(ofType(run, "speciesStatsBump").length, 0);
  }

  console.log("Friend Sweep Lite egg-tab answer tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

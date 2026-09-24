"use strict";

// Runtime wiring check: loads every isolated-world content script in manifest order inside a vm
// context with inert browser fakes, then lets content.js run OWEH.boot(). Source-text tests cannot
// see a service factory that returns `undefined` for a helper (destructuring a missing key is not a
// ReferenceError), so this asserts the actual helper bag handed to the modules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const scripts = manifest.content_scripts.filter(entry => entry.world !== "MAIN").flatMap(entry => entry.js);
assert.equal(scripts.at(-1), "content.js", "content.js must be the last isolated content script");

// A DOM node that tolerates any property read/call. Page queries find nothing; nodes the
// extension builds itself (the panel) find inert child nodes so their controls can be wired.
function fakeNode(owned = false) {
  const target = function () {};
  const store = { dataset: {}, style: {}, children: [], childNodes: [], textContent: "", innerHTML: "", value: "" };
  return new Proxy(target, {
    get(_t, key) {
      if (key in store) return store[key];
      if (key === Symbol.iterator) return undefined;
      if (key === "then") return undefined;
      if (key === "querySelector") return () => (owned ? fakeNode(true) : null);
      if (key === "closest" || key === "getElementById") return () => null;
      if (key === "querySelectorAll" || key === "getElementsByTagName") return () => [];
      if (key === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (key === "getBoundingClientRect") return () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 });
      if (key === "offsetParent") return null;
      return (..._args) => fakeNode(owned);
    },
    set(_t, key, value) { store[key] = value; return true; },
    apply() { return fakeNode(owned); }
  });
}

const errors = [];
const storage = {};
const bootCalls = [];
const noop = () => {};
const document = {
  documentElement: fakeNode(),
  body: fakeNode(),
  head: fakeNode(),
  readyState: "complete",
  title: "",
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => fakeNode(true),
  createTextNode: () => fakeNode(),
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => true
};
const chrome = {
  runtime: {
    id: "test",
    lastError: undefined,
    sendMessage(_message, callback) { if (callback) setImmediate(() => callback({ ok: false, error: "test" })); },
    onMessage: { addListener: noop },
    getURL: file => file,
    getManifest: () => manifest
  },
  storage: {
    local: {
      get(defaults, callback) {
        const out = typeof defaults === "string" ? { [defaults]: storage[defaults] } : { ...(defaults || {}) };
        setImmediate(() => callback(out));
      },
      set(values, callback) { Object.assign(storage, values); if (callback) setImmediate(callback); },
      remove(_keys, callback) { if (callback) setImmediate(callback); }
    },
    onChanged: { addListener: noop }
  }
};
const timers = [];
const context = {
  chrome,
  document,
  location: { href: "https://ovipets.com/#!/?src=pets&sub=hatchery&usr=1", hash: "#!/?src=pets&sub=hatchery&usr=1", pathname: "/", search: "", host: "ovipets.com", hostname: "ovipets.com", origin: "https://ovipets.com", reload: noop },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  console: { ...console, log: noop, info: noop, warn: noop, debug: noop, error: (...args) => errors.push(args.map(String).join(" ")) },
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  Event: class { constructor(type) { this.type = type; } },
  Blob: class {},
  URL: { createObjectURL: () => "blob:", revokeObjectURL: noop },
  setTimeout: (fn, ms, ...args) => { const id = setTimeout(fn, Math.min(ms || 0, 5), ...args); timers.push(id); return id; },
  clearTimeout,
  setInterval: (fn, ms) => { const id = setInterval(fn, 3600000); timers.push(id); return id; },
  clearInterval,
  requestAnimationFrame: fn => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => true,
  postMessage: noop,
  innerWidth: 1280,
  innerHeight: 800
};
context.window = context;
context.globalThis = context;
context.self = context;
vm.createContext(context);

for (const file of scripts) {
  if (file === "content.js") {
    // Record the helper bag content.js hands to every module.
    const originalBoot = context.OWEH.boot;
    context.OWEH.boot = helpers => { bootCalls.push(helpers); return originalBoot(helpers); };
  }
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

// Walks the helper bag and returns every path whose value is undefined (a missing binding).
function undefinedPaths(value, prefix, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    const where = prefix ? `${prefix}.${key}` : key;
    if (child === undefined) out.push(where);
    else if (child && typeof child === "object" && !Array.isArray(child) && Object.getPrototypeOf(child)?.constructor?.name === "Object") {
      out.push(...undefinedPaths(child, where, seen));
    }
  }
  return out;
}

setTimeout(() => {
  for (const id of timers) { clearTimeout(id); clearInterval(id); }
  try {
    assert.equal(bootCalls.length, 1, `content.js must call OWEH.boot exactly once; errors: ${errors.join(" | ")}`);
    const helpers = bootCalls[0];
    assert.deepEqual(undefinedPaths(helpers, ""), [], "every helper handed to OWEH.boot must be defined");

    // Callable members of the service groups the modules actually invoke.
    const callable = {
      "": ["storageGet", "storageSet", "sleep", "setStatus", "runtimeRequest", "sendGameCommand", "diagnosticLog", "waitForGameReady", "waitForStableValue"],
      catalogService: ["waitForOverviewShell", "collectAllOverviewPets", "updateRetentionRanking"],
      petIndexActions: ["openTab", "renamePet", "updateRetentionRanking"],
      ninjaService: ["performNinjaChatScan"],
      friendDirectory: ["scanFriends", "hasVisibleFriends"],
      hatchlingActions: ["getOwnUserId", "updateRetentionRanking"],
      petFetch: ["readHatchery", "readPet", "collectCatalog", "mergePetRecord"],
      ownEggsService: ["onRunFinished", "ownedByThisTab"],
      breedingActions: ["collectAllOverviewPets"],
      uiPanelActions: ["saveCurrentPet", "scanFriends", "copyBlacklistCsv", "applySuggestedName", "copyRetentionReviewCsv",
        "exportDiagnosticLog", "clearDiagnosticLog", "getDiagnosticSummary", "friendBlacklist", "rankPartners"]
    };
    for (const [group, names] of Object.entries(callable)) {
      const bag = group ? helpers[group] : helpers;
      assert.ok(bag, `helper group ${group} is missing`);
      for (const name of names) assert.equal(typeof bag[name], "function", `${group || "helpers"}.${name} must be a function`);
    }

    const bootErrors = errors.filter(text => /did not load|must load|module ".*" (start|onRefresh) failed/.test(text));
    assert.deepEqual(bootErrors, [], "no content script or module may fail while booting");
    console.log(`content boot wiring test passed (${scripts.length} scripts, ${Object.keys(helpers).length} helpers)`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 50);

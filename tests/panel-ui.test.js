"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class FakeElement {
  constructor() {
    this.textContent = "";
    this.dataset = {};
    this.disabled = false;
    this.classList = new FakeClassList();
  }
}

function setup() {
  const label = new FakeElement();
  const copy = new FakeElement();
  const apply = new FakeElement();
  const blacklist = new FakeElement();
  const start = new FakeElement();
  const stop = new FakeElement();
  const panel = new FakeElement();
  panel.querySelector = selector => ({ "#oweh-start": start, "#oweh-stop": stop }[selector] || null);
  let suggestion = "FFFFFF-FF0000-000000";
  let blacklistValue = { 1: {}, 2: {} };
  const document = {
    querySelector(selector) {
      return {
        "#oweh-pet-name": label,
        "#oweh-copy-name": copy,
        "#oweh-apply-name": apply,
        "#oweh-blacklist-count": blacklist
      }[selector] || null;
    },
    getElementById(id) { return id === "panel" ? panel : null; }
  };
  const helpers = {
    storageGet: async (_key, fallback) => fallback,
    storageGetMany: async defaults => ({ ...defaults }),
    storageSet: async () => {},
    setStatus: () => {},
    uiPanelActions: {
      panelId: "panel", tooltipId: "tooltip", instanceId: "instance",
      stopAllAutomation() {}, saveCurrentPet() {}, refreshDatabaseHealth: async () => null, rankPartners() {},
      startOwnEggs() {}, stopOwnEggs() {}, scanFriends() {}, requestFriendSweepWorker() {}, requestGoToNextFriend() {},
      stopFriendSweep() {}, copyBlacklistCsv() {}, applySuggestedName() {}, requestStartBreedCampaign() {}, requestStartBreedTargetCampaign() {}, stopBreedCampaign() {},
      copyRetentionReviewCsv() {}, requestStartHatchlingProcessing() {}, stopHatchlingProcessing() {},
      confirmBreedPreview() {}, discardBreedPreview() {}, setBreedPairLimit: async value => Number(value) || 0,
      getPetNameSuggestion: () => suggestion,
      friendBlacklist: async () => blacklistValue,
      isContextVisible: count => count > 0,
      targetColors: { body1: "#FFFFFF" },
      defaultDelayMs: 0,
      defaultPageLoadDelayMs: 1500,
      defaultBreedingStockMaxDistance: 96,
      setDelayMs() {}, setPageLoadDelayMs() {}
    }
  };
  const sandbox = vm.createContext({
    console: { error() {} }, document, Promise, Object, Array, Set, Map, JSON, Math, Number, String, Boolean, RegExp,
    window: { innerWidth: 1000, innerHeight: 800 }, navigator: { clipboard: { writeText: async () => {} } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../jobs/core.js"), "utf8"), sandbox, { filename: "core.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../ui/panel.js"), "utf8"), sandbox, { filename: "panel.js" });
  const api = sandbox.OWEH.boot(helpers)["ui-panel"].api;
  return {
    api, label, copy, apply, blacklist, start, stop,
    setSuggestion(value) { suggestion = value; },
    setBlacklist(value) { blacklistValue = value; }
  };
}

(async () => {
  const env = setup();
  env.api.updatePetNameSuggestion();
  assert.equal(env.label.textContent, "Suggested name: FFFFFF-FF0000-000000");
  assert.equal(env.copy.disabled, false);
  assert.equal(env.copy.dataset.name, "FFFFFF-FF0000-000000");
  assert.equal(env.apply.disabled, false);

  env.setSuggestion(null);
  env.api.updatePetNameSuggestion();
  assert.equal(env.label.textContent, "Open a pet profile to see a naming suggestion");
  assert.equal(env.copy.disabled, true);
  assert.equal(env.copy.dataset.name, "");
  assert.equal(env.apply.disabled, true);

  env.api.setEggRunning(true);
  assert.equal(env.start.disabled, true);
  assert.equal(env.stop.disabled, false);
  env.api.setEggRunning(false);
  assert.equal(env.start.disabled, false);
  assert.equal(env.stop.disabled, true);

  env.api.updateBlacklistCount();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(env.blacklist.textContent, "Blacklist: 2 friend(s)");
  env.setBlacklist({});
  env.api.updateBlacklistCount();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(env.blacklist.textContent, "Blacklist: 0 friend(s)");

  assert.equal(env.api.isVisible(0), false);
  assert.equal(env.api.isVisible(1), true);

  // Regression guard: refresh must call the extracted panel API, not a deleted bare helper.
  const content = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  assert.ok(content.includes("panelModule?.updateBlacklistCount()"));
  assert.ok(!/(^|\n)\s*updateBlacklistCount\(\);/.test(content));
  assert.ok(!content.includes("function ensurePanel()"));

  console.log("panel UI behavior and refresh-composition tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

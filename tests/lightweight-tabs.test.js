"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let sessionRules = [];
const removedListeners = [];
const chrome = {
  runtime: { lastError: null },
  tabs: { onRemoved: { addListener(fn) { removedListeners.push(fn); } } },
  declarativeNetRequest: {
    getSessionRules(callback) { callback(JSON.parse(JSON.stringify(sessionRules))); },
    updateSessionRules({ removeRuleIds = [], addRules = [] }, callback) {
      sessionRules = sessionRules.filter(rule => !removeRuleIds.includes(rule.id));
      sessionRules.push(...JSON.parse(JSON.stringify(addRules)));
      callback?.();
    }
  }
};
const diagnosticEvents = [];
const context = vm.createContext({ chrome, console, Promise, Object, Array, Set, Number, String, Boolean, globalThis: null });
context.globalThis = context;
context.OWEH_BG = { diagnosticLog: { append(level, source, event, data) { diagnosticEvents.push({ level, source, event, data }); return Promise.resolve(); } } };
const source = fs.readFileSync(path.join(__dirname, "..", "bg", "lightweight-tabs.js"), "utf8");
vm.runInContext(source, context, { filename: "lightweight-tabs.js" });
const api = context.OWEH_BG.lightweightTabs;

(async () => {
  assert.equal(api.dnrAvailable(), true);
  await api.enable(101, "sweep-coordinator");
  await api.enable(102, "sweep-egg");
  assert.equal(sessionRules.length, 2, "lightweight tabs should share block + challenge-image allow rules");
  const blockRule = () => sessionRules.find(rule => rule.id === api.RULE_ID);
  const allowRule = () => sessionRules.find(rule => rule.id === api.CHALLENGE_ALLOW_RULE_ID);
  assert.deepEqual(Array.from(blockRule().condition.tabIds), [101, 102]);
  assert.deepEqual(Array.from(blockRule().condition.resourceTypes), ["image", "media", "font"]);
  assert.equal(blockRule().action.type, "block");
  assert.equal(allowRule().action.type, "allow");
  assert.equal(allowRule().priority, 2);
  assert.deepEqual(Array.from(allowRule().condition.tabIds), [101, 102]);
  assert.deepEqual(Array.from(allowRule().condition.resourceTypes), ["image"]);
  assert.match(allowRule().condition.regexFilter, /credit-challenge/);

  await api.disable(101);
  assert.deepEqual(Array.from(blockRule().condition.tabIds), [102]);
  assert.deepEqual(Array.from(allowRule().condition.tabIds), [102]);

  await api.disable(102, "test-close");
  assert.equal(sessionRules.length, 0, "disabling the final owned tab should remove both rules");

  assert.ok(diagnosticEvents.some(entry => entry.event === "tab.lightweight-enabled"));
  console.log("lightweight tab resource-rule tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const store = {
  owehWorker: { owner: "sweep", generation: 4, phase: "eggs 3/10" },
  owehSweep: { active: true, cycle: 2, index: 7, maxFriends: 90 },
  owehEggTabs: { batchId: "b1", expected: 10, tabs: { 100: { eggId: "9001" } } }
};
const clone = value => JSON.parse(JSON.stringify(value));
const chrome = {
  runtime: { getManifest: () => ({ version: "5.3.7" }) },
  storage: { local: {
    async get(defaults) {
      if (Array.isArray(defaults)) {
        const out = {};
        for (const key of defaults) if (key in store) out[key] = clone(store[key]);
        return out;
      }
      if (typeof defaults === "string") return defaults in store ? { [defaults]: clone(store[defaults]) } : {};
      const out = { ...clone(defaults || {}) };
      for (const key of Object.keys(defaults || {})) if (key in store) out[key] = clone(store[key]);
      return out;
    },
    async set(values) { Object.assign(store, clone(values)); }
  } }
};
const context = vm.createContext({ chrome, console, Date, Math, Promise, Object, Array, JSON, String, Number, Boolean, RegExp, globalThis: null });
context.globalThis = context;
const source = fs.readFileSync(path.join(__dirname, "..", "bg", "diagnostic-log.js"), "utf8");
vm.runInContext(source, context, { filename: "diagnostic-log.js" });
const log = context.OWEH_BG.diagnosticLog;

(async () => {
  await log.append("info", "worker", "worker.started", { generation: 4, token: "secret-value" });
  await log.append("warning", "egg-tabs", "tab.timeout", { tabId: 100, eggId: "9001", reason: "60s watchdog" });
  await log.append("error", "runtime", "runtime.unhandled-rejection", { message: "network exploded", password: "nope" });

  const summary = await log.getSummary();
  assert.equal(summary.total, 3);
  assert.equal(summary.counts.info, 1);
  assert.equal(summary.counts.warning, 1);
  assert.equal(summary.counts.error, 1);
  assert.equal(summary.last.event, "runtime.unhandled-rejection");

  const exported = await log.exportData();
  assert.equal(exported.format, "ovipets-diagnostic-log");
  assert.equal(exported.extensionVersion, "5.3.7");
  assert.equal(exported.entries.length, 3);
  assert.equal(exported.entries[0].data.token, "[redacted]");
  assert.equal(exported.entries[2].data.password, "[redacted]");
  assert.equal(exported.stateSnapshot.owehSweep.active, true);
  assert.equal(exported.stateSnapshot.owehEggTabs.batchId, "b1");

  await log.clear();
  const cleared = await log.getSummary();
  assert.equal(cleared.total, 0);
  assert.equal(store.owehSweep.active, true, "clearing diagnostics must not alter automation state");

  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.ok(background.includes('"bg/diagnostic-log.js"'), "background must import diagnostic log service");
  assert.ok(background.includes('message?.type === "diagnosticLogExport"'), "background must expose diagnostic export");
  const panel = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
  assert.ok(panel.includes("oweh-export-diagnostics"));
  assert.ok(panel.includes("oweh-clear-diagnostics"));

  console.log("diagnostic logbook persistence, redaction, export and clear tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

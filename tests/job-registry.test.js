"use strict";

// jobs/core.js: one broken module must never take the others (or content.js) down.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const errors = [];
const sandbox = vm.createContext({ console: { error: (...args) => errors.push(args.join(" ")) } });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "jobs", "core.js"), "utf8"), sandbox);
const { OWEH } = sandbox;

const seen = [];
OWEH.register("broken", () => { throw new Error("boom"); });
OWEH.register("good", helpers => ({ api: { value: helpers.value }, onRefresh: () => seen.push("good") }));
OWEH.register("bad-hook", () => ({ onRefresh: () => { throw new Error("hook boom"); } }));
OWEH.register("async-bad-hook", () => ({ onRefresh: async () => { throw new Error("async boom"); } }));

const instances = OWEH.boot({ value: 42 });
assert.equal(instances.good.api.value, 42);
assert.equal(Object.keys(instances.broken).length, 0, "a module that throws while starting is replaced by an empty instance");
assert.ok(errors.some(line => line.includes('module "broken" start failed')));

OWEH.runHook("onRefresh");
await_tick().then(() => {
  assert.equal(seen.join(","), "good", "healthy hooks still run when a sibling hook throws");
  assert.ok(errors.some(line => line.includes('module "bad-hook" onRefresh failed')));
  assert.ok(errors.some(line => line.includes('module "async-bad-hook" onRefresh failed')));
  assert.equal(OWEH.boot({ value: 1 }).good.api.value, 42, "boot must not re-create an existing module");
  console.log("job registry tests passed");
}).catch(error => { console.error(error); process.exitCode = 1; });

function await_tick() { return new Promise(resolve => setTimeout(resolve, 5)); }

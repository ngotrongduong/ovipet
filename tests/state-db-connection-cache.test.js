"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeIndexedDB } = require("./helpers/fake-indexeddb");

const ROOT = path.join(__dirname, "..");

function loadStateDb() {
  const fake = createFakeIndexedDB();
  const opened = [];
  const indexedDB = {
    open(...args) {
      const request = fake.open(...args);
      const onsuccess = () => opened.push(request.result);
      const wrapped = new Proxy(request, {
        set(target, key, value) {
          if (key === "onsuccess") target.onsuccess = () => { onsuccess(); value(); };
          else target[key] = value;
          return true;
        }
      });
      return wrapped;
    }
  };
  const chrome = { storage: { local: { get: defaults => Promise.resolve({ ...defaults }) } } };
  const context = vm.createContext({ indexedDB, chrome, console, setTimeout, clearTimeout, Date });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "bg/state-db.js"), "utf8"), context, { filename: "bg/state-db.js" });
  return { api: context.OWEH_BG.stateDb, opened };
}

test("state DB reuses one cached connection across operations", async () => {
  const { api, opened } = loadStateDb();
  await api.mergePets({ "1": { id: "1", name: "one" }, "2": { id: "2", name: "two" } });
  const pets = await api.getPetsByIds(["1", "2"]);
  assert.equal(pets["1"].name, "one");
  await api.getAllPets();
  await api.dbTransaction("meta", "readwrite", store => store.put({ key: "x", value: 1 }));
  await Promise.all([api.getAllPets(), api.getAllPets(), api.getTask("missing")]);
  assert.equal(opened.length, 1);
});

test("state DB reopens after the browser closes the connection", async () => {
  const { api, opened } = loadStateDb();
  await api.getAllPets();
  assert.equal(opened.length, 1);
  opened[0].onclose?.();
  await api.getAllPets();
  assert.equal(opened.length, 2);
});

test("state DB closes and drops the connection on versionchange", async () => {
  const { api, opened } = loadStateDb();
  await api.getAllPets();
  let closed = 0;
  opened[0].close = () => { closed += 1; };
  opened[0].onversionchange?.();
  assert.equal(closed, 1);
  await api.getAllPets();
  assert.equal(opened.length, 2);
});

test("closeStateDb closes the cached connection and the next call reopens", async () => {
  const { api, opened } = loadStateDb();
  await api.getAllPets();
  let closed = 0;
  opened[0].close = () => { closed += 1; };
  await api.closeStateDb();
  assert.equal(closed, 1);
  await api.getAllPets();
  assert.equal(opened.length, 2);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calls = [];
const sandbox = vm.createContext({
  console, URL, Uint8Array,
  btoa: value => Buffer.from(value, "binary").toString("base64"),
  fetch: async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true, status: 200,
      headers: { get: name => name === "content-type" ? "image/png" : null },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer
    };
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg", "species-image.js"), "utf8"), sandbox);
const api = sandbox.OWEH_BG.speciesImage;
assert.ok(api);
assert.equal(api.allowedSpeciesImageUrl("https://evil.example/img/pet/1/credit-challenge"), null);
assert.equal(api.allowedSpeciesImageUrl("https://app.ovipets.com/img/pet/123/credit-challenge?size=200").pathname, "/img/pet/123/credit-challenge");

(async () => {
  const invalid = await api.fetchSpeciesImage("https://ovipets.com/user/profile");
  assert.equal(invalid.ok, false);
  const result = await api.fetchSpeciesImage("https://app.ovipets.com/img/pet/123/credit-challenge?size=200");
  assert.equal(result.ok, true);
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
  assert.equal(result.bytes, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "include");
  console.log("species image fetch guard tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

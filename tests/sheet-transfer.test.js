"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("inventory CSV includes five complete color slots and safe spreadsheet text", () => {
  globalThis.OWEH = { domain: {} };
  delete require.cache[require.resolve("../domain/sheet-transfer.js")];
  require("../domain/sheet-transfer.js");
  const csv = OWEH.domain.sheetTransfer;
  const row = csv.inventoryRow({
    species: "Draconis", name: "=IMPORTXML(\"secret\")", gender: "Female", enclosure: "Newborn",
    colors: { body1: "#FFFFFF", body2: "#FF0000", scales: "#000000",
      extra1: "#AA0011", extra2: "#00FF00" }, parentIds: ["10", "20"]
  }, "pet", "12345678");
  assert.equal(row.DataStatus, "complete");
  assert.equal(row.Extra2, "#00FF00");
  assert.equal(row.ParentIDs, "10|20");
  const serialized = csv.serialize([row]);
  assert.ok(serialized.startsWith("\uFEFF"));
  assert.ok(serialized.includes('"\u0027=IMPORTXML(""secret"")"'), "spreadsheet formula text is escaped");
  const rows = csv.parseCsv(serialized);
  assert.equal(rows[1][0], "12345678");
  assert.equal(rows[1][3], "'=IMPORTXML(\"secret\")");
  assert.equal(rows[1].length, csv.HEADERS.length);
  delete globalThis.OWEH;
});

test("CSV ID parser accepts explicit YES only and rejects ambiguous imports", () => {
  globalThis.OWEH = { domain: {} };
  delete require.cache[require.resolve("../domain/sheet-transfer.js")];
  require("../domain/sheet-transfer.js");
  const csv = OWEH.domain.sheetTransfer;
  assert.deepEqual(csv.selectedIds("\uFEFFID,Kind,Discard\r\n100,egg,YES\r\n101,pet,NO\r\n102,egg,TRUE\r\n100,egg,YES\r\n"), ["100", "102"]);
  assert.deepEqual(csv.selectedIds("ID\n103\n104\n"), ["103", "104"]);
  assert.deepEqual(csv.selectedIds("103\n104\n"), ["103", "104"]);
  assert.throws(() => csv.selectedIds("ID,Species\n100,Canis"), /Discard column/);
  assert.throws(() => csv.selectedIds("ID,Discard\n100,MAYBE"), /Invalid Discard/);
  assert.throws(() => csv.selectedIds("ID,Discard\n1E+08,YES"), /Invalid numeric IDs/);
  assert.throws(() => csv.selectedIds("ID,Discard\n100,NO"), /No IDs marked/);
  assert.throws(() => csv.selectedIds('"123'), /Unclosed CSV quote/);
  delete globalThis.OWEH;
});

test("Google Sheets fetch is constrained to published CSV and no credentials", async () => {
  globalThis.OWEH_BG = {};
  delete require.cache[require.resolve("../bg/sheet-csv.js")];
  require("../bg/sheet-csv.js");
  const api = globalThis.OWEH_BG.sheetCsv;
  const url = "https://docs.google.com/spreadsheets/d/e/2PACX-demo/pub?output=csv";
  assert.equal(api.normalizeUrl(url), url);
  assert.throws(() => api.normalizeUrl("https://evil.example/"), /Only HTTPS/);
  assert.throws(() => api.normalizeUrl("http://docs.google.com/spreadsheets/d/e/a/pub?output=csv"), /Only HTTPS/);
  assert.throws(() => api.normalizeUrl("https://docs.google.com/spreadsheets/d/abc/edit"), /published CSV/);
  assert.throws(() => api.normalizeUrl(url + "&unexpected=1"), /Unexpected CSV/);
  let args;
  const response = await api.load(url, async (requested, opts) => {
    args = [requested, opts];
    return { ok: true, url: requested, headers: { get: () => null }, text: async () => "ID,Discard\n123,YES\n" };
  });
  assert.match(response, /123,YES/);
  assert.equal(args[1].credentials, "omit");
  await assert.rejects(() => api.load(url, async requested =>
    ({ ok: true, url: "https://example.com/stolen.csv", headers: { get: () => null }, text: async () => "" })), /redirected outside/);
  await assert.rejects(() => api.load(url, async requested =>
    ({ ok: true, url: requested, headers: { get: () => "3000000" }, text: async () => "" })), /exceeds/);
  delete globalThis.OWEH_BG;
});

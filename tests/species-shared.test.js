"use strict";

// bg/species-shared.js: two installs (think: the full extension on one PC, Friend Sweep Lite on
// another) share one Name-the-Species database through a fake GitHub gist service.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const clone = value => JSON.parse(JSON.stringify(value));
const OWNER = "ngotrongduong";
const GOOD_TOKEN = `ghp_${"a".repeat(36)}`;
const OTHER_TOKEN = `ghp_${"b".repeat(36)}`;
const shape = start => "0".repeat(start) + "f".repeat(16) + "0".repeat(240 - start);
const near = value => `${value.slice(0, -1)}1`;
const S1 = shape(0);
const S2 = shape(32);
const S3 = shape(64);
const S4 = shape(96);

// In-memory GitHub: gists, the owner's public gist list, /user, raw URLs. Records every request.
function fakeGitHub() {
  const gists = new Map();
  const log = [];
  let created = 0;
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => clone(body), text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  });
  async function fetch(url, options = {}) {
    const method = options.method || "GET";
    const auth = String(options.headers?.Authorization || "");
    log.push({ url, method, auth });
    if (url.startsWith("https://gist.githubusercontent.com/")) {
      const [, id, name] = url.match(/\/raw\/([^/]+)\/(.+)$/) || [];
      const content = gists.get(id)?.files[name];
      return content == null ? reply(404, "") : reply(200, content);
    }
    const { pathname } = new URL(url);
    const user = auth === `Bearer ${GOOD_TOKEN}` ? OWNER : auth === `Bearer ${OTHER_TOKEN}` ? "someone-else" : "";
    if (auth && !user) return reply(401, { message: "Bad credentials" });
    if (pathname === "/user") return user ? reply(200, { login: user }) : reply(401, {});
    if (pathname === `/users/${OWNER}/gists` && method === "GET") {
      return reply(200, [...gists.entries()].filter(([, gist]) => gist.public).map(([id, gist]) => ({ id, description: gist.description, created_at: gist.createdAt })));
    }
    if (pathname === "/gists" && method === "POST") {
      if (user !== OWNER) return reply(401, {});
      const body = JSON.parse(options.body);
      const id = `abc${++created}`;
      gists.set(id, {
        description: body.description, public: body.public, createdAt: `2026-10-14T10:00:0${created}Z`,
        files: Object.fromEntries(Object.entries(body.files).map(([name, file]) => [name, file.content]))
      });
      return reply(201, { id });
    }
    const match = pathname.match(/^\/gists\/([^/]+)$/);
    if (match) {
      const gist = gists.get(match[1]);
      if (!gist) return reply(404, {});
      if (method === "GET") {
        return reply(200, { id: match[1], files: Object.fromEntries(Object.entries(gist.files).map(([name, content]) => [name, {
          content: gist.truncate?.includes(name) ? content.slice(0, 50) : content,
          truncated: Boolean(gist.truncate?.includes(name)),
          raw_url: `https://gist.githubusercontent.com/${OWNER}/raw/${match[1]}/${name}`
        }])) });
      }
      if (method === "PATCH") {
        if (user !== OWNER) return reply(user ? 403 : 401, {});
        for (const [name, file] of Object.entries(JSON.parse(options.body).files)) gist.files[name] = file.content;
        return reply(200, { id: match[1] });
      }
    }
    return reply(404, {});
  }
  return { fetch, gists, log, file: (id, species) => JSON.parse(gists.get(id).files[`species-${species}.json`]) };
}

// One install: its own storage, the shared modules, the shared GitHub.
function install(github, { now }) {
  const store = {};
  const alarms = {};
  const chrome = {
    storage: { local: {
      async get(defaults) {
        if (typeof defaults === "string") return { [defaults]: clone(store[defaults]) };
        return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in store ? clone(store[key]) : fallback]));
      },
      async set(values) { Object.assign(store, clone(values)); }
    } },
    alarms: { get: async name => alarms[name], create: (name, info) => { alarms[name] = clone(info); }, onAlarm: { addListener() {} } },
    tabs: { query: async () => [] },
    runtime: { getURL: file => `chrome-extension://x/${file}` }
  };
  const sandbox = vm.createContext({ chrome, console, Promise, Object, Array, Number, String, Boolean, Set, Map, Math, Date, JSON, RegExp, URL, Uint8Array, globalThis: null });
  sandbox.globalThis = sandbox;
  for (const file of ["domain/species-shape.js", "bg/species-stats.js", "bg/species-learned.js", "bg/species-shared.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
  }
  const shared = sandbox.OWEH_BG.speciesShared;
  const learned = sandbox.OWEH_BG.speciesLearned;
  const started = shared.start({ fetch: github.fetch, now });
  const examples = async species => clone((await learned.readAll())[species]?.examples || []);
  return { shared, learned, store, alarms, started, examples };
}

(async () => {
  let t = Date.parse("2026-10-14T10:00:00Z");
  const now = () => t;
  const github = fakeGitHub();

  // Install A (main, will hold a token) learned Lepus; install B (lite, no token) learned Catus.
  const A = install(github, { now });
  const B = install(github, { now });
  await Promise.all([A.started, B.started]);
  assert.deepEqual(A.alarms["oweh-species-shared"], { periodInMinutes: 60 });
  assert.equal(github.gists.size, 0, "without a token nothing is created");
  assert.equal((await B.shared.status()).hubExamples, 0);
  await A.learned.learn({ species: "Lepus", shape: S1 });
  await B.learned.learn({ species: "Catus", shape: S2 });

  // Tokens are checked with GitHub and must be the owner's.
  assert.equal((await A.shared.setToken({ token: "hello" })).ok, false);
  assert.match((await A.shared.setToken({ token: OTHER_TOKEN })).error, /someone-else/);
  assert.match((await A.shared.setToken({ token: `ghp_${"z".repeat(36)}` })).error, /did not accept/);
  assert.equal(A.store.owehSpeciesShareToken, undefined);

  // A saves the owner's token: the first sync creates the gist with what A learned.
  const saved = await A.shared.setToken({ token: GOOD_TOKEN });
  assert.equal(saved.ok, true);
  assert.equal(saved.contributing, true);
  assert.equal(saved.tokenEnd, "aaaa");
  assert.equal(saved.sync.sent, 1);
  assert.equal(github.gists.size, 1);
  const [gistId] = [...github.gists.keys()];
  const gist = github.gists.get(gistId);
  assert.equal(gist.public, true);
  assert.deepEqual(Object.keys(gist.files).sort(), ["about.md", "species-Lepus.json"]);
  assert.deepEqual(github.file(gistId, "Lepus").examples, [S1]);
  assert.equal((await A.shared.status()).url, `https://gist.github.com/${OWNER}/${gistId}`);

  // B has no token: it finds the gist on its own and takes A's silhouette, sends nothing.
  t += 61 * 60 * 1000;
  await B.shared.sync();
  assert.deepEqual(await B.examples("Lepus"), [S1], "what one install learned, the other answers");
  assert.equal(github.file(gistId, "Lepus").examples.length, 1);
  assert.equal(gist.files["species-Catus.json"], undefined, "an install without a token only receives");
  const bStatus = await B.shared.status();
  assert.deepEqual([bStatus.contributing, bStatus.hubExamples, bStatus.totalReceived], [false, 1, 1]);

  // An hour has not passed: the alarm's sync does nothing.
  assert.equal((await B.shared.sync()).action, "recent");

  // B gets the token too and sends Catus; A receives it at its next sync.
  assert.equal((await B.shared.setToken({ token: GOOD_TOKEN })).sync.sent, 1);
  assert.deepEqual(github.file(gistId, "Catus").examples, [S2]);
  assert.equal(github.file(gistId, "Lepus").examples.length, 1, "what came from the gist is not sent back");
  t += 61 * 60 * 1000;
  await A.shared.sync();
  assert.deepEqual(await A.examples("Catus"), [S2]);

  // The game rejects Lepus for that picture on B: the rejection travels, A drops its copy too.
  await B.learned.forget({ species: "Lepus", shape: near(S1), refuted: true });
  assert.deepEqual(await B.examples("Lepus"), []);
  await B.shared.sync({ force: true });
  assert.deepEqual(github.file(gistId, "Lepus").examples, []);
  assert.deepEqual(github.file(gistId, "Lepus").refuted, [near(S1)]);
  await A.shared.sync({ force: true });
  assert.deepEqual(await A.examples("Lepus"), [], "a rejection on one install removes the mask everywhere");
  await A.learned.learn({ species: "Lepus", shape: S1 });
  await A.shared.sync({ force: true });
  assert.deepEqual(github.file(gistId, "Lepus").examples, [], "a rejected mask is not shared again");

  // Two installs writing the same species at once: one write is lost, the next sync repairs it.
  await A.learned.learn({ species: "Ovis", shape: S3 });
  await B.learned.learn({ species: "Ovis", shape: S4 });
  const files = gist.files;
  await A.shared.sync({ force: true });
  const afterA = files["species-Ovis.json"];
  await B.shared.sync({ force: true });
  assert.ok(github.file(gistId, "Ovis").examples.includes(S3) && github.file(gistId, "Ovis").examples.includes(S4));
  files["species-Ovis.json"] = afterA.replace(/"examples":\[[^\]]*\]/, `"examples":["${S3}"]`);
  await B.shared.sync({ force: true });
  assert.ok(github.file(gistId, "Ovis").examples.includes(S4), "a lost write is sent again");

  // Junk in the gist is ignored: wrong format, a file named for another species, bad masks.
  files["species-Rattus.json"] = JSON.stringify({ format: "other", species: "Rattus", examples: [S1], refuted: [] });
  files["species-Gallus.json"] = JSON.stringify({ format: "ovipets-species-shared/1", species: "Lupus", examples: [S1], refuted: [] });
  files["species-Avi.json"] = JSON.stringify({ format: "ovipets-species-shared/1", species: "Avi", examples: ["zz", S2.toUpperCase(), 7], refuted: "x" });
  files["notes.txt"] = "hello";
  await A.shared.sync({ force: true });
  assert.deepEqual(await A.examples("Rattus"), []);
  assert.deepEqual(await A.examples("Lupus"), []);
  assert.deepEqual(await A.examples("Gallus"), []);
  assert.deepEqual(await A.examples("Avi"), [S2], "valid masks of a file are kept, the rest dropped");

  // A file too big for the API answer is read from its raw URL (and only from gist.githubusercontent.com).
  const C = install(github, { now });
  await C.started;
  gist.truncate = ["species-Ovis.json"];
  await C.shared.sync({ force: true });
  assert.ok((await C.examples("Ovis")).includes(S4));
  assert.ok(github.log.some(entry => entry.url.startsWith("https://gist.githubusercontent.com/")));
  delete gist.truncate;

  // The token only ever goes to api.github.com.
  for (const entry of github.log) {
    if (entry.auth) assert.ok(entry.url.startsWith("https://api.github.com/"), `token sent to ${entry.url}`);
  }

  // A gist created twice (two first syncs at once): everybody settles on the oldest.
  github.gists.set("zzz9", { description: gist.description, public: true, createdAt: "2027-01-01T00:00:00Z", files: { "about.md": "x" } });
  await C.shared.sync({ force: true });
  assert.ok((await C.shared.status()).url.endsWith(gistId));

  // A deleted gist is forgotten and looked for again; a revoked token is reported.
  const D = install(github, { now });
  await D.started;
  await D.shared.setToken({ token: GOOD_TOKEN });
  D.store.owehSpeciesShared.gistId = "gone1";
  github.gists.get(gistId).public = false;
  github.gists.delete("zzz9");
  const lost = await D.shared.sync({ force: true });
  assert.equal(lost.ok, true);
  github.gists.get(gistId).public = true;
  D.store.owehSpeciesShareToken = `ghp_${"q".repeat(36)}`;
  const revoked = await D.shared.sync({ force: true });
  assert.equal(revoked.ok, false);
  assert.match((await D.shared.status()).lastError, /token/);
  assert.equal((await D.shared.setToken({ token: "" })).contributing, false, "the token can be removed");

  console.log("shared species database tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const files = ["../jobs/core.js", "../domain/colors.js", "../domain/egg-rank.js", "../features/best-eggs.js"];

function load() {
  for (const file of files) delete require.cache[require.resolve(path.join(__dirname, file))];
  delete globalThis.OWEH;
  for (const file of files) require(file);
  return globalThis.OWEH;
}

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const FAR = { body1: "#808080", body2: "#808080", scales: "#808080", extra1: "#808080", extra2: "#808080" };
const PURE = { body1: "#FFFFFF", body2: "#FF0000", scales: "#000000", extra1: "#FF0000", extra2: "#000000" };

test("egg rank: closeness to the pure target, Body 1 first", () => {
  const { eggRank, colors } = load().domain;
  const target = { ...colors.STRICT_PURE_TARGET };
  const score = patch => eggRank.scoreColors({ ...FAR, ...patch }, target);

  assert.equal(eggRank.MAX_SCORE, 45);
  assert.equal(Math.round(eggRank.scoreColors(PURE, target).score), 45);
  assert.equal(eggRank.scoreColors(PURE, target).exactChannels, 15);
  assert.equal(eggRank.scoreColors(PURE, target).distance, 0);
  assert.equal(eggRank.scoreColors({ ...PURE, extra2: undefined }, target), null, "an unknown slot is never scored");

  // The same improvement is worth more the earlier the slot comes in the priority order.
  const slots = [
    score({ body1: "#FFFFFF" }).score, score({ body2: "#FF0000" }).score, score({ scales: "#000000" }).score,
    score({ extra1: "#FF0000" }).score, score({ extra2: "#000000" }).score
  ];
  for (let index = 1; index < slots.length; index += 1) assert.ok(slots[index - 1] > slots[index], `slot ${index} must count less`);
  // Closer is always better, and exact counts far more than merely near.
  assert.ok(score({ body1: "#FEFFFF" }).score > score({ body1: "#F0FFFF" }).score);
  assert.ok(score({ body1: "#FFFFFF" }).score - score({ body1: "#FEFFFF" }).score
    > score({ body1: "#F0FFFF" }).score - score({ body1: "#E0FFFF" }).score);

  const ranking = eggRank.rankEggs([
    { id: "1", colors: { ...FAR } },
    { id: "2", colors: { ...FAR, extra2: "#000000" } },
    { id: "3", colors: { ...FAR, body1: "#FFFFFF" } },
    { id: "4", colors: { ...FAR, body2: "#FF0000" } },
    { id: "5", colors: { body1: "#FFFFFF" } },
    { id: "6", colors: { ...FAR, body1: "#FFFFFF" } }
  ], target, 3);
  assert.deepEqual(ranking.best.map(egg => [egg.id, egg.rank]), [["3", 1], ["6", 2], ["4", 3]], "ties keep the lower id first");
  assert.equal(ranking.scored, 5);
  assert.equal(ranking.unscored, 1);

  assert.equal(eggRank.clampCount(undefined), 10);
  assert.equal(eggRank.clampCount(0), 10);
  assert.equal(eggRank.clampCount("7"), 7);
  assert.equal(eggRank.clampCount(999), 50);
});

// A Hatchery page small enough to fake: one card (li) per egg, each holding its profile link.
class Element {
  constructor() {
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.textContent = "";
    this.className = "";
    this.style = {};
    this.title = "";
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  querySelector(selector) { return selector === ".oweh-egg-rank" ? this.children.find(child => child.className === "oweh-egg-rank") || null : null; }
}

function setup({ eggIds, records = {}, cache = {}, profiles = {}, onHatchery = true, hatcherySeen = true, count, stored } = {}) {
  const OWEH = load();
  const store = { owehPets: clone(records), owehEggColors: clone(cache), owehOwnUserId: "77" };
  if (count !== undefined) store.owehBestEggCount = count;
  if (stored) store.owehBestEggs = clone(stored);
  const world = { eggIds: [...eggIds], onHatchery, hatcherySeen };
  const log = { status: [], reads: [], writes: 0 };
  const page = { cards: new Map(), list: new Element() };
  const draw = () => {
    page.cards = new Map(world.eggIds.map(id => {
      const card = new Element();
      const append = card.appendChild.bind(card);
      card.appendChild = child => { log.writes += 1; return append(child); };
      card.anchor = { getAttribute: () => `#!/?src=pets&sub=profile&usr=77&pet=${id}`, closest: () => card };
      return [id, card];
    }));
  };
  draw();
  const badges = () => [...page.cards.values()].flatMap(card => card.children.filter(child => child.className === "oweh-egg-rank"));
  global.document = {
    createElement: () => new Element(),
    querySelector: selector => selector === "#oweh-best-eggs-list" ? page.list
      : (selector === 'main a.pet[href*="pet="]' ? [...page.cards.values()][0]?.anchor || null : null),
    querySelectorAll: selector => {
      if (selector === ".oweh-egg-rank") return badges();
      const id = selector.match(/^main a\.pet\[href\*="pet=(\d+)"\]$/)?.[1];
      // Like the real selector, a substring match: "pet=1" also finds pet 10, 11, ...
      return id ? [...page.cards.entries()].filter(([key]) => key.startsWith(id)).map(([, card]) => card.anchor) : [];
    }
  };
  const helpers = {
    storageGet: async (key, fallback) => key in store ? clone(store[key]) : clone(fallback),
    storageSet: async values => { for (const [key, value] of Object.entries(values)) store[key] = clone(value); },
    getPetsByIds: async ids => Object.fromEntries(ids.filter(id => store.owehPets[id]).map(id => [id, clone(store.owehPets[id])])),
    setStatus: text => log.status.push(text),
    routes: { isOwnHatchery: () => world.onHatchery },
    domain: { colors: OWEH.domain.colors, eggRank: OWEH.domain.eggRank },
    petFetch: {
      readHatchery: async () => ({ hatcherySeen: world.hatcherySeen, eggIds: [...world.eggIds], unnamedIds: [] }),
      readPet: async (id, usr, options) => {
        log.reads.push([id, usr, options?.skipPedigree]);
        return profiles[id] ? { ok: true, record: { id, colors: clone(profiles[id]) } } : { ok: false, reason: "missing-colors" };
      }
    }
  };
  const feature = OWEH.boot(helpers)["feature-best-eggs"];
  const marks = () => Object.fromEntries([...page.cards.entries()]
    .filter(([, card]) => card.dataset.owehBestEgg).map(([id, card]) => [id, card.children.find(child => child.className === "oweh-egg-rank")?.textContent]));
  return { store, log, world, page, feature, marks, draw, badges };
}

test("best eggs: scans every egg, fetching only the ones not known yet", async () => {
  const env = setup({
    eggIds: ["1", "2", "3", "10", "11"],
    records: {
      1: { id: "1", colors: { ...FAR } },                            // saved by the newborn pass
      2: { id: "2", colors: { ...FAR, body1: "#FFFFFF" } },
      10: { id: "10", colors: { body1: "#FFFFFF" } }                 // incomplete record: read again
    },
    cache: { 3: "808080-FF0000-808080-808080-808080", 99: "808080-808080-808080-808080-808080" },
    profiles: { 10: { ...FAR, body1: "#FFFFFF", body2: "#FF0000" } },
    count: 3
  });
  await env.feature.api.highlight();
  assert.deepEqual(env.log.reads, [["10", "77", true], ["11", "77", true]], "profile only, and only for unknown eggs");
  const best = env.store.owehBestEggs.best;
  assert.deepEqual(best.map(egg => [egg.id, egg.rank]), [["10", 1], ["2", 2], ["3", 3]]);
  assert.equal(best[0].key, "FFFFFF-FF0000-808080-808080-808080");
  assert.equal(best[0].exactChannels, 6);
  assert.equal(env.store.owehBestEggs.eggs, 5);
  assert.equal(env.store.owehBestEggs.scored, 4);
  assert.equal(env.store.owehBestEggs.unread, 1);
  assert.deepEqual(Object.keys(env.store.owehEggColors).sort(), ["1", "10", "2", "3"], "the cache keeps only eggs still in the Hatchery");
  assert.deepEqual(env.store.owehPets["10"], { id: "10", colors: { body1: "#FFFFFF" } }, "the pet database is never written");
  assert.match(env.log.status.at(-1), /marked the 3 best of 4 egg\(s\).*weighted 5\/4\/3\/2\/1.*1 newly read.*1 could not be read/);

  // Marks and panel list.
  assert.deepEqual(env.marks(), { 10: "#1", 2: "#2", 3: "#3" });
  assert.equal(env.page.cards.get("1").dataset.owehBestEgg, undefined, "pet=1 must not match pet=10");
  assert.equal(env.badges()[0].dataset.owehUi, "1", "marks are extension-owned nodes");
  assert.equal(env.page.list.children.length, 3);
  assert.equal(env.page.list.children[0].href, "#!/?src=pets&sub=profile&pet=10");
  assert.equal(env.page.list.children[0].children.filter(child => child.className === "oweh-swatch").length, 5);

  // A second scan reads nothing again except the egg that could not be read.
  env.log.reads.length = 0;
  await env.feature.api.highlight();
  assert.deepEqual(env.log.reads, [["11", "77", true]]);
});

test("best eggs: marks are idempotent, survive a redraw and follow the route", async () => {
  const env = setup({
    eggIds: ["1", "2", "3"],
    records: { 1: { id: "1", colors: { ...FAR } }, 2: { id: "2", colors: { ...PURE } }, 3: { id: "3", colors: { ...FAR, body1: "#FFFFFF" } } },
    count: 2
  });
  await env.feature.api.highlight();
  assert.deepEqual(env.marks(), { 2: "#1", 3: "#2" });
  const writes = env.log.writes;
  env.feature.onRefresh();
  env.feature.onRefresh();
  assert.equal(env.log.writes, writes, "an already marked page is not written again");

  // OviPets redraws the Hatchery: the marks are put back on the next refresh.
  env.draw();
  assert.deepEqual(env.marks(), {});
  env.feature.onRefresh();
  assert.deepEqual(env.marks(), { 2: "#1", 3: "#2" });

  // Leaving the own Hatchery removes the marks; the panel list stays.
  env.world.onHatchery = false;
  env.feature.onRefresh();
  assert.deepEqual(env.marks(), {});
  assert.equal(env.badges().length, 0);
  assert.equal(env.page.list.children.length, 2);

  // An egg that left the Hatchery is simply not marked.
  env.world.onHatchery = true;
  env.world.eggIds = ["1", "3"];
  env.draw();
  env.feature.onRefresh();
  assert.deepEqual(env.marks(), { 3: "#2" });

  // A new ranking replaces the old marks.
  env.store.owehBestEggCount = 1;
  await env.feature.api.highlight();
  assert.deepEqual(env.marks(), { 3: "#1" });

  await env.feature.api.clear();
  assert.deepEqual(env.marks(), {});
  assert.equal(env.store.owehBestEggs, null);
  assert.equal(env.page.list.children.length, 0);
});

test("best eggs: an unreadable or empty Hatchery changes nothing", async () => {
  const broken = setup({ eggIds: ["1"], records: { 1: { id: "1", colors: { ...PURE } } }, hatcherySeen: false });
  await broken.feature.api.highlight();
  assert.equal(broken.store.owehBestEggs, undefined);
  assert.match(broken.log.status.at(-1), /could not be read/);

  const empty = setup({ eggIds: [] });
  await empty.feature.api.highlight();
  assert.equal(empty.store.owehBestEggs, undefined);
  assert.match(empty.log.status.at(-1), /no eggs/);

  // Off the Hatchery the scan still works; the status says where the marks will show.
  const away = setup({ eggIds: ["1"], records: { 1: { id: "1", colors: { ...PURE } } }, onHatchery: false });
  await away.feature.api.highlight();
  assert.equal(away.store.owehBestEggs.best.length, 1);
  assert.deepEqual(away.marks(), {});
  assert.match(away.log.status.at(-1), /open your Hatchery to see them marked/);

  // A stored result is shown again after a page reload, without scanning.
  const reloaded = setup({
    eggIds: ["5", "6"],
    stored: { at: 1, best: [{ id: "5", rank: 1, key: "FFFFFF-FF0000-000000-FF0000-000000", score: 45, exactChannels: 15 }] }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reloaded.marks(), { 5: "#1" });
  assert.equal(reloaded.page.list.children.length, 1);
  assert.equal(reloaded.log.reads.length, 0);
});

"use strict";

// Behavior of services/friend-directory.js (blacklist CSV, friend queue) and services/retention.js
// (review-only ranking + CSV), driven through their factories with fakes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = value => JSON.parse(JSON.stringify(value));

function load(file, document = {}) {
  const context = { OWEH: {}, console, Date, document };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "services", file), "utf8"), context);
  return context.OWEH.services;
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    storageGet: async (key, fallback) => (key in data ? data[key] : fallback),
    storageSet: async values => { Object.assign(data, values); }
  };
}

(async () => {
  // ---- friend-directory -------------------------------------------------------------------
  {
    const statuses = [];
    const clipboard = [];
    const store = fakeStorage({ owehFriendQueue: [{ id: 7, name: 'Al "Ace"' }] });
    const document = { querySelectorAll: () => [] };
    const { friendDirectory } = load("friend-directory.js", document);
    const service = friendDirectory.createFriendDirectory({
      ...store,
      sleep: async () => {},
      setStatus: text => statuses.push(text),
      getPageLoadDelayMs: () => 0,
      getOwnUserId: () => "1",
      getBlacklist: async () => ({ 7: { reason: "no eggs", at: Date.UTC(2026, 0, 2) }, 8: {} }),
      writeClipboard: async text => { clipboard.push(text); },
      friendLinks: () => [{ id: "7", name: "Al" }, { id: "9", name: "Bo" }],
      chatDom: { NINJA_CHAT_TARGETS: [], parseCommentTime: () => NaN, chatPostContainer: () => null, collectChatCandidates: () => [] }
    });

    await service.copyBlacklistCsv();
    assert.equal(clipboard.length, 1);
    assert.equal(clipboard[0], [
      "user_id,name,reason,blacklisted_at",
      '"7","Al ""Ace""","no eggs","2026-01-02T00:00:00.000Z"',
      '"8","","",""'
    ].join("\n"));
    assert.match(statuses.at(-1), /Copied 2 blacklisted friend/);

    // scanFriends saves the visible friends minus the blacklist and resets the sweep.
    await service.scanFriends();
    assert.deepEqual(plain(store.data.owehFriendQueue), [{ id: "9", name: "Bo" }]);
    assert.deepEqual(plain(store.data.owehSweep), { active: false, index: 0, maxFriends: 1 });
    assert.match(statuses.at(-1), /1 blacklisted friend\(s\) excluded/);

    // A denied clipboard reports instead of throwing.
    const denied = friendDirectory.createFriendDirectory({
      ...store, sleep: async () => {}, setStatus: text => statuses.push(text), getPageLoadDelayMs: () => 0,
      getOwnUserId: () => "1", getBlacklist: async () => ({ 1: {} }),
      writeClipboard: async () => { throw new Error("denied"); }, friendLinks: () => [],
      chatDom: { NINJA_CHAT_TARGETS: [], parseCommentTime: () => NaN, chatPostContainer: () => null, collectChatCandidates: () => [] }
    });
    await denied.copyBlacklistCsv();
    assert.match(statuses.at(-1), /clipboard access was denied/);
  }

  // ---- retention ----------------------------------------------------------------------------
  {
    const statuses = [];
    const clipboard = [];
    const pets = {
      a: { id: "a", owned: true, colors: {}, species: "Canis", enclosure: "Line", exact: 3, distance: 10 },
      b: { id: "b", owned: true, colors: {}, species: "Canis", enclosure: "Line", exact: 3, distance: 2 },
      c: { id: "c", owned: true, colors: {}, species: "Canis", enclosure: "Line", exact: 1, distance: 0 },
      d: { id: "d", owned: true, colors: {}, species: "Felis", enclosure: "Line", exact: 5, distance: 0 },
      e: { id: "e", owned: true, colors: {}, species: "Canis", enclosure: "Other", exact: 6, distance: 0 },
      f: { id: "f", owned: false, colors: {}, species: "Canis", enclosure: "Line", exact: 6, distance: 0 }
    };
    const store = fakeStorage({ owehPets: pets });
    const { retention } = load("retention.js");
    const service = retention.createRetention({
      ...store,
      setStatus: text => statuses.push(text),
      writeClipboard: async text => { clipboard.push(text); },
      petPureMetrics: pet => ({ exactChannels: pet.exact, usedChannels: 3, distance: pet.distance }),
      STRICT_PURE_TARGET: {},
      isBreedingProgramEnclosure: enclosure => enclosure === "Line"
    });

    const { ranking, review } = await service.updateRetentionRanking();
    // Only owned pets of the most common breeding-line species; more exact channels first, then distance.
    assert.deepEqual(plain(ranking).map(item => item.id), ["b", "a", "c"]);
    assert.deepEqual(plain(review).map(item => item.id), ["c", "a", "b"], "review lists the lowest-ranked first");
    assert.equal(store.data.owehRetentionRanking.length, 3);
    assert.ok(!("f" in Object.fromEntries(ranking.map(item => [item.id, 1]))), "unowned pets are never ranked");

    await service.copyRetentionReviewCsv();
    assert.equal(clipboard.length, 1);
    assert.equal(clipboard[0].split("\n")[0], '"id","name","gender","species","enclosure","exact_target_channels","used_channels","distance","review_score"');
    assert.equal(clipboard[0].split("\n").length, 4);
    assert.match(statuses.at(-1), /nothing was removed/);
    assert.deepEqual(Object.keys(store.data.owehPets), Object.keys(pets), "retention must never remove a pet");
  }

  console.log("friend-directory and retention service tests passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});

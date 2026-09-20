"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TARGET_CONVERSATIONS,
  normalizeConversationTitle,
  isWithinRollingWindow,
  scanDualConversationCandidates,
} = require("./ninja-dual-chat-policy");

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-20T07:00:00Z");

function conversation(title, messages = []) {
  return { title, messages };
}

function makeOptions(conversations, sentIds = []) {
  const opened = [];
  return {
    opened,
    options: {
      now: NOW,
      sentIds,
      listConversations: async () => conversations,
      openConversation: async (item) => {
        opened.push(item.title);
      },
      readMessages: async (item) => item.messages,
    },
  };
}

test("target titles are normalized and independent of list position", () => {
  assert.deepEqual(TARGET_CONVERSATIONS, ["Ninja please", "Ads post"]);
  assert.equal(normalizeConversationTitle("  Ninja   PLEASE "), "ninja please");
});

test("rolling 24-hour window includes exact boundary and excludes older/future messages", () => {
  assert.equal(isWithinRollingWindow(NOW - 24 * HOUR, NOW), true);
  assert.equal(isWithinRollingWindow(NOW - 24 * HOUR - 1, NOW), false);
  assert.equal(isWithinRollingWindow(NOW + 1, NOW), false);
});

test("queues a recent user found only in Ninja please", async () => {
  const { options } = makeOptions([
    conversation("Ninja please", [{ userId: 101, at: NOW - HOUR }]),
    conversation("Ads post", []),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, ["101"]);
});

test("queues a recent user found only in Ads post", async () => {
  const { options } = makeOptions([
    conversation("Ninja please", []),
    conversation("Ads post", [{ userId: "202", at: NOW - 2 * HOUR }]),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, ["202"]);
});

test("deduplicates a user across both conversations by user ID", async () => {
  const { options } = makeOptions([
    conversation("Ads post", [{ userId: "303", at: NOW - HOUR }]),
    conversation("Ninja please", [{ userId: "303", at: NOW - 2 * HOUR }]),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, ["303"]);
  assert.deepEqual(result.candidates[0].sources.sort(), ["Ads post", "Ninja please"]);
  assert.equal(result.stats.duplicateCandidateHits, 1);
});

test("deduplicates repeated posts from the same user inside one conversation", async () => {
  const { options } = makeOptions([
    conversation("Ninja please", [
      { userId: "404", at: NOW - 3 * HOUR },
      { userId: "404", at: NOW - HOUR },
      { userId: "404", at: NOW - 2 * HOUR },
    ]),
    conversation("Ads post", []),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, ["404"]);
  assert.equal(result.candidates[0].lastSeenAt, NOW - HOUR);
  assert.equal(result.candidates[0].firstSeenAt, NOW - 3 * HOUR);
});

test("globally skips IDs already present in persistent sent history", async () => {
  const { options } = makeOptions([
    conversation("Ninja please", [{ userId: "505", at: NOW - HOUR }]),
    conversation("Ads post", [{ userId: "505", at: NOW - 2 * HOUR }]),
  ], ["505"]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, []);
  assert.equal(result.stats.skippedAlreadySent, 2);
});

test("skips messages older than 24 hours", async () => {
  const { options } = makeOptions([
    conversation("Ninja please", [{ userId: "606", at: NOW - 24 * HOUR - 1 }]),
    conversation("Ads post", []),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, []);
});

test("missing Ninja please fails soft and Ads post is still scanned", async () => {
  const { options } = makeOptions([
    conversation("Ads post", [{ userId: "707", at: NOW - HOUR }]),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, ["707"]);
  assert.deepEqual(result.missingTitles, ["Ninja please"]);
});

test("missing Ads post preserves original Ninja please behavior", async () => {
  const { options } = makeOptions([
    conversation("Ninja please", [{ userId: "808", at: NOW - HOUR }]),
  ]);

  const result = await scanDualConversationCandidates(options);
  assert.deepEqual(result.candidateIds, ["808"]);
  assert.deepEqual(result.missingTitles, ["Ads post"]);
});

test("conversation vertical order does not change output", async () => {
  const a = [
    conversation("Ninja please", [{ userId: "901", at: NOW - 2 * HOUR }]),
    conversation("Ads post", [{ userId: "902", at: NOW - HOUR }]),
  ];
  const b = [...a].reverse();

  const first = await scanDualConversationCandidates(makeOptions(a).options);
  const second = await scanDualConversationCandidates(makeOptions(b).options);

  assert.deepEqual(first.candidateIds, second.candidateIds);
});

test("a source error does not abort scanning the other target", async () => {
  const conversations = [
    conversation("Ninja please", [{ userId: "1001", at: NOW - HOUR }]),
    conversation("Ads post", [{ userId: "1002", at: NOW - HOUR }]),
  ];

  const result = await scanDualConversationCandidates({
    now: NOW,
    listConversations: async () => conversations,
    openConversation: async (item) => {
      if (item.title === "Ninja please") throw new Error("load failed");
    },
    readMessages: async (item) => item.messages,
  });

  assert.deepEqual(result.candidateIds, ["1002"]);
  assert.equal(result.stats.sourceErrors, 1);
});

test("rerun after dispatch excludes IDs newly present in persistent history", async () => {
  const conversations = [
    conversation("Ninja please", [{ userId: "1101", at: NOW - HOUR }]),
    conversation("Ads post", [{ userId: "1102", at: NOW - 2 * HOUR }]),
  ];

  const first = await scanDualConversationCandidates(
    makeOptions(conversations, []).options
  );
  assert.deepEqual(first.candidateIds, ["1101", "1102"]);

  const second = await scanDualConversationCandidates(
    makeOptions(conversations, ["1101", "1102"]).options
  );
  assert.deepEqual(second.candidateIds, []);
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

for (const file of ["../jobs/core.js", "../dom/routes.js", "../dom/friends.js", "../dom/chat.js"]) {
  delete require.cache[require.resolve(path.join(__dirname, file))];
}
delete globalThis.OWEH;
globalThis.location = { hash: "#!/?usr=1" };
require("../jobs/core.js");
require("../dom/routes.js");
require("../dom/friends.js");
require("../dom/chat.js");
const { friends, chat } = globalThis.OWEH.dom;

function link(id, title = `User ${id}`) {
  return {
    textContent: title,
    getAttribute(name) { return name === "href" ? `#!/?usr=${id}` : (name === "title" ? title : null); },
    querySelector() { return null; }
  };
}
const friendRoot = { querySelectorAll: () => [link("1", "Self"), link("2", "Two"), link("2", "Duplicate"), link("3", "Three")] };
assert.deepEqual(friends.friendLinks(friendRoot, "#!/?usr=1").map(item => item.id), ["2", "3"]);

const now = Date.parse("2026-09-19T00:00:00Z");
function comment(id, text, ageText) {
  const user = link(id, `Name ${id}`);
  const time = { textContent: ageText, getAttribute() { return null; } };
  return {
    textContent: `${text} ${ageText}`,
    querySelector(selector) {
      if (selector.startsWith("abbr.age")) return time;
      if (selector === ".comment") return { textContent: text };
      if (selector.includes(".poster a.user")) return user;
      return null;
    }
  };
}
const comments = [
  comment("2", "please add", "5 minutes ago"),
  comment("3", "no friend requests", "4 minutes ago"),
  comment("4", "hello", "2 hours ago"),
  comment("2", "duplicate", "1 minute ago")
];
const container = { querySelectorAll: selector => selector === ".comments li" ? comments : [] };
const queue = chat.collectNinjaCandidates(container, { now, windowMs: 60 * 60 * 1000, ownId: "9", history: { 4: { status: "dispatched" } } });
assert.deepEqual(queue.map(item => item.id), ["2"]);
assert.equal(queue[0].timestamp, now - 1 * 60 * 1000);
assert.throws(() => chat.collectNinjaCandidates(container, { windowMs: 1000 }), /finite now and windowMs/);
// Live labels without a digit (seen on ovipets.com) still count as recent comments.
const wordAges = [comment("5", "add", "a minute ago"), comment("6", "add", "an hour ago"), comment("7", "add", "a few seconds ago")];
const wordQueue = chat.collectNinjaCandidates({ querySelectorAll: selector => selector === ".comments li" ? wordAges : [] }, { now, windowMs: 2 * 60 * 60 * 1000 });
assert.deepEqual(wordQueue.map(item => [item.id, now - item.timestamp]), [["7", 0], ["5", 60000], ["6", 3600000]]);

// Ninja scan now reads both fixed OviPets-profile posts, regardless of their vertical order.
function heading(text) {
  return { textContent: text, getAttribute() { return null; } };
}
function chatEvent(title, eventComments = []) {
  const titleNode = heading(title);
  return {
    textContent: title,
    querySelector(selector) {
      if (selector === ".comments") return { querySelectorAll: () => eventComments };
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes("h1")) return [titleNode];
      if (selector === "img[title], img[alt]") return [];
      if (selector === ".comments li") return eventComments;
      return [];
    }
  };
}
function chatRoot(events) {
  return {
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === "main td.event" ? events : []; }
  };
}
const ninjaEvent = chatEvent("Ninja please", [comment("10", "please add", "3 hours ago")]);
const adsEvent = chatEvent("Ads post", [
  comment("11", "add me", "2 hours ago"),
  comment("10", "same user in both", "1 hour ago"),
  comment("12", "too old", "25 hours ago"),
  comment("13", "already sent", "30 minutes ago")
]);
const reversedRoot = chatRoot([adsEvent, ninjaEvent]);
assert.equal(chat.chatPostContainer("Ninja please", reversedRoot), ninjaEvent);
assert.equal(chat.chatPostContainer("  ADS   POST ", reversedRoot), adsEvent);
assert.deepEqual(chat.NINJA_CHAT_TARGETS, ["Ninja please", "Ads post"]);
const dualQueue = chat.collectChatCandidates([ninjaEvent, adsEvent], {
  now,
  windowMs: 24 * 60 * 60 * 1000,
  ownId: "99",
  history: { 13: { status: "dispatched" } }
});
assert.deepEqual(dualQueue.map(item => item.id), ["10", "11"], "two chats merge by ID, history, and 24h window");
assert.equal(dualQueue[0].timestamp, now - 60 * 60 * 1000, "duplicate ID keeps the newest qualifying comment");


const adsImage = { textContent: "", getAttribute(name) { return name === "title" ? "Ads" : null; } };
const adsImageEvent = {
  textContent: "Advertising community",
  querySelector(selector) { return selector === ".comments" ? {} : null; },
  querySelectorAll(selector) {
    if (selector === "img[title], img[alt]") return [adsImage];
    if (selector.includes("h1")) return [];
    return [];
  }
};
assert.equal(chat.chatPostContainer("Ads post", chatRoot([ninjaEvent, adsImageEvent])), adsImageEvent, "Ads image identity is accepted when present");

console.log("friends/chat DOM adapter behavior tests passed");

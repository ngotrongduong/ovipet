"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.removed = false;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {
    this.removed = true;
  }
}

const documentTarget = new EventTarget();
documentTarget.createElement = tag => new TestElement(tag);
documentTarget.body = new TestElement("body");
documentTarget.location = { href: "https://ovipets.com/#!/?src=pets&sub=profile&pet=9001", hash: "#!/?src=pets&sub=profile&pet=9001" };
documentTarget.scripts = [{ src: "https://ovipets.com/js/app.js" }];
let hatchIcons = [];
let breedDialogs = [];
documentTarget.querySelectorAll = selector => {
  if (selector === 'img[title="Hatch Egg"]') return hatchIcons;
  if (selector === '[role="dialog"], .ui-dialog') return breedDialogs;
  return [];
};

global.CustomEvent = TestCustomEvent;
global.document = documentTarget;
global.window = { location: documentTarget.location };

const calls = [];
window.ui_action_cmdExec = (command, params, form, callback) => {
  calls.push({ command, params, form });
  callback();
};

const source = fs.readFileSync(require.resolve("../page-bridge.js"), "utf8");
vm.runInThisContext(source, { filename: "page-bridge.js" });

function request(payload) {
  return new Promise(resolve => {
    const listener = event => {
      const result = JSON.parse(event.detail);
      if (result.requestId !== payload.requestId) return;
      document.removeEventListener("oweh:game-command-result", listener);
      resolve(result);
    };
    document.addEventListener("oweh:game-command-result", listener);
    document.dispatchEvent(new CustomEvent("oweh:game-command", {
      detail: JSON.stringify(payload)
    }));
  });
}

(async () => {
  let result = await request({
    requestId: "move",
    command: "pets_enclosure",
    targetId: "123",
    fields: { Enclosure: "7" }
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].command, "pets_enclosure");
  assert.equal(calls[0].params, "PetID=123");
  assert.equal(calls[0].form.children[0].name, "Enclosure");
  assert.equal(calls[0].form.children[0].value, "7");
  assert.equal(calls[0].form.dataset.owehBridgeOwned, "1", "bridge forms must be marked so content observer can ignore them");

  result = await request({
    requestId: "feed",
    command: "pet_feed",
    targetId: "456",
    fields: {}
  });
  assert.equal(result.ok, true);
  assert.equal(calls[1].command, "pet_feed");
  assert.equal(calls[1].params, "PetID=456");
  assert.equal(calls[1].form.children.length, 0);

  result = await request({ requestId: "request", command: "friend_request", targetId: "789" });
  assert.equal(result.ok, true);
  assert.equal(calls[2].params, "UserID=789");

  result = await request({ requestId: "remove", command: "friend_remove", targetId: "987" });
  assert.equal(result.ok, true);
  assert.equal(calls[3].params, "UserID=987");

  result = await request({
    requestId: "breed",
    command: "pet_breed",
    targetId: "100",
    fields: { MotherID: "100", FatherID: "200" }
  });
  assert.equal(result.ok, true);
  assert.equal(calls[4].params, "MotherID=100&FatherID=200");

  // OviPets can reject a related/ineligible pair by rendering an Error dialog without
  // invoking ui_action_cmdExec's success callback. The bridge must surface that reason
  // immediately instead of waiting 15 seconds and misclassifying it as command-timeout.
  const normalDispatcher = window.ui_action_cmdExec;
  window.ui_action_cmdExec = (command, params, form, callback) => {
    calls.push({ command, params, form });
    if (command === "pet_breed" && params === "MotherID=101&FatherID=201") {
      const ok = {
        textContent: "Ok",
        click() { breedDialogs = []; }
      };
      breedDialogs = [{
        textContent: "Error Unable to breed pets. Ok",
        offsetParent: {},
        querySelectorAll: selector => selector === "button" ? [ok] : []
      }];
      return;
    }
    callback();
  };
  result = await request({
    requestId: "breed-rejected",
    command: "pet_breed",
    targetId: "101",
    fields: { MotherID: "101", FatherID: "201" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unable-to-breed-pets");
  assert.equal(breedDialogs.length, 0, "recognized OviPets breeding error should be dismissed for the next pair");
  window.ui_action_cmdExec = normalDispatcher;

  result = await request({
    requestId: "bad-breed",
    command: "pet_breed",
    targetId: "100",
    fields: { MotherID: "100", FatherID: "not-a-number" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-breeding-pair");
  assert.equal(calls.length, 6);

  result = await request({ requestId: "turn-hidden-blocked", command: "pet_turn_egg", targetId: "7" });
  assert.equal(result.ok, false, "generic Turn Egg must never be dispatched through the hidden page bridge");
  assert.equal(result.reason, "invalid-command");
  assert.equal(calls.length, 6);

  const hatchAnchor = { getAttribute: name => name === "href" ? "#!/?src=pets&sub=profile&pet=7" : null };
  const hatchCard = { querySelector: selector => selector === 'a.pet[href*="pet="]' ? hatchAnchor : null };
  hatchIcons = [{ closest: selector => selector === "li" ? hatchCard : null }];
  documentTarget.location.hash = "#!/?src=pets&sub=hatchery";
  result = await request({
    requestId: "own-hatch",
    command: "pet_turn_egg",
    targetId: "7",
    purpose: "own-hatch",
    fireAndForget: true
  });
  assert.equal(result.ok, true, "own Hatch Egg may use the exact UI dispatcher command");
  assert.equal(calls[6].command, "pet_turn_egg");
  assert.equal(calls[6].params, "PetID=7");

  documentTarget.location.hash = "#!/?src=pets&sub=hatchery&usr=555";
  result = await request({
    requestId: "friend-hatch-blocked",
    command: "pet_turn_egg",
    targetId: "7",
    purpose: "own-hatch",
    fireAndForget: true
  });
  assert.equal(result.ok, false, "friend Hatchery must never use the own-hatch direct path");
  assert.equal(result.reason, "invalid-command");
  assert.equal(calls.length, 7);

  result = await request({ requestId: "paid-feed-blocked", command: "pets_massfeed", targetId: "7" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-command");
  assert.equal(calls.length, 7);

  result = await request({ requestId: "blocked", command: "unknown", targetId: "7" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-command");
  assert.equal(calls.length, 7);

  // Readiness ping: reports whether the dispatcher exists, executes nothing.
  const ping = requestId => new Promise(resolve => {
    const listener = event => {
      const result = JSON.parse(event.detail);
      if (result.requestId !== requestId) return;
      document.removeEventListener("oweh:game-command-result", listener);
      resolve(result);
    };
    document.addEventListener("oweh:game-command-result", listener);
    document.dispatchEvent(new CustomEvent("oweh:game-ping", { detail: JSON.stringify({ requestId }) }));
  });
  result = await ping("ping-ready");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 7, "a ping must never execute a game command");
  const dispatcher = window.ui_action_cmdExec;
  delete window.ui_action_cmdExec;
  result = await ping("ping-early");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "dispatcher-unavailable");
  window.ui_action_cmdExec = dispatcher;
  assert.equal(calls.length, 7);

  // Species Inspector may ask the MAIN-world bridge for passive client-side source hints.
  // This exposes only script URLs + matching global function source, never cookies/headers.
  const sourceHints = new Promise(resolve => {
    const listener = event => {
      document.removeEventListener("oweh:species-source-result", listener);
      resolve(JSON.parse(event.detail));
    };
    document.addEventListener("oweh:species-source-result", listener);
    document.dispatchEvent(new CustomEvent("oweh:species-source-request", {
      detail: JSON.stringify({ sessionId: "species-test" })
    }));
  });
  const hints = await sourceHints;
  assert.equal(hints.sessionId, "species-test");
  assert.ok(hints.hints.some(item => item.name === "ui_action_cmdExec" && /function/.test(item.type)));
  assert.deepEqual(hints.scriptSources, ["https://ovipets.com/js/app.js"]);
  assert.equal(hints.pageRuntime.dispatcherPresent, true);

  // v5.5.0: naming an Unnamed newborn is the confirmed pet_name command with a Name field.
  result = await request({ requestId: "name", command: "pet_name", targetId: "530491258", fields: { Name: "A-B-C" } });
  assert.equal(result.ok, true);
  assert.equal(calls[7].command, "pet_name");
  assert.equal(calls[7].params, "PetID=530491258");
  assert.equal(calls[7].form.children[0].name, "Name");
  assert.equal(calls[7].form.children[0].value, "A-B-C");

  console.log("page bridge tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

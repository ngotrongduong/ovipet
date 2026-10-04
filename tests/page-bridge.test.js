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
let hatchAnchors = [];
let breedDialogs = [];
documentTarget.querySelectorAll = selector => {
  if (selector === 'img[title="Hatch Egg"]') return hatchIcons;
  if (selector === 'main a.pet[href*="pet="]') return hatchAnchors;
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

  // Production Species handling no longer installs network/source tracing in MAIN world.
  for (const retired of ["oweh:species-source-request", "oweh:species-trace-control", "SPECIES_TRACE_NETWORK_EVENT"]) {
    assert.equal(source.includes(retired), false, `retired Species trace hook remains: ${retired}`);
  }

  // v5.5.0: naming an Unnamed newborn is the confirmed pet_name command with a Name field.
  result = await request({ requestId: "name", command: "pet_name", targetId: "530491258", fields: { Name: "A-B-C" } });
  assert.equal(result.ok, true);
  assert.equal(calls[7].command, "pet_name");
  assert.equal(calls[7].params, "PetID=530491258");
  assert.equal(calls[7].form.children[0].name, "Name");
  assert.equal(calls[7].form.children[0].value, "A-B-C");

  // Discard is OviPets' own Edit > Send To command (read live 2026-10-05): pet_sendto with
  // PetID and the SendTo=discard field. The bridge sends it only for the confirmed surplus list.
  const before = calls.length;
  result = await request({
    requestId: "discard", command: "pet_sendto", targetId: "8",
    purpose: "confirmed-discard", fields: { SendTo: "discard" }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).command, "pet_sendto");
  assert.equal(calls.at(-1).params, "PetID=8");
  assert.deepEqual(calls.at(-1).form.children.map(input => [input.name, input.value]), [["SendTo", "discard"]]);

  // Nothing else may send a pet away: no purpose, another destination, extra fields, or a
  // fire-and-forget request that would skip the dispatcher callback.
  for (const blocked of [
    { requestId: "sendto-no-purpose", command: "pet_sendto", targetId: "9", fields: { SendTo: "discard" } },
    { requestId: "sendto-adoption", command: "pet_sendto", targetId: "9", purpose: "confirmed-discard", fields: { SendTo: "adoption_center" } },
    { requestId: "sendto-extra", command: "pet_sendto", targetId: "9", purpose: "confirmed-discard", fields: { SendTo: "discard", UserID: "1" } },
    { requestId: "sendto-empty", command: "pet_sendto", targetId: "9", purpose: "confirmed-discard" },
    { requestId: "sendto-bad-id", command: "pet_sendto", targetId: "9x", purpose: "confirmed-discard", fields: { SendTo: "discard" } }
  ]) {
    result = await request(blocked);
    assert.equal(result.ok, false, blocked.requestId);
    assert.equal(result.reason, "invalid-command", blocked.requestId);
  }
  assert.equal(calls.length, before + 1, "a refused discard never reaches the dispatcher");
  result = await request({
    requestId: "discard-waits", command: "pet_sendto", targetId: "10",
    purpose: "confirmed-discard", fields: { SendTo: "discard" }, fireAndForget: true
  });
  assert.equal(result.ok, true);
  assert.notEqual(result.reason, "dispatched", "a discard always waits for the dispatcher callback");
  for (const retired of ["__verified_discard__", "oweh:discard-action-observed", "verifiedDiscardSignature"]) {
    assert.equal(source.includes(retired), false, `retired discard signature replay remains: ${retired}`);
  }

  console.log("page bridge tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

delete require.cache[require.resolve(path.join(__dirname, "../jobs/core.js"))];
delete require.cache[require.resolve(path.join(__dirname, "../dom/routes.js"))];
delete globalThis.OWEH;

let hashEvents = 0;
globalThis.location = { hash: "#!/?src=pets&sub=hatchery" };
globalThis.HashChangeEvent = class { constructor(type) { this.type = type; } };
globalThis.window = { dispatchEvent(event) { if (event.type === "hashchange") hashEvents += 1; } };

require("../jobs/core.js");
require("../dom/routes.js");
const routes = globalThis.OWEH.dom.routes;

assert.equal(routes.isHatchery(), true);
assert.equal(routes.isOwnHatchery(), true);
assert.equal(routes.isFriendHatchery(), false);
assert.equal(routes.isFriendHatchery("#!/?src=pets&sub=hatchery&usr=123"), true);
assert.equal(routes.currentFriendId("#!/?src=pets&sub=hatchery&usr=123"), "123");
assert.equal(routes.currentPetId("#!/?src=pets&sub=profile&pet=456"), "456");
assert.equal(routes.isPetsOverview("#!/?src=pets&sub=overview"), true);
assert.equal(routes.isOviPetsChatPage("#!/OviPets"), true);
assert.equal(routes.classifyRoute("#!/?src=pets&sub=hatchery&usr=123").kind, "friend-hatchery");
assert.equal(routes.classifyRoute("#!/?src=pets&sub=profile&pet=456").petProfile, true);
assert.equal(routes.classifyRoute("#!/?src=pets&sub=overview").petsOverview, true);
assert.equal(routes.normalizeHash("?src=pets&sub=overview"), "#!/?src=pets&sub=overview");
assert.equal(routes.petProfilePath("456"), "?src=pets&sub=profile&pet=456");
assert.equal(routes.petProfilePath("456", "77"), "?src=pets&sub=profile&usr=77&pet=456");

const fakeLink = {
  getAttribute(name) { return name === "href" ? "#!/?usr=789" : null; },
  querySelector() { return null; }
};
assert.equal(routes.userIdFromLink(fakeLink), "789");

routes.navigateTo("?src=pets&sub=overview");
assert.equal(location.hash, "#!/?src=pets&sub=overview");
routes.navigateTo("#!/?src=pets&sub=overview");
assert.equal(hashEvents, 1, "navigating to the current hash must still trigger route refresh");

console.log("route adapter behavior tests passed");

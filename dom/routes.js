"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before dom/routes.js");

  const PET_PROFILE = /[?&]pet=(\d+)/;

  function currentPetId(hash = location.hash) {
    return String(hash || "").match(PET_PROFILE)?.[1] || null;
  }

  function currentFriendId(hash = location.hash) {
    return String(hash || "").match(/[?&]usr=(\d+)/)?.[1] || null;
  }

  function isFriendHatchery(hash = location.hash) {
    return /src=pets&sub=hatchery&usr=\d+/.test(String(hash || ""));
  }

  function isHatchery(hash = location.hash) {
    return /src=pets&sub=hatchery/.test(String(hash || ""));
  }

  function isOwnHatchery(hash = location.hash) {
    return isHatchery(hash) && !/[?&]usr=\d+/.test(String(hash || ""));
  }

  function isOviPetsChatPage(hash = location.hash) {
    return /^#!\/?OviPets$/i.test(String(hash || ""));
  }

  function isPetsOverview(hash = location.hash) {
    return /src=pets&sub=overview/.test(String(hash || ""));
  }

  function classifyRoute(hash = location.hash) {
    const value = String(hash || "");
    const friendHatchery = isFriendHatchery(value);
    const hatchery = isHatchery(value);
    const petProfile = Boolean(currentPetId(value));
    const petsOverview = isPetsOverview(value);
    const chat = isOviPetsChatPage(value);
    return Object.freeze({
      hash: value,
      friendHatchery,
      ownHatchery: hatchery && !friendHatchery,
      hatchery,
      petProfile,
      petsOverview,
      chat,
      kind: friendHatchery ? "friend-hatchery"
        : (hatchery ? "hatchery" : (petProfile ? "pet-profile" : (petsOverview ? "pets-overview" : (chat ? "chat" : "other"))))
    });
  }

  function userIdFromLink(link) {
    const href = link?.getAttribute?.("href") || "";
    const src = link?.querySelector?.("img")?.getAttribute?.("src") || "";
    return href.match(/[?&]usr=(\d+)/)?.[1] || src.match(/\/user\/(\d+)/)?.[1] || null;
  }

  function normalizeHash(path) {
    return String(path || "").startsWith("#!")
      ? String(path)
      : `#!/${String(path || "").replace(/^#?!?\/?/, "")}`;
  }

  function petProfilePath(petId, userId = null) {
    return userId
      ? `?src=pets&sub=profile&usr=${userId}&pet=${petId}`
      : `?src=pets&sub=profile&pet=${petId}`;
  }

  function navigateTo(path) {
    const hash = normalizeHash(path);
    if (location.hash === hash) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
      location.hash = hash;
    }
  }

  OWEH.dom = OWEH.dom || {};
  OWEH.dom.routes = Object.freeze({
    PET_PROFILE,
    currentPetId,
    currentFriendId,
    isFriendHatchery,
    isHatchery,
    isOwnHatchery,
    isOviPetsChatPage,
    isPetsOverview,
    classifyRoute,
    userIdFromLink,
    normalizeHash,
    petProfilePath,
    navigateTo
  });
})();

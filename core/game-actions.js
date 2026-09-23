"use strict";

// Small adapter for direct game mutations used by both content.js feature state machines and
// one-button jobs. It deliberately contains no automation policy: callers decide *when* an
// action is appropriate; this module only validates IDs, sends the confirmed OviPets UI
// dispatcher command, and (for enclosure moves) verifies the visible Overview as a fallback.
(() => {
  if (!globalThis.OWEH?.core?.storage || !OWEH.core?.gameBridge) {
    throw new Error("core/storage-client.js and core/game-bridge.js must load before core/game-actions.js");
  }
  if (!OWEH.dom?.overview || !OWEH.domain?.breedingPlan) {
    throw new Error("dom/overview.js and domain/breeding-plan.js must load before core/game-actions.js");
  }

  const { storageGet } = OWEH.core.storage;
  const { sendGameCommand, sendOwnHatchCommand } = OWEH.core.gameBridge;
  const { overviewEnclosureForPet } = OWEH.dom.overview;
  const { normalizeEnclosureLabel } = OWEH.domain.breedingPlan;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function fastMovePetToEnclosure(petId, target) {
    const ids = await storageGet("owehEnclosureIds", {});
    const directId = Object.entries(ids).find(([label]) =>
      normalizeEnclosureLabel(label) === normalizeEnclosureLabel(target))?.[1];
    if (directId === undefined) return { moved: false, reason: `missing-enclosure-id:${target}` };
    // Confirmed live 2026-09-18: Enclosure's onchange calls
    // ui_action_cmdExec('pets_enclosure', `PetID=${id}`, form) where the selected field
    // is select[name="Enclosure"]. This is the same visible-UI action, without reopening
    // Edit for every cached pet.
    const direct = await sendGameCommand("pets_enclosure", petId, { Enclosure: directId }, 10000);
    if (direct.ok) return { moved: true, fast: true };
    // The stock onchange supplies a null callback, so older game builds may complete the
    // move without invoking ours. When all Overview panels were loaded by the catalog
    // scan, verify the resulting panel before declaring failure.
    await sleep(500);
    const observed = overviewEnclosureForPet(petId);
    if (observed && normalizeEnclosureLabel(observed) === normalizeEnclosureLabel(target)) {
      return { moved: true, fast: true, verifiedByOverview: true };
    }
    return { moved: false, reason: direct.reason || "direct-command-failed" };
  }

  async function feedPet(petId) {
    if (!/^\d+$/.test(String(petId))) return { ok: false, reason: "invalid-pet" };
    // Confirmed live 2026-09-19 on a hungry owned pet. This is the free per-pet Feed
    // action, not pets_massfeed (which spends Credits).
    return sendGameCommand("pet_feed", petId, {}, 3000, true);
  }

  async function hatchOwnEgg(petId) {
    if (!/^\d+$/.test(String(petId))) return { ok: false, reason: "invalid-pet" };
    // Confirmed from the live Hatch Egg button: ui_action_cmdExec('pet_turn_egg',
    // `PetID=${id}`, ...). Unlike Turn Egg, hatching has no Name-the-Species step. The
    // bridge still refuses this command unless the exact PetID currently has a visible
    // Hatch Egg icon in the user's own Hatchery.
    return sendOwnHatchCommand(petId, 3000);
  }

  async function requestFriend(userId) {
    if (!/^\d+$/.test(String(userId))) return { ok: false, reason: "invalid-user" };
    return sendGameCommand("friend_request", userId, {}, 3000, true);
  }

  async function removeFriendDirect(userId) {
    if (!/^\d+$/.test(String(userId))) return { ok: false, reason: "invalid-user" };
    return sendGameCommand("friend_remove", userId, {}, 15000);
  }

  async function breedPairDirect(motherId, fatherId, campaignId = "manual") {
    if (!/^\d+$/.test(String(motherId)) || !/^\d+$/.test(String(fatherId))) {
      return { ok: false, reason: "invalid-breeding-pair" };
    }
    return sendGameCommand(
      "pet_breed", motherId, { MotherID: motherId, FatherID: fatherId }, 20000, false,
      `breed:${campaignId}:${motherId}:${fatherId}`
    );
  }

  OWEH.core.gameActions = Object.freeze({
    fastMovePetToEnclosure,
    feedPet,
    hatchOwnEgg,
    requestFriend,
    removeFriendDirect,
    breedPairDirect
  });
})();

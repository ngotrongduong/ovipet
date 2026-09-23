"use strict";

// Runs inside one extension-owned egg profile tab. Turn Egg is UI-only: this module clicks
// the actual visible Turn Egg button, waits for Name the Species if it appears, lets the
// species module answer/confirm it, and reports success only after the Turn Egg button is gone.
// Tabs not registered by bg/egg-tabs.js receive no assignment and do nothing.
OWEH.register("egg-turn-tab", helpers => {
  const { waitForGameReady, runtimeRequest, sleep, setStatus, routes, profileDom } = helpers;
  const TURN_ATTEMPT_MS = 150000;
  const BUTTON_WAIT_MS = 10000;
  const POST_CLICK_SETTLE_MS = 250;
  const MAX_GENERIC_FAILURES = 3;
  const MAX_SPECIES_REJECTIONS = 6;

  async function assignment() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await runtimeRequest({ type: "eggTabAssignment" });
      if (response.ok) return response;
      if (response.reason === "not-owned" && attempt >= 2) return null;
      await sleep(250);
    }
    return null;
  }

  async function waitUntil(condition, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (condition()) return true;
      await sleep(100);
    }
    return condition();
  }

  async function clickTurnOnce(eggId) {
    const species = OWEH.get("species-answer")?.api;
    const button = profileDom.getProfileTurnButton();
    if (!button) return { ok: true, already: true, reason: "no-turn-button" };

    button.click();
    setStatus(`Egg ${eggId}: clicked the real Turn Egg button`);
    await sleep(POST_CLICK_SETTLE_MS);

    const deadline = Date.now() + TURN_ATTEMPT_MS;
    while (Date.now() < deadline) {
      const rejection = await species?.checkRejected?.();
      if (rejection) {
        return {
          ok: false,
          terminal: rejection === true || rejection?.terminal === true,
          reason: rejection?.reason || "species-rejected"
        };
      }
      if (species?.dialogOpen()) {
        await species.monitor();
        setStatus(`Egg ${eggId}: resolving Name the Species before this tab may close`);
        await sleep(100);
        continue;
      }

      if (!profileDom.getProfileTurnButton()) {
        await species?.settleTurnResult({ ok: true, reason: "ui-confirmed" });
        return { ok: true, reason: "ui-confirmed" };
      }
      await sleep(100);
    }

    await species?.settleTurnResult({ ok: false, reason: "ui-turn-timeout" });
    return { ok: false, reason: "ui-turn-timeout" };
  }

  function report(eggId, state, reason) {
    setStatus(`Egg ${eggId}: ${state}${reason ? ` (${reason})` : ""}`);
    return runtimeRequest({ type: "eggTabResult", eggId, state, reason });
  }

  async function run(eggId) {
    setStatus(`Egg ${eggId}: waiting for OviPets to finish loading`);
    if (!(await waitForGameReady())) return report(eggId, "failed", "game-not-ready");
    if (routes.currentPetId() !== eggId) return report(eggId, "failed", "wrong-page");

    const hasButton = await waitUntil(() => Boolean(profileDom.getProfileTurnButton()), BUTTON_WAIT_MS);
    if (!hasButton) return report(eggId, "already", "no-turn-button");

    let lastReason = "unknown";
    let genericFailures = 0;
    let speciesRejects = 0;
    let attempt = 0;
    while (genericFailures < MAX_GENERIC_FAILURES && speciesRejects < MAX_SPECIES_REJECTIONS) {
      attempt += 1;
      setStatus(`Egg ${eggId}: UI turn attempt ${attempt}`);
      const result = await clickTurnOnce(eggId);
      if (result.ok) {
        if (result.already) return report(eggId, "already", result.reason || "no-turn-button");
        return report(eggId, "turned", result.reason || "ui-confirmed");
      }
      lastReason = result.reason || "ui-turn-failed";
      if (result.terminal) return report(eggId, "exhausted", lastReason);
      if (lastReason === "species-incorrect") {
        speciesRejects += 1;
      } else if (lastReason === "species-error-stuck") {
        // The Error overlay itself is blocking the real UI. Inspector/network evidence is already
        // saved; close this owned tab and let a later sweep pass retry the egg rather than leave
        // a permanent leftover tab that can stop the whole sweep.
        return report(eggId, "abandoned", lastReason);
      } else {
        genericFailures += 1;
      }
      await sleep(lastReason === "species-incorrect" ? 400 : 750);
    }
    if (speciesRejects >= MAX_SPECIES_REJECTIONS) {
      return report(eggId, "exhausted", "species-answer-space-exhausted");
    }
    return report(eggId, "abandoned", lastReason);
  }

  async function start() {
    if (!/[?&]pet=\d+/.test(location.hash)) return;
    const owned = await assignment();
    if (!owned) return;
    try {
      await run(String(owned.eggId));
    } catch (error) {
      console.error("[OviPets Helper] egg tab failed", error);
      await report(String(owned.eggId), "failed", `error: ${error?.message || error}`);
    }
  }

  setTimeout(() => { start(); }, 0);

  return { api: { run, clickTurnOnce } };
});

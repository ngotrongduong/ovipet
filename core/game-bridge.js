"use strict";

(() => {
  if (!globalThis.OWEH?.core?.storage) {
    throw new Error("core/storage-client.js must load before core/game-bridge.js");
  }

  const { runtimeRequest } = OWEH.core.storage;
  const GAME_COMMAND_EVENT = "oweh:game-command";
  const GAME_COMMAND_RESULT_EVENT = "oweh:game-command-result";
  const GAME_PING_EVENT = "oweh:game-ping";
  let sequence = 0;

  function isOwnHatcheryPage() {
    const hash = String(location?.hash || "");
    return /src=pets&sub=hatchery/.test(hash) && !/[?&]usr=\d+/.test(hash);
  }

  async function dispatchGameCommand(command, targetId, fields, timeout, fireAndForget, journalId, purpose = "") {
    if (journalId) {
      const begun = await runtimeRequest({
        type: "commandJournalBegin",
        entry: { id: journalId, command, targetId: String(targetId), fields, sourceUrl: location.href }
      });
      if (!begun.ok) {
        return {
          ok: false,
          reason: begun.duplicate ? "duplicate-command-blocked" : (begun.error || "journal-failed"),
          duplicate: Boolean(begun.duplicate)
        };
      }
      // Persist the no-return boundary before crossing into page code. If this isolated
      // world is destroyed immediately after dispatch, a reload will reconcile instead
      // of blindly sending the same mutation again.
      await runtimeRequest({
        type: "commandJournalUpdate",
        id: journalId,
        patch: { status: "dispatched", dispatchedAt: Date.now() }
      });
    }

    const result = await new Promise(resolve => {
      const requestId = `${Date.now()}-${++sequence}`;
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener(GAME_COMMAND_RESULT_EVENT, onResult);
        resolve(value);
      };
      const onResult = event => {
        try {
          const value = JSON.parse(String(event.detail || "{}"));
          if (value.requestId === requestId) finish(value);
        } catch {
          // Ignore malformed page events; the timeout remains the safe fallback.
        }
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "bridge-timeout" }), timeout);
      document.addEventListener(GAME_COMMAND_RESULT_EVENT, onResult);
      document.dispatchEvent(new CustomEvent(GAME_COMMAND_EVENT, {
        detail: JSON.stringify({ requestId, command, targetId: String(targetId), fields, fireAndForget, purpose })
      }));
    });

    if (journalId) {
      await runtimeRequest({
        type: "commandJournalUpdate",
        id: journalId,
        patch: {
          status: result.ok ? "callback-confirmed" : (result.reason === "bridge-timeout" ? "dispatched" : "rejected"),
          result
        }
      });
    }
    return result;
  }

  async function sendGameCommand(command, targetId, fields = {}, timeout = 17000, fireAndForget = false, journalId = null) {
    // Turn Egg remains UI-only. A real profile tab must click the visible Turn Egg button so
    // Name the Species can be observed and completed before the tab closes. The only direct
    // pet_turn_egg path is sendOwnHatchCommand(), which is separately scoped to a visible
    // Hatch Egg icon in the user's own Hatchery by the MAIN-world page bridge.
    if (command === "pet_turn_egg") return { ok: false, reason: "ui-only-command" };
    return dispatchGameCommand(command, targetId, fields, timeout, fireAndForget, journalId);
  }

  async function sendOwnHatchCommand(petId, timeout = 3000) {
    if (!/^\d+$/.test(String(petId))) return { ok: false, reason: "invalid-pet" };
    if (!isOwnHatcheryPage()) return { ok: false, reason: "own-hatchery-required" };
    return dispatchGameCommand("pet_turn_egg", petId, {}, timeout, true, null, "own-hatch");
  }

  // Asks the page-side bridge whether the game's dispatcher exists yet. Never sends a game command.
  function pingGameBridge(timeout = 1500) {
    return new Promise(resolve => {
      const requestId = `ping-${Date.now()}-${++sequence}`;
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener(GAME_COMMAND_RESULT_EVENT, onResult);
        resolve(value);
      };
      const onResult = event => {
        try {
          const value = JSON.parse(String(event.detail || "{}"));
          if (value.requestId === requestId) finish(value);
        } catch {
          // Ignore malformed page events; the timeout remains the safe fallback.
        }
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "bridge-timeout" }), timeout);
      document.addEventListener(GAME_COMMAND_RESULT_EVENT, onResult);
      document.dispatchEvent(new CustomEvent(GAME_PING_EVENT, { detail: JSON.stringify({ requestId }) }));
    });
  }

  OWEH.core.gameBridge = Object.freeze({
    GAME_COMMAND_EVENT,
    GAME_COMMAND_RESULT_EVENT,
    GAME_PING_EVENT,
    sendGameCommand,
    sendOwnHatchCommand,
    pingGameBridge
  });
})();

(() => {
  "use strict";

  const REQUEST_EVENT = "oweh:game-command";
  const RESULT_EVENT = "oweh:game-command-result";
  const PING_EVENT = "oweh:game-ping";
  const DISCARD_TRACE_EVENT = "oweh:discard-action-observed";
  const ALLOWED = new Set([
    // pet_name names an Unnamed newborn (its profile has a Name button, not Rename).
    "pets_enclosure", "pet_rename", "pet_name", "pet_feed",
    "friend_request", "friend_remove", "pet_breed", "pet_turn_egg"
  ]);

  function isOwnHatcheryRoute() {
    const hash = String(window.location?.hash || document.location?.hash || "");
    return /src=pets&sub=hatchery/.test(hash) && !/[?&]usr=\d+/.test(hash);
  }

  function isVisibleOwnHatchTarget(targetId) {
    if (!isOwnHatcheryRoute()) return false;
    for (const icon of document.querySelectorAll?.('img[title="Hatch Egg"]') || []) {
      const card = icon.closest?.("li") || icon.parentElement?.parentElement;
      const href = card?.querySelector?.('a.pet[href*="pet="]')?.getAttribute?.("href") || "";
      if (href.match(/[?&]pet=(\d+)/)?.[1] === String(targetId)) return true;
    }
    return false;
  }

  function visibleUnableToBreedDialog() {
    const dialogs = [...(document.querySelectorAll?.('[role="dialog"], .ui-dialog') || [])];
    return dialogs.find(dialog => {
      const text = String(dialog?.textContent || "").replace(/\s+/g, " ").trim();
      const visible = dialog?.offsetParent !== null || dialog?.getClientRects?.().length > 0;
      return visible && /Unable to breed pets\.?/i.test(text);
    }) || null;
  }

  function dismissUnableToBreedDialog(dialog) {
    const buttons = [...(dialog?.querySelectorAll?.("button") || [])];
    const ok = buttons.find(button => /^OK$/i.test(String(button?.textContent || "").trim()));
    try { ok?.click?.(); } catch {}
  }

  let verifiedDiscardSignature = null;
  let discardArm = null;

  function currentProfilePetId() {
    const hash = String(window.location?.hash || document.location?.hash || "");
    return hash.match(/[?&]pet=(\d+)/)?.[1] || null;
  }

  function armDiscardFromClick(event) {
    const target = event?.target?.closest?.("button, a, input, label, [role=button]");
    if (!target) return;
    const text = String(target.textContent || target.value || target.title || "")
      .replace(/\s+/g, " ").trim();
    if (!/^Discard$/i.test(text)) return;
    const sourceId = currentProfilePetId();
    if (!/^\d+$/.test(String(sourceId || ""))) return;
    discardArm = { sourceId: String(sourceId), until: Date.now() + 15000 };
  }

  document.addEventListener("click", armDiscardFromClick, true);

  function visibleOwnHatcheryPet(targetId) {
    if (!isOwnHatcheryRoute()) return false;
    for (const anchor of document.querySelectorAll?.('main a.pet[href*="pet="]') || []) {
      const href = anchor.getAttribute?.("href") || "";
      if (href.match(/[?&]pet=(\d+)/)?.[1] === String(targetId)) return true;
    }
    return false;
  }

  function formSnapshot(form) {
    const fields = {};
    for (const control of form?.querySelectorAll?.("input[name], select[name], textarea[name]") || []) {
      if (control.disabled) continue;
      const name = String(control.name || "");
      if (!name || name === "PetID") continue;
      if ((control.type === "checkbox" || control.type === "radio") && !control.checked) continue;
      fields[name] = String(control.value ?? "");
    }
    return fields;
  }

  function looksLikeDiscard(command, params, form, fields) {
    const haystack = [
      command,
      params,
      form?.textContent || "",
      form?.getAttribute?.("action") || "",
      ...Object.keys(fields || {}),
      ...Object.values(fields || {})
    ].join(" ");
    return /\bdiscard(?:ed|ing)?\b/i.test(haystack);
  }

  function replaceTargetId(value, sourceId, targetId) {
    let text = String(value ?? "");
    if (sourceId) text = text.replace(new RegExp("(PetID|EggID)=" + sourceId + "\\b", "g"), "$1=" + targetId);
    return text.replace(/(PetID|EggID)=\d+\b/g, "$1=" + targetId);
  }

  function installDiscardObserver() {
    const current = window.ui_action_cmdExec;
    if (typeof current !== "function" || current.__owehDiscardObserved) return Boolean(current?.__owehDiscardObserved);
    const wrapped = function(command, params, form, callback) {
      try {
        const fields = formSnapshot(form);
        const commandSourceId = String(params || "").match(/(?:PetID|EggID)=(\d+)/)?.[1] || "";
        const armed = discardArm && Date.now() <= discardArm.until
          && commandSourceId === discardArm.sourceId;
        if ((armed || looksLikeDiscard(command, params, form, fields)) && /^\d+$/.test(commandSourceId)) {
          verifiedDiscardSignature = {
            command: String(command || ""),
            params: String(params || ""),
            fields,
            sourceId: commandSourceId,
            evidence: armed ? "discard-ui-click" : "discard-ui",
            observedAt: Date.now()
          };
          discardArm = null;
          document.dispatchEvent(new CustomEvent(DISCARD_TRACE_EVENT, {
            detail: JSON.stringify(verifiedDiscardSignature)
          }));
        }
      } catch {}
      return current.apply(this, arguments);
    };
    try { Object.defineProperty(wrapped, "__owehDiscardObserved", { value: true }); } catch {}
    window.ui_action_cmdExec = wrapped;
    return true;
  }

  // The bridge loads at document_start, usually before OviPets defines ui_action_cmdExec.
  // Install a transparent observer as soon as the dispatcher appears. It never sends a command;
  // it only records the exact command/fields when the user manually chooses Discard once.
  const discardObserverTimer = setInterval(() => {
    if (installDiscardObserver()) clearInterval(discardObserverTimer);
  }, 250);
  setTimeout(() => clearInterval(discardObserverTimer), 30000);

  function reply(requestId, ok, reason = "") {
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
      detail: JSON.stringify({ requestId, ok, reason })
    }));
  }

  // Readiness probe only: reports whether the game's own dispatcher function exists yet.
  // It executes nothing and takes no parameters, so it is not a way to run arbitrary code
  // or commands — jobs use it to wait until OviPets has finished loading before they
  // read the page or send anything (sending too early corrupts data collection).
  document.addEventListener(PING_EVENT, event => {
    let requestId = "";
    try {
      requestId = String(JSON.parse(String(event.detail || "{}")).requestId || "");
    } catch {
      return;
    }
    installDiscardObserver();
    const ready = typeof window.ui_action_cmdExec === "function";
    reply(requestId, ready, ready ? "" : "dispatcher-unavailable");
  });

  document.addEventListener(REQUEST_EVENT, event => {
    let request;
    try {
      request = JSON.parse(String(event.detail || "{}"));
    } catch {
      return;
    }
    const requestId = String(request.requestId || "");
    const command = String(request.command || "");
    const targetId = String(request.targetId ?? request.petId ?? "");
    const purpose = String(request.purpose || "");
    installDiscardObserver();
    const ownHatchCommand = command === "pet_turn_egg"
      && purpose === "own-hatch"
      && isVisibleOwnHatchTarget(targetId);
    const verifiedDiscardCommand = command === "__verified_discard__"
      && purpose === "verified-discard"
      && verifiedDiscardSignature
      && visibleOwnHatcheryPet(targetId);
    const fireAndForget = request.fireAndForget === true
      && (command === "pet_feed" || command === "friend_request" || ownHatchCommand || verifiedDiscardCommand);
    if (!requestId || (!ALLOWED.has(command) && !verifiedDiscardCommand) || !/^\d+$/.test(targetId)
      || (command === "pet_turn_egg" && !ownHatchCommand)) {
      const discardProxy = command === "__verified_discard__" && purpose === "verified-discard";
      return reply(requestId, false, discardProxy ? "discard-signature-missing-or-target-not-visible" : "invalid-command");
    }
    if (typeof window.ui_action_cmdExec !== "function") {
      return reply(requestId, false, "dispatcher-unavailable");
    }

    const form = document.createElement("form");
    // Mark temporary bridge DOM so the isolated-world MutationObserver can ignore the
    // append/remove churn generated by our own command transport.
    form.dataset.owehBridgeOwned = "1";
    form.method = "post";
    form.action = "/index.php";
    form.hidden = true;
    const fields = request.fields && typeof request.fields === "object" ? request.fields : {};
    for (const [name, value] of Object.entries(fields)) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue;
      const input = document.createElement("input");
      input.name = name;
      input.value = String(value ?? "");
      form.appendChild(input);
    }
    document.body.appendChild(form);

    let finished = false;
    let breedErrorObserver = null;
    const finish = (ok, reason = "") => {
      if (finished) return;
      finished = true;
      try { breedErrorObserver?.disconnect?.(); } catch {}
      form.remove();
      reply(requestId, ok, reason);
    };
    const timer = setTimeout(() => finish(false, "command-timeout"), 15000);
    const detectBreedRejection = () => {
      if (finished || command !== "pet_breed") return false;
      const dialog = visibleUnableToBreedDialog();
      if (!dialog) return false;
      clearTimeout(timer);
      dismissUnableToBreedDialog(dialog);
      finish(false, "unable-to-breed-pets");
      return true;
    };
    if (command === "pet_breed" && typeof MutationObserver === "function") {
      breedErrorObserver = new MutationObserver(() => detectBreedRejection());
      try { breedErrorObserver.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch {}
    }
    try {
      let params;
      let dispatchCommand = command;
      if (verifiedDiscardCommand) {
        const signature = verifiedDiscardSignature;
        dispatchCommand = signature.command;
        params = replaceTargetId(signature.params, signature.sourceId, targetId);
        for (const [name, value] of Object.entries(signature.fields || {})) {
          const input = document.createElement("input");
          input.name = name;
          input.value = replaceTargetId(value, signature.sourceId, targetId);
          form.appendChild(input);
        }
      } else if (command === "friend_request" || command === "friend_remove") {
        params = `UserID=${targetId}`;
      } else if (command === "pet_breed") {
        const motherId = String(fields.MotherID || "");
        const fatherId = String(fields.FatherID || "");
        if (!/^\d+$/.test(motherId) || !/^\d+$/.test(fatherId)) {
          clearTimeout(timer);
          return finish(false, "invalid-breeding-pair");
        }
        params = `MotherID=${motherId}&FatherID=${fatherId}`;
      } else {
        params = `PetID=${targetId}`;
      }
      if (fireAndForget) {
        // Feed, friend-request and own-Hatchery hatch queues only need confirmation that
        // the game's own UI dispatcher accepted the command. Keep the form alive briefly because the
        // dispatcher may serialize it asynchronously, but do not wait for its server
        // callback before releasing the 100 ms queue lane.
        window.ui_action_cmdExec(dispatchCommand, params, form, () => {});
        clearTimeout(timer);
        finished = true;
        reply(requestId, true, "dispatched");
        const cleanupTimer = setTimeout(() => form.remove(), 5000);
        cleanupTimer?.unref?.();
        return;
      }
      window.ui_action_cmdExec(dispatchCommand, params, form, () => {
        clearTimeout(timer);
        finish(true);
      });
      // Some OviPets validation failures render a modal but never invoke the dispatcher
      // callback. Check once synchronously as well as through MutationObserver so those
      // failures are reported immediately instead of being mislabeled as a 15s timeout.
      detectBreedRejection();
    } catch (error) {
      clearTimeout(timer);
      finish(false, error?.message || "command-failed");
    }
  });
})();

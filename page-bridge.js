(() => {
  "use strict";

  const REQUEST_EVENT = "oweh:game-command";
  const RESULT_EVENT = "oweh:game-command-result";
  const PING_EVENT = "oweh:game-ping";
  const ALLOWED = new Set([
    "pets_enclosure", "pet_rename", "pet_feed",
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

  const SPECIES_TRACE_CONTROL_EVENT = "oweh:species-trace-control";
  const SPECIES_TRACE_NETWORK_EVENT = "oweh:species-trace-network";
  const SPECIES_SOURCE_REQUEST_EVENT = "oweh:species-source-request";
  const SPECIES_SOURCE_RESULT_EVENT = "oweh:species-source-result";
  const speciesTrace = { active: false, sessionId: "", eggId: "", until: 0 };
  const SPECIES_WORDS = /name\s+the\s+species|species|turn\s*egg|pet_turn_egg|incorrect|verify|verification|captcha|quiz/i;

  function traceEnabled() {
    if (!speciesTrace.active) return false;
    if (speciesTrace.until && Date.now() > speciesTrace.until) {
      speciesTrace.active = false;
      return false;
    }
    return true;
  }

  function traceReply(detail) {
    if (!traceEnabled()) return;
    try {
      document.dispatchEvent(new CustomEvent(SPECIES_TRACE_NETWORK_EVENT, {
        detail: JSON.stringify({
          sessionId: speciesTrace.sessionId,
          eggId: speciesTrace.eggId,
          at: Date.now(),
          ...detail
        })
      }));
    } catch {}
  }

  function pageBaseUrl() {
    return window.location?.href || document.location?.href || "https://ovipets.com/";
  }

  function sameOriginUrl(value) {
    try {
      const url = new URL(String(value || ""), pageBaseUrl());
      const base = new URL(pageBaseUrl());
      return url.origin === base.origin ? url : null;
    } catch {
      return null;
    }
  }

  function safeUrl(value) {
    const url = sameOriginUrl(value);
    if (!url) return null;
    const params = new URLSearchParams();
    for (const [key, val] of url.searchParams.entries()) {
      params.set(key, /pet|egg|species|answer|option|cmd|action|id/i.test(key) ? String(val).slice(0, 200) : "[redacted]");
    }
    return `${url.origin}${url.pathname}${params.size ? `?${params}` : ""}`;
  }

  function safeBody(body) {
    if (body == null) return null;
    try {
      if (typeof body === "string") {
        const params = new URLSearchParams(body);
        if ([...params.keys()].length) {
          const output = {};
          for (const [key, value] of params.entries()) {
            output[key] = /pet|egg|species|answer|option|cmd|action|id/i.test(key) ? String(value).slice(0, 300) : "[redacted]";
          }
          return output;
        }
        return SPECIES_WORDS.test(body) ? body.slice(0, 2000) : "[non-species request body omitted]";
      }
      if (typeof FormData !== "undefined" && body instanceof FormData) {
        const output = {};
        for (const [key, value] of body.entries()) {
          output[key] = /pet|egg|species|answer|option|cmd|action|id/i.test(key) ? String(value).slice(0, 300) : "[redacted]";
        }
        return output;
      }
    } catch {}
    return `[${Object.prototype.toString.call(body)}]`;
  }

  function relevantResponseSnippet(text) {
    const value = String(text || "");
    const match = value.match(SPECIES_WORDS);
    if (!match || match.index == null) return "[non-species response omitted]";
    const start = Math.max(0, match.index - 1200);
    return value.slice(start, start + 3500);
  }

  document.addEventListener(SPECIES_TRACE_CONTROL_EVENT, event => {
    let detail;
    try { detail = JSON.parse(String(event.detail || "{}")); } catch { return; }
    speciesTrace.active = detail.active === true;
    speciesTrace.sessionId = String(detail.sessionId || "");
    speciesTrace.eggId = String(detail.eggId || "");
    speciesTrace.until = speciesTrace.active ? Date.now() + 180000 : 0;
  });

  document.addEventListener(SPECIES_SOURCE_REQUEST_EVENT, event => {
    let detail;
    try { detail = JSON.parse(String(event.detail || "{}")); } catch { return; }
    const sessionId = String(detail.sessionId || "");
    if (!sessionId) return;
    const hints = [];
    const names = new Set(["ui_action_cmdExec"]);
    try {
      for (const name of Object.getOwnPropertyNames(window)) {
        if (/species|egg|turn|verify|verification|captcha|quiz|dialog/i.test(name)) names.add(name);
      }
    } catch {}
    for (const name of [...names].slice(0, 40)) {
      try {
        const value = window[name];
        if (typeof value === "function") {
          hints.push({ name, type: "function", source: Function.prototype.toString.call(value).slice(0, 5000) });
        } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          hints.push({ name, type: typeof value, value: String(value).slice(0, 1000) });
        }
      } catch {}
      if (hints.length >= 24) break;
    }
    const scriptSources = [...(document.scripts || [])].map(script => String(script.src || "")).filter(Boolean).slice(0, 100);
    const pageRuntime = {
      jquery: window.jQuery?.fn?.jquery || null,
      dispatcherPresent: typeof window.ui_action_cmdExec === "function"
    };
    try {
      document.dispatchEvent(new CustomEvent(SPECIES_SOURCE_RESULT_EVENT, {
        detail: JSON.stringify({ sessionId, hints, scriptSources, pageRuntime })
      }));
    } catch {}
  });

  // Passive same-origin network recorder. It is dormant unless the isolated-world Species
  // Inspector explicitly opens a short trace window around Turn Egg / Name the Species.
  if (typeof window.XMLHttpRequest === "function") {
    const XHR = window.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const meta = new WeakMap();
    XHR.prototype.open = function(method, url, ...rest) {
      meta.set(this, { method: String(method || "GET").toUpperCase(), url: String(url || "") });
      return originalOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function(body) {
      const activeAtSend = traceEnabled();
      const info = meta.get(this) || { method: "GET", url: "" };
      const url = activeAtSend ? safeUrl(info.url) : null;
      const sessionId = speciesTrace.sessionId;
      const eggId = speciesTrace.eggId;
      if (activeAtSend && url) {
        this.addEventListener("loadend", () => {
          if (!sessionId) return;
          let responseText = "";
          try {
            if (!this.responseType || this.responseType === "text") responseText = String(this.responseText || "");
          } catch {}
          try {
            document.dispatchEvent(new CustomEvent(SPECIES_TRACE_NETWORK_EVENT, {
              detail: JSON.stringify({
                sessionId, eggId, at: Date.now(), kind: "xhr", method: info.method, url,
                request: safeBody(body), status: Number(this.status || 0),
                response: relevantResponseSnippet(responseText)
              })
            }));
          } catch {}
        }, { once: true });
      }
      return originalSend.call(this, body);
    };
  }

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      const activeAtSend = traceEnabled();
      const rawUrl = typeof input === "string" ? input : input?.url;
      const url = activeAtSend ? safeUrl(rawUrl) : null;
      const method = String(init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
      const body = init?.body || null;
      const sessionId = speciesTrace.sessionId;
      const eggId = speciesTrace.eggId;
      const promise = originalFetch.apply(this, arguments);
      if (activeAtSend && url && sessionId) {
        promise.then(response => {
          response.clone().text().then(text => {
            try {
              document.dispatchEvent(new CustomEvent(SPECIES_TRACE_NETWORK_EVENT, {
                detail: JSON.stringify({
                  sessionId, eggId, at: Date.now(), kind: "fetch", method, url,
                  request: safeBody(body), status: Number(response.status || 0),
                  response: relevantResponseSnippet(text)
                })
              }));
            } catch {}
          }).catch(() => {});
        }).catch(() => {});
      }
      return promise;
    };
  }

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
    const ownHatchCommand = command === "pet_turn_egg"
      && purpose === "own-hatch"
      && isVisibleOwnHatchTarget(targetId);
    const fireAndForget = request.fireAndForget === true
      && (command === "pet_feed" || command === "friend_request" || ownHatchCommand);
    if (!requestId || !ALLOWED.has(command) || !/^\d+$/.test(targetId)
      || (command === "pet_turn_egg" && !ownHatchCommand)) {
      return reply(requestId, false, "invalid-command");
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
      if (command === "friend_request" || command === "friend_remove") {
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
        window.ui_action_cmdExec(command, params, form, () => {});
        clearTimeout(timer);
        finished = true;
        reply(requestId, true, "dispatched");
        const cleanupTimer = setTimeout(() => form.remove(), 5000);
        cleanupTimer?.unref?.();
        return;
      }
      window.ui_action_cmdExec(command, params, form, () => {
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

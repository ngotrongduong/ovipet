"use strict";

(() => {
  const PANEL_ID = "oweh-lite-panel";
  const TURN_SELECTOR = 'button[onclick*="pet_turn_egg"]';
  const VERIFY_ATTEMPTS = 2;
  let workerBusy = false;
  let workerTimer = null;

  function request(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(response || { ok: false, error: "no-response" });
        });
      } catch (error) {
        resolve({ ok: false, error: error?.message || String(error) });
      }
    });
  }

  async function sleep(ms) {
    const delay = Math.max(0, Number(ms) || 0);
    if (document.hidden && delay >= 75) {
      const result = await request({ type: "liteDelay", ms: delay });
      if (result?.ok) return;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <strong>Friend Sweep Lite</strong>
      <div id="oweh-lite-status">Ready</div>
      <div id="oweh-lite-progress">Low-resource mode · 3→4→6 egg tabs</div>
      <div class="row">
        <button id="oweh-lite-start" class="primary" type="button">Start</button>
        <button id="oweh-lite-stop" class="stop" type="button">Stop</button>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector("#oweh-lite-start").addEventListener("click", () => startFromPanel());
    panel.querySelector("#oweh-lite-stop").addEventListener("click", () => stopFromPanel());
    return panel;
  }

  function setStatus(text) {
    const node = document.querySelector("#oweh-lite-status");
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setProgress(text) {
    const node = document.querySelector("#oweh-lite-progress");
    if (node && node.textContent !== text) node.textContent = text;
  }

  function friendLinks(root = document) {
    const links = [...root.querySelectorAll('fieldset.friends a.user.avatar[href], fieldset.friends a[href], [aria-label="Friends"] a[href]')];
    const ownId = String(location.hash || "").match(/[?&]usr=(\d+)/)?.[1];
    const seen = new Set();
    return links.map(link => {
      const href = link.getAttribute("href") || "";
      const avatar = link.querySelector("img")?.getAttribute("src") || "";
      const id = href.match(/[?&]usr=(\d+)/)?.[1] || avatar.match(/\/user\/(\d+)/)?.[1];
      if (!id || id === ownId || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name: link.getAttribute("title") || link.querySelector("img")?.getAttribute("title") || link.textContent.trim() || `User ${id}`,
        hatchery: `#!/?src=pets&sub=hatchery&usr=${id}`
      };
    }).filter(Boolean);
  }

  async function openCompleteFriendsList() {
    let links = friendLinks();
    const friendsFieldset = () => document.querySelector("fieldset.friends");
    const hasOpenFriendsDialog = () => Boolean(friendsFieldset()) && [...document.querySelectorAll("button")]
      .some(candidate => /^Close$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null);
    if (links.length && hasOpenFriendsDialog()) return links;

    const button = [...document.querySelectorAll("main button")]
      .find(candidate => /^Friends(?:\s*\(\d+\))?$/i.test(candidate.textContent.trim()));
    if (!button) return hasOpenFriendsDialog() ? links : [];

    button.click();
    const deadline = Date.now() + 15000;
    let lastCount = -1;
    let stableSince = 0;
    while (Date.now() < deadline) {
      links = friendLinks();
      const count = links.length;
      if (count > 0 && hasOpenFriendsDialog() && count === lastCount) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 1500) return links;
      } else {
        lastCount = count;
        stableSince = 0;
      }
      await sleep(150);
    }
    links = friendLinks();
    return hasOpenFriendsDialog() ? links : [];
  }

  function closeFriendsDialog() {
    const fieldset = document.querySelector("fieldset.friends");
    const dialog = fieldset?.closest?.(".ui-dialog") || fieldset?.parentElement;
    const scoped = dialog ? [...dialog.querySelectorAll("button")]
      .find(candidate => /^Close$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null) : null;
    const fallback = [...document.querySelectorAll("button")]
      .find(candidate => /^Close$/i.test(candidate.textContent.trim()) && candidate.offsetParent !== null);
    (scoped || fallback)?.click();
  }

  async function startFromPanel() {
    if (document.getElementById("ovipets-hatchery-helper")) {
      setStatus("Disable the full OviPets extension before starting Lite");
      return;
    }
    setStatus("Reading Friends list...");
    const queue = await openCompleteFriendsList();
    if (!queue.length) {
      setStatus("Open your own OviPets profile/Friends page, then press Start");
      return;
    }
    closeFriendsDialog();
    const result = await request({ type: "liteStartSweep", queue });
    if (!result?.ok) {
      if (result?.reason === "already-running") setStatus("Friend Sweep Lite is already running in another OviPets tab");
      else setStatus(`Could not start: ${result?.reason || result?.error || "unknown"}`);
      return;
    }
    setStatus(`Started · ${queue.length} friends`);
    scheduleWorker(0);
  }

  async function stopFromPanel() {
    setStatus("Stopping...");
    await request({ type: "liteStopSweep" });
    setStatus("Stopped");
    setProgress("Low-resource mode · 3→4→6 egg tabs");
  }

  async function waitForMain(timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const main = document.querySelector("main");
      if (document.readyState !== "loading" && main && main.children.length) return true;
      await sleep(100);
    }
    return false;
  }

  function currentFriendId() {
    return String(location.hash || "").match(/[?&]usr=(\d+)/)?.[1] || "";
  }

  function getTurnableEggs(friendId) {
    const seen = new Set();
    return [...document.querySelectorAll('img[title="Turn Egg"]')].map(icon => {
      const card = icon.closest("li") || icon.parentElement?.parentElement;
      const anchor = card?.querySelector('a.pet[href*="pet="]');
      const href = anchor?.getAttribute("href") || "";
      const id = href.match(/[?&]pet=(\d+)/)?.[1];
      const usr = href.match(/[?&]usr=(\d+)/)?.[1] || friendId || "";
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return { id, href, usr };
    }).filter(Boolean);
  }

  async function stableEggSnapshot(friendId) {
    if (!(await waitForMain())) return null;
    await sleep(400);
    const end = Date.now() + 2600;
    let previous = null;
    let stableSince = 0;
    let latest = [];
    while (Date.now() < end) {
      const current = currentFriendId();
      if (current && current !== String(friendId)) return null;
      latest = getTurnableEggs(friendId);
      const stale = latest.some(egg => egg.usr && String(egg.usr) !== String(friendId));
      if (stale) {
        await sleep(150);
        continue;
      }
      const signature = latest.map(egg => egg.id).join(",");
      if (signature === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 700) return latest;
      } else {
        previous = signature;
        stableSince = 0;
      }
      await sleep(125);
    }
    return latest;
  }

  function scheduleWorker(delay = 100) {
    clearTimeout(workerTimer);
    workerTimer = setTimeout(() => processWorker().catch(error => {
      console.error("[Friend Sweep Lite] worker error", error);
      setStatus(`Worker error: ${error?.message || error}`);
    }), delay);
  }

  async function processWorker() {
    if (workerBusy) return;
    workerBusy = true;
    try {
      const snapshot = await request({ type: "liteGetState" });
      if (!snapshot?.ok) return;
      const { state, batch, speed, stats } = snapshot;
      if (state?.active && !snapshot.isWorker) return;
      if (!state?.active || Number(state.workerTabId) <= 0) {
        setProgress(`Name Species: ${stats?.correct || 0} correct · ${stats?.wrong || 0} wrong`);
        return;
      }

      const friend = state.queue?.[state.index];
      const total = state.queue?.length || 0;
      if (!friend) {
        setStatus("Sweep state has no current friend");
        return;
      }

      if (state.phase === "wait") {
        const remaining = Math.max(0, Number(state.waitingUntil || 0) - Date.now());
        setStatus(`Pass ${state.cycle} complete · next pass in ~${Math.ceil(remaining / 60000)} min`);
        setProgress(`${total} friends · Name Species ${stats?.correct || 0}/${stats?.wrong || 0} correct/wrong`);
        return;
      }

      if (state.phase === "batch") {
        const resolved = Number(batch?.resolved || 0);
        const expected = Number(batch?.expected || 0);
        setStatus(`Friend ${state.index + 1}/${total} · turning eggs ${resolved}/${expected}`);
        setProgress(`${batch?.open || 0} open · concurrency ${batch?.concurrency || speed?.level || 3} · ${batch?.timedOut || 0} timeout`);
        return;
      }

      if (location.hash !== friend.hatchery) {
        setStatus(`Pass ${state.cycle} · opening friend ${state.index + 1}/${total}`);
        location.hash = friend.hatchery;
        return;
      }

      const eggs = await stableEggSnapshot(friend.id);
      if (!eggs) {
        scheduleWorker(500);
        return;
      }

      const attempts = Number(state.friendAttempts?.[String(friend.id)] || 0);
      if (state.phase === "verify" && (!eggs.length || attempts >= VERIFY_ATTEMPTS)) {
        if (eggs.length && attempts >= VERIFY_ATTEMPTS) {
          setStatus(`Friend ${state.index + 1}/${total}: ${eggs.length} egg(s) left for a later pass`);
        } else {
          setStatus(`Friend ${state.index + 1}/${total}: verified complete`);
        }
        const next = await request({ type: "liteAdvanceFriend" });
        if (!next?.ok) {
          setStatus(`Advance failed: ${next?.reason || next?.error || "unknown"}`);
          return;
        }
        scheduleWorker(100);
        return;
      }

      if (!eggs.length) {
        setStatus(`Friend ${state.index + 1}/${total}: no turnable eggs`);
        const next = await request({ type: "liteAdvanceFriend" });
        if (!next?.ok) {
          setStatus(`Advance failed: ${next?.reason || next?.error || "unknown"}`);
          return;
        }
        scheduleWorker(100);
        return;
      }

      setStatus(`Friend ${state.index + 1}/${total}: ${eggs.length} turnable egg(s)`);
      const started = await request({ type: "liteStartBatch", friendId: friend.id, eggs });
      if (!started?.ok) {
        if (started?.reason === "batch-busy") {
          scheduleWorker(500);
          return;
        }
        setStatus(`Egg batch failed: ${started?.reason || started?.error || "unknown"}`);
        return;
      }
      const summary = started.summary;
      setProgress(`0/${summary?.expected || eggs.length} resolved · concurrency ${summary?.concurrency || speed?.level || 3}`);
    } finally {
      workerBusy = false;
    }
  }

  function visibleDialog(pattern) {
    const candidate = [...document.querySelectorAll('[role="dialog"], .ui-dialog, .ui-dialog-content')]
      .find(element => pattern.test(element.textContent || ""));
    const container = candidate?.closest?.(".ui-dialog") || candidate || null;
    return container && container.offsetParent !== null ? container : null;
  }

  function speciesDialog() {
    return visibleDialog(/Name the Species/i);
  }
  function incorrectDialog() {
    return visibleDialog(/answer is incorrect/i);
  }
  function exhaustedDialog() {
    return visibleDialog(/egg can no longer be turned/i);
  }

  function optionElements(container) {
    return [...container.querySelectorAll("button, label, [role=radio]")]
      .filter(element => element.offsetParent !== null)
      .map(element => ({ element, text: element.textContent.trim() }))
      .filter(item => item.text && !/^(Ok|Cancel|Close)$/i.test(item.text));
  }

  function okButton(container) {
    return [...container.querySelectorAll("button")]
      .find(button => /^Ok$/i.test(button.textContent.trim()) && button.offsetParent !== null) || null;
  }

  function challengeImage(container) {
    return container?.querySelector('img[title="Name the Species"]') || null;
  }

  async function waitImage(image, timeout = 350) {
    const end = Date.now() + timeout;
    while (Date.now() < end && image && (!image.complete || !image.naturalWidth)) await sleep(25);
    return Boolean(image?.complete && image?.naturalWidth);
  }

  function shapeFromImage(image) {
    const api = globalThis.OWEH_LITE_SHAPE;
    if (!api || !image?.complete || !image.naturalWidth) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = api.SIZE;
      canvas.height = api.SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return api.shapeFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      return null;
    }
  }

  function decodedImage(dataUrl) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }

  async function challengeShape(container) {
    const image = challengeImage(container);
    if (!image) return null;
    const source = image.currentSrc || image.src || image.getAttribute("src") || "";

    const direct = (async () => {
      await waitImage(image, 350);
      return shapeFromImage(image);
    })();
    const fetched = (async () => {
      if (!source) return null;
      const response = await request({ type: "liteSpeciesImage", url: source });
      if (!response?.ok || !response.dataUrl) return null;
      return shapeFromImage(await decodedImage(response.dataUrl));
    })();

    const first = await Promise.race([
      direct.then(shape => ({ source: "direct", shape })),
      fetched.then(shape => ({ source: "fetch", shape }))
    ]);
    if (first.shape) return first.shape;
    return first.source === "direct" ? await fetched : await direct;
  }

  async function answerSpecies(container, rejected) {
    const options = optionElements(container).filter(item => !rejected.has(item.text));
    if (!options.length) return { ok: false, reason: "no-eligible-species" };

    let shape = null;
    for (let attempt = 0; attempt < 2 && !shape; attempt += 1) {
      shape = await challengeShape(container);
      if (!shape) await sleep(150);
    }
    if (!shape) return { ok: false, reason: "shape-unavailable" };

    const ranked = globalThis.OWEH_LITE_SHAPE?.rankOptions(shape, options.map(item => item.text));
    const choice = options.find(item => item.text === ranked?.species);
    if (!choice) return { ok: false, reason: "species-no-match" };

    choice.element.click();
    const end = Date.now() + 700;
    let ok = okButton(container);
    while ((!ok || ok.disabled) && Date.now() < end) {
      await sleep(25);
      ok = okButton(container);
    }
    if (!ok || ok.disabled) return { ok: false, reason: "species-ok-unavailable" };
    await sleep(40);
    ok.click();
    return { ok: true, species: choice.text, method: ranked.method, distance: ranked.distance };
  }

  async function dismissIncorrect(container) {
    const button = okButton(container) || container.querySelector('.ui-dialog-titlebar-close,[aria-label="Close"],[title="Close"]');
    if (button && !button.disabled) button.click();
    const end = Date.now() + 1200;
    while (Date.now() < end && incorrectDialog()) await sleep(75);
    return !incorrectDialog();
  }

  async function turnAttempt(rejected) {
    const button = document.querySelector(TURN_SELECTOR);
    if (!button) return { ok: true, already: true, reason: "no-turn-button" };
    button.click();
    await sleep(200);

    const deadline = Date.now() + 30000;
    let submitted = null;
    while (Date.now() < deadline) {
      const terminal = exhaustedDialog();
      if (terminal) return { ok: false, terminal: true, reason: "egg-exhausted" };

      const error = incorrectDialog();
      if (error) {
        if (submitted?.species) {
          rejected.add(submitted.species);
          await request({ type: "liteSpeciesStats", patch: { wrong: 1 } });
        }
        await dismissIncorrect(error);
        return { ok: false, reason: "species-incorrect" };
      }

      const dialog = speciesDialog();
      if (dialog) {
        if (!submitted) {
          const answer = await answerSpecies(dialog, rejected);
          if (!answer.ok) return { ok: false, reason: answer.reason };
          submitted = answer;
        }
        await sleep(80);
        continue;
      }

      if (!document.querySelector(TURN_SELECTOR)) {
        if (submitted?.species) await request({ type: "liteSpeciesStats", patch: { correct: 1 } });
        return { ok: true, reason: "ui-confirmed" };
      }
      await sleep(80);
    }
    return { ok: false, reason: "turn-timeout" };
  }

  async function reportEgg(eggId, state, reason) {
    return request({ type: "liteEggResult", eggId, state, reason });
  }

  async function runEgg(assignment) {
    const eggId = String(assignment.eggId || "");
    const endReady = Date.now() + 9000;
    while (Date.now() < endReady) {
      if (document.readyState !== "loading" && document.querySelector("main")) break;
      await sleep(100);
    }

    const buttonEnd = Date.now() + 8000;
    while (Date.now() < buttonEnd && !document.querySelector(TURN_SELECTOR)) {
      if (/[?&]pet=\d+/.test(location.hash) && document.querySelector("main")) await sleep(100);
      else await sleep(150);
    }
    if (!document.querySelector(TURN_SELECTOR)) {
      await reportEgg(eggId, "already", "no-turn-button");
      return;
    }

    const rejected = new Set();
    let genericFailures = 0;
    let speciesRejects = 0;
    let lastReason = "unknown";

    while (genericFailures < 2 && speciesRejects < 6) {
      const result = await turnAttempt(rejected);
      if (result.ok) {
        await reportEgg(eggId, result.already ? "already" : "turned", result.reason);
        return;
      }
      lastReason = result.reason || "turn-failed";
      if (result.terminal) {
        await reportEgg(eggId, "exhausted", lastReason);
        return;
      }
      if (lastReason === "species-incorrect") speciesRejects += 1;
      else genericFailures += 1;
      await sleep(lastReason === "species-incorrect" ? 300 : 600);
    }
    await reportEgg(eggId, "failed", lastReason);
  }

  async function assignmentWithRetry() {
    if (!/[?&]pet=\d+/.test(location.hash)) return null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request({ type: "liteAssignment" });
      if (response?.ok && response.assignment) return response.assignment;
      await sleep(125);
    }
    return null;
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "liteBatchProgress") {
      const summary = message.summary || {};
      setProgress(`${summary.resolved || 0}/${summary.expected || 0} resolved · ${summary.open || 0} open · ${summary.timedOut || 0} timeout`);
    }
    if (message?.type === "liteBatchComplete") {
      const summary = message.summary || {};
      setStatus(`Batch complete · ${summary.turned || 0} turned · ${summary.failed || 0} failed`);
      setProgress(`Next verification · adaptive concurrency ${message.speed?.level || 3}`);
      setTimeout(() => location.reload(), 250);
    }
    if (message?.type === "liteResume") {
      setStatus(`Starting pass ${message.state?.cycle || ""}`);
      scheduleWorker(50);
    }
  });

  window.addEventListener("hashchange", () => scheduleWorker(250));

  (async () => {
    const assignment = await assignmentWithRetry();
    if (assignment) {
      await runEgg(assignment);
      return;
    }

    ensurePanel();
    const snapshot = await request({ type: "liteGetState" });
    if (snapshot?.ok) {
      const stats = snapshot.stats || {};
      setProgress(`Name Species: ${stats.correct || 0} correct · ${stats.wrong || 0} wrong`);
      if (snapshot.isWorker) scheduleWorker(150);
    }
  })().catch(error => console.error("[Friend Sweep Lite] startup failed", error));
})();

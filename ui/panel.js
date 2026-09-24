"use strict";

// Control-panel presentation and wiring. This module owns panel DOM, settings inputs,
// tooltip/collapse behavior and lightweight UI-only state. Automation state machines remain
// in features/* and are injected here as actions so the panel cannot become authoritative
// application state.
OWEH.register("ui-panel", helpers => {
  const { storageGet, storageGetMany, storageSet, setStatus, runtimeRequest, uiPanelActions } = helpers;
  const {
    panelId: PANEL_ID,
    tooltipId: TOOLTIP_ID,
    instanceId: PANEL_INSTANCE,
    stopAllAutomation,
    saveCurrentPet,
    refreshDatabaseHealth,
    rankPartners,
    startOwnEggs,
    stopOwnEggs,
    scanFriends,
    requestFriendSweepWorker,
    requestGoToNextFriend,
    stopFriendSweep,
    copyBlacklistCsv,
    applySuggestedName,
    requestStartBreedCampaign,
    requestStartBreedTargetCampaign,
    stopBreedCampaign,
    copyRetentionReviewCsv,
    confirmBreedPreview,
    discardBreedPreview,
    setBreedPairLimit,
    requestStartHatchlingProcessing,
    stopHatchlingProcessing,
    exportSpeciesInspector,
    exportSpeciesDatabase,
    importSpeciesDatabase,
    clearSpeciesInspector,
    getSpeciesInspectorSummary,
    exportDiagnosticLog,
    clearDiagnosticLog,
    getDiagnosticSummary,
    getPetNameSuggestion,
    friendBlacklist,
    isContextVisible,
    targetColors,
    defaultDelayMs: DEFAULT_DELAY,
    defaultPageLoadDelayMs: DEFAULT_PAGE_LOAD_DELAY,
    defaultBreedingStockMaxDistance: DEFAULT_BREEDING_STOCK_MAX_DISTANCE,
    setDelayMs,
    setPageLoadDelayMs
  } = uiPanelActions;

  const MAINTAIN_DEFAULT_STEPS = Object.freeze({ catalog: true, profiles: true, sort: true, feed: true });
  const clampDelay = value => Math.min(30000, Math.max(0, Math.round((Number(value) || 0) * 1000)));
  const clampPageLoadDelay = value => Math.min(10000, Math.max(250, Math.round((Number(value) || 1.5) * 1000)));

  function bindPanelAction(panel, selector, label, handler, missingControls) {
    const control = panel.querySelector(selector);
    if (!control) {
      missingControls.push(selector);
      return;
    }
    control.addEventListener("click", event => {
      event.preventDefault();
      setStatus(`${label}...`);
      try {
        Promise.resolve(handler(event)).catch(error => {
          console.error(`[OviPets Helper] ${label} failed`, error);
          setStatus(`${label} failed: ${error?.message || "unknown error"}`);
        });
      } catch (error) {
        console.error(`[OviPets Helper] ${label} failed`, error);
        setStatus(`${label} failed: ${error?.message || "unknown error"}`);
      }
    });
  }

  function loadPanelSettings(panel) {
    const collapseButton = panel.querySelector("#oweh-collapse");
    const applyCollapsed = collapsed => {
      panel.classList.toggle("oweh-collapsed", collapsed);
      collapseButton.textContent = collapsed ? "+" : "−";
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
    };
    collapseButton.addEventListener("click", () => {
      const collapsed = !panel.classList.contains("oweh-collapsed");
      applyCollapsed(collapsed);
      storageSet({ owehPanelCollapsed: collapsed });
    });
    storageGet("owehPanelCollapsed", false).then(value => applyCollapsed(Boolean(value)));

    const delayInput = panel.querySelector("#oweh-delay");
    const pageDelayInput = panel.querySelector("#oweh-page-delay");
    storageGetMany({ delayMs: DEFAULT_DELAY, pageLoadDelayMs: DEFAULT_PAGE_LOAD_DELAY }).then(value => {
      const delay = Number(value.delayMs) || DEFAULT_DELAY;
      const pageDelay = Number(value.pageLoadDelayMs) || DEFAULT_PAGE_LOAD_DELAY;
      setDelayMs(delay);
      setPageLoadDelayMs(pageDelay);
      delayInput.value = (delay / 1000).toString();
      pageDelayInput.value = (pageDelay / 1000).toString();
    });
    delayInput.addEventListener("change", () => {
      const value = clampDelay(delayInput.value);
      delayInput.value = (value / 1000).toString();
      setDelayMs(value);
      storageSet({ delayMs: value });
    });
    pageDelayInput.addEventListener("change", () => {
      const value = clampPageLoadDelay(pageDelayInput.value);
      pageDelayInput.value = (value / 1000).toString();
      setPageLoadDelayMs(value);
      storageSet({ pageLoadDelayMs: value });
    });

    const stockDistanceInput = panel.querySelector("#oweh-stock-distance");
    storageGet("owehBreedingStockMaxDistance", DEFAULT_BREEDING_STOCK_MAX_DISTANCE).then(raw => {
      stockDistanceInput.value = String(Math.min(765, Math.max(0, Number(raw) || DEFAULT_BREEDING_STOCK_MAX_DISTANCE)));
    });
    stockDistanceInput.addEventListener("change", () => {
      const value = Math.min(765, Math.max(0, Math.round(Number(stockDistanceInput.value) || DEFAULT_BREEDING_STOCK_MAX_DISTANCE)));
      stockDistanceInput.value = String(value);
      storageSet({ owehBreedingStockMaxDistance: value });
    });

    const eggTabCapInput = panel.querySelector("#oweh-egg-tab-cap");
    const clampEggTabCap = raw => Math.min(15, Math.max(1, Math.floor(Number(raw)) || 15));
    storageGet("owehEggTabCap", 15).then(raw => { eggTabCapInput.value = String(clampEggTabCap(raw)); });
    eggTabCapInput.addEventListener("change", () => {
      const value = clampEggTabCap(eggTabCapInput.value);
      eggTabCapInput.value = String(value);
      storageSet({ owehEggTabCap: value });
    });

    const speciesSoundInput = panel.querySelector("#oweh-species-sound");
    storageGet("owehSpeciesAlertSound", true).then(value => { speciesSoundInput.checked = value !== false; });
    speciesSoundInput.addEventListener("change", () => storageSet({ owehSpeciesAlertSound: speciesSoundInput.checked }));

    const removeEmptyInput = panel.querySelector("#oweh-remove-empty");
    storageGet("owehRemoveEmptyFriends", true).then(value => { removeEmptyInput.checked = value !== false; });
    removeEmptyInput.addEventListener("change", () => storageSet({ owehRemoveEmptyFriends: removeEmptyInput.checked }));

    const pairLimitInput = panel.querySelector("#oweh-breed-limit");
    storageGet("owehBreedPairLimit", 0).then(value => { pairLimitInput.value = String(Math.max(0, Math.floor(Number(value) || 0))); });
    pairLimitInput.addEventListener("change", async () => {
      pairLimitInput.value = String(await setBreedPairLimit(pairLimitInput.value));
    });

    const autoRenameInput = panel.querySelector("#oweh-auto-rename");
    storageGet("owehAutoRename", true).then(value => { autoRenameInput.checked = value !== false; });
    autoRenameInput.addEventListener("change", () => storageSet({ owehAutoRename: autoRenameInput.checked }));

    // Update database step toggles (jobs/maintain.js reads owehMaintainSteps at start).
    const stepInputs = [...panel.querySelectorAll("[data-maintain-step]")];
    storageGet("owehMaintainSteps", MAINTAIN_DEFAULT_STEPS).then(stored => {
      const steps = { ...MAINTAIN_DEFAULT_STEPS, ...(stored || {}) };
      for (const input of stepInputs) input.checked = steps[input.dataset.maintainStep] !== false;
    });
    for (const input of stepInputs) {
      input.addEventListener("change", () => {
        storageSet({ owehMaintainSteps: Object.fromEntries(stepInputs.map(item => [item.dataset.maintainStep, item.checked])) });
      });
    }
  }

  function attachTooltip(panel) {
    document.getElementById(TOOLTIP_ID)?.remove();
    const tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.dataset.owehUi = "1";
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);
    let tooltipTarget = null;
    const positionTooltip = event => {
      const margin = 12;
      const width = tooltip.offsetWidth || 250;
      const height = tooltip.offsetHeight || 45;
      const left = Math.min(window.innerWidth - width - margin, Math.max(margin, event.clientX + 14));
      const top = Math.min(window.innerHeight - height - margin, Math.max(margin, event.clientY + 16));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    panel.addEventListener("pointerover", event => {
      const target = event.target.closest("[data-tip]");
      if (!target || !panel.contains(target)) return;
      tooltipTarget = target;
      tooltip.textContent = target.dataset.tip;
      tooltip.classList.add("oweh-tooltip-visible");
      positionTooltip(event);
    });
    panel.addEventListener("pointermove", event => {
      if (tooltipTarget) positionTooltip(event);
    });
    panel.addEventListener("pointerout", event => {
      if (!tooltipTarget || event.relatedTarget?.closest?.("[data-tip]") === tooltipTarget) return;
      tooltipTarget = null;
      tooltip.classList.remove("oweh-tooltip-visible");
    });
  }

  // Wide side window for the breeding pair list; ui/dashboard.js fills it from storage.
  function ensureBreedPlanView(panel) {
    document.getElementById("oweh-breed-plan-view")?.remove();
    const view = document.createElement("aside");
    view.id = "oweh-breed-plan-view";
    view.className = "oweh-plan-view oweh-hidden";
    view.dataset.owehUi = "1";
    view.innerHTML = `
      <header class="oweh-plan-view-header">
        <div class="oweh-plan-view-title"><strong>Breeding pairs</strong><span id="oweh-plan-view-meta"></span></div>
        <button id="oweh-plan-view-close" class="oweh-icon-button" type="button" aria-label="Close pair list" title="Close" data-tip="Close the pair list. View pairs under Breeding opens it again.">×</button>
      </header>
      <div class="oweh-plan-view-scroll">
        <table class="oweh-plan-table">
          <thead><tr>
            <th title="Order the pairs are bred in (best-ranked first)">#</th>
            <th>Female</th>
            <th>Male</th>
            <th title="Body 1 channels that can reach the target this generation, and new FF channels the male adds">Body 1</th>
            <th title="Estimated chance of a fully pure egg">Pure chance</th>
            <th title="The male&#39;s closest secondary slot (Body 2 / Scales / Extra 1 / Extra 2) and its distance to target">Best secondary</th>
            <th title="Chosen male / number of safe male candidates">Males</th>
            <th title="Male appears in the female&#39;s own OviPets Breeding tab">Game-listed</th>
            <th>Status</th>
          </tr></thead>
          <tbody id="oweh-plan-view-rows"></tbody>
        </table>
      </div>
    `;
    view.querySelector("#oweh-plan-view-close").addEventListener("click", () => {
      view.dataset.dismissed = "1";
      view.classList.add("oweh-hidden");
    });
    panel.querySelector("#oweh-view-breed-plan")?.addEventListener("click", () => {
      view.dataset.dismissed = "";
      view.classList.remove("oweh-hidden");
      // Both side windows share one spot: opening the pair list steps the cull review aside.
      const cullView = document.getElementById("oweh-cull-view");
      if (cullView) {
        cullView.dataset.dismissed = "1";
        cullView.classList.add("oweh-hidden");
      }
    });
    document.body.appendChild(view);
    return view;
  }

  // v5.6.0: side window listing the males a cull would move; ui/dashboard.js fills it.
  function ensureCullView(panel) {
    document.getElementById("oweh-cull-view")?.remove();
    const view = document.createElement("aside");
    view.id = "oweh-cull-view";
    view.className = "oweh-plan-view oweh-hidden";
    view.dataset.owehUi = "1";
    view.innerHTML = `
      <header class="oweh-plan-view-header">
        <div class="oweh-plan-view-title"><strong>Male cull review</strong><span id="oweh-cull-view-meta"></span></div>
        <button id="oweh-cull-view-close" class="oweh-icon-button" type="button" aria-label="Close male cull review" title="Close" data-tip="Close the cull review. View cull list under Breeding opens it again.">×</button>
      </header>
      <div class="oweh-plan-view-scroll">
        <table class="oweh-plan-table">
          <thead><tr>
            <th>#</th>
            <th>Male</th>
            <th>Species</th>
            <th>Enclosure</th>
            <th title="Target channels this male already has exactly right">Exact</th>
            <th title="Total distance to the target over all 15 channels">Distance</th>
            <th title="Kept males that are at least as close on every channel (one per lineage shown)">Covered by</th>
            <th>Status</th>
          </tr></thead>
          <tbody id="oweh-cull-view-rows"></tbody>
        </table>
      </div>
    `;
    view.querySelector("#oweh-cull-view-close").addEventListener("click", () => {
      view.dataset.dismissed = "1";
      view.classList.add("oweh-hidden");
    });
    panel.querySelector("#oweh-view-cull")?.addEventListener("click", () => {
      view.dataset.dismissed = "";
      view.classList.remove("oweh-hidden");
    });
    document.body.appendChild(view);
    return view;
  }

  function ensure() {
    const existing = document.getElementById(PANEL_ID);
    if (existing?.dataset.owehInstance === PANEL_INSTANCE) return existing;
    // Extension updates can leave old DOM on the OviPets SPA after the isolated-world
    // listeners were destroyed. Replace that stale panel instead of leaving inert buttons.
    existing?.remove();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.dataset.owehUi = "1";
    panel.dataset.owehInstance = PANEL_INSTANCE;
    panel.innerHTML = `
      <header class="oweh-header">
        <div class="oweh-brand">
          <span class="oweh-title">OviPets Helper</span>
          <span class="oweh-version">v5.6.0</span>
          <span id="oweh-header-state" class="oweh-header-state">Idle</span>
        </div>
        <button id="oweh-collapse" class="oweh-icon-button" type="button" aria-expanded="true" data-tip="Collapse or expand the whole control panel.">−</button>
      </header>
      <div id="oweh-panel-body" class="oweh-panel-body">
        <section class="oweh-activity-card" aria-label="Automation activity">
          <div class="oweh-activity-line">
            <span class="oweh-live-dot"></span><strong id="oweh-active-summary">No automation running</strong>
            <button id="oweh-stop-all" class="oweh-danger" type="button" data-tip="Stop everything: release the shared background tab (whichever feature currently holds it) and stop egg-turning/friend-request lanes in this tab. The scoped Stop buttons below still work individually.">Stop All</button>
          </div>
          <div id="oweh-active-jobs" class="oweh-active-jobs"></div>
        </section>
        <div id="oweh-status" class="oweh-status" role="status" aria-live="polite">Ready · controls connected</div>

        <details class="oweh-module" name="oweh-modules" data-accent="db" open>
          <summary><i class="oweh-ico">▦</i>Update database <span>catalog · profiles · sort · feed</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions oweh-run-row">
              <button id="oweh-maintain-start" class="oweh-primary" type="button" data-tip="One pass over your whole collection by background fetch + game commands (no page navigation): read every enclosure, refresh stale or missing profiles, move pets to the enclosure the breeding program wants, and feed hungry pets. Untick a step below to skip it.">Update database</button>
              <button id="oweh-maintain-stop" class="oweh-danger" type="button" data-tip="Stop Update database after the current pet.">Stop</button>
            </div>
            <div class="oweh-steps" role="group" aria-label="Update database steps">
              <label class="oweh-step" data-tip="Read every Overview enclosure and save the pet list (flags pets whose profile changed)."><input type="checkbox" data-maintain-step="catalog" checked><span>1 · Catalog</span></label>
              <label class="oweh-step" data-tip="Read the profile of every new, changed, incomplete or wrongly named pet and save colors, gender and pedigree."><input type="checkbox" data-maintain-step="profiles" checked><span>2 · Profiles</span></label>
              <label class="oweh-step" data-tip="Move each pet into the enclosure the breeding program wants (females by program, males to Males)."><input type="checkbox" data-maintain-step="sort" checked><span>3 · Sort</span></label>
              <label class="oweh-step" data-tip="Feed every pet not known to be full or fed recently, with the free per-pet Feed (never the Credit-priced Mass Feed)."><input type="checkbox" data-maintain-step="feed" checked><span>4 · Feed</span></label>
            </div>
            <label class="oweh-check" data-tip="During the Profiles step, rename owned pets BODY1-BODY2-SCALES from their hexadecimal color codes."><input id="oweh-auto-rename" type="checkbox" checked> Rename pets while reading profiles</label>
            <div class="oweh-meta-card">
              <div id="oweh-db-meta" class="oweh-inline-meta">Database: not scanned</div>
              <div id="oweh-db-health" class="oweh-inline-meta">Health: checking…</div>
              <button id="oweh-refresh-health" class="oweh-link-button" type="button" data-tip="Inspect transactional pet records, stale profiles, active task leases, and mutation commands awaiting reconciliation.">Check health</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="egg">
          <summary><i class="oweh-ico">◒</i>Hatchery <span>turn · hatch · newborns</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions oweh-run-row">
              <button id="oweh-start" class="oweh-primary" type="button" data-tip="One button for your own Hatchery: hatch-ready eggs hatch by game command; turnable eggs still open a real egg tab because Name the Species needs the real egg. When the eggs are done, every newborn is named, saved to the database and moved to its enclosure in the same run.">Turn / hatch → name &amp; move</button>
              <button id="oweh-stop" class="oweh-danger" type="button" disabled data-tip="Stop the current egg turn/hatch queue safely.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-start-hatchlings" class="oweh-secondary" type="button" data-tip="Only the newborn step: for each hatched pet, read its colors, rename it, save it to the database and move it (pure/stock females by program, every male into Males) — by command, without opening pages.">Newborns only</button>
              <button id="oweh-stop-hatchlings" class="oweh-danger" type="button" data-tip="Stop the newborn pass after the current pet.">Stop</button>
            </div>
            <div class="oweh-inline-meta oweh-note">Turning an egg still opens the real egg page, so Name the Species can be answered.</div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="breed">
          <summary><i class="oweh-ico">♥</i>Breeding <span>plan → confirm</span></summary>
          <div class="oweh-module-body">
            <div id="oweh-breed-ready" class="oweh-inline-meta" data-tip="From the database only: females in the breeding enclosures, and how many are off cooldown with a verified pedigree. Run Update database to refresh cooldowns.">Females ready: checking…</div>
            <div class="oweh-actions">
              <button id="oweh-start-breed" type="button" data-tip="Pure-line strategy: scan the full enclosure snapshot, then choose complementary Body-1 FF pairs while preserving pedigree safety and male-line diversity. Builds a plan only; nothing is bred until you press Confirm.">Plan pure-line</button>
              <button id="oweh-start-breed-target" type="button" data-tip="Same-FF target-improvement strategy: scan every enclosure, take every breedable female, list every safe same-species male with the same Body-1 FF mask, then choose the male whose Body 2 / Scales / Extra 1 / Extra 2 contains the closest target slot. Builds a plan only; nothing is bred until you press Confirm.">Plan Same-FF target</button>
              <button id="oweh-stop-breed" class="oweh-danger" type="button" data-tip="Stop the active breeding campaign (and withdraw an unconfirmed plan) without clearing cached pet data.">Stop</button>
            </div>
            <div id="oweh-breed-preview" class="oweh-inline-meta oweh-breed-preview">No plan yet — press a Plan button</div>
            <div class="oweh-row" data-tip="Breed at most this many pairs when you confirm (0 = every pair in the plan). The best-ranked pairs go first."><label for="oweh-breed-limit">Pair limit</label><input id="oweh-breed-limit" type="number" min="0" max="999" step="1" value="0"><span>pairs</span></div>
            <div class="oweh-actions">
              <button id="oweh-confirm-breed" class="oweh-primary" type="button" disabled data-tip="Breed the planned pairs shown above (up to the pair limit) in the shared background tab.">Confirm &amp; breed</button>
              <button id="oweh-discard-breed" class="oweh-secondary" type="button" disabled data-tip="Throw the plan away without breeding anything.">Discard</button>
            </div>
            <button id="oweh-view-breed-plan" class="oweh-primary-wide" type="button" disabled data-tip="Open the side window with every planned pair (or the confirmed campaign and its progress) in a full-size table.">View pairs</button>
            <div class="oweh-inline-meta" data-tip="Male cull: a male can go when at least 2 kept males from different lineages are as close or closer to the pure target on all 15 channels — for every female they give an equal or better pure chance. Males in a breeding plan or campaign are never listed.">Male cull → Males discard</div>
            <div class="oweh-actions">
              <button id="oweh-cull-plan" type="button" data-tip="From the database only: list the redundant males. Nothing is moved until you press Confirm cull.">Plan cull</button>
              <button id="oweh-cull-stop" class="oweh-danger" type="button" data-tip="Stop moving males. Males already moved stay in Males discard; Confirm cull resumes the rest.">Stop</button>
            </div>
            <div id="oweh-cull-preview" class="oweh-inline-meta oweh-breed-preview">No cull plan yet — press Plan cull</div>
            <div class="oweh-actions">
              <button id="oweh-cull-confirm" class="oweh-primary" type="button" disabled data-tip="Move the listed males into the Males discard enclosure in the shared background tab. Nothing is deleted or sold — do that yourself in OviPets.">Confirm cull</button>
              <button id="oweh-cull-discard" class="oweh-secondary" type="button" disabled data-tip="Throw the cull plan away without moving anything.">Discard</button>
            </div>
            <button id="oweh-view-cull" class="oweh-primary-wide" type="button" disabled data-tip="Open the side window with every male the cull would move, the better males that cover it, and move progress.">View cull list</button>
            <div class="oweh-actions oweh-tools-row">
              <button id="oweh-rank" class="oweh-link-button" type="button" data-tip="Rank the currently visible breeding candidates against the fixed FF/00 pure target.">Rank visible partners</button>
              <button id="oweh-copy-retention" class="oweh-link-button" type="button" data-tip="Copy the lowest-ranked retention review as CSV. This never removes pets automatically.">Copy retention CSV</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="friend">
          <summary><i class="oweh-ico">☺</i>Friends &amp; requests <span>sweep · ninja · ads</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-subtitle">Friend sweep</div>
            <div class="oweh-actions">
              <button id="oweh-start-sweep" class="oweh-primary" type="button" data-tip="Fast Sweep snapshots each friend once, then drains adaptive batches of 10 → 12 → 15 profile tabs. It reloads only once for final verification and self-heals on stalls.">Start full sweep</button>
              <button id="oweh-next-friend" class="oweh-secondary" type="button" data-tip="Skip the current friend and open the next eligible friend in the queue.">Next</button>
              <button id="oweh-stop-sweep" class="oweh-danger" type="button" data-tip="Stop the friend sweep and its egg queue.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-scan-friends" class="oweh-secondary" type="button" data-tip="Open and scan your complete Friends list, then cache every resolvable friend ID.">Rescan friend list</button>
            </div>
            <label class="oweh-check" data-tip="Remove a friend only when their Hatchery contains no eggs at all. Already-turned eggs still count as eggs."><input id="oweh-remove-empty" type="checkbox" checked> Remove friends with zero eggs</label>
            <div class="oweh-inline-meta"><span id="oweh-blacklist-count">Blacklist: 0</span><button id="oweh-copy-blacklist" class="oweh-link-button" type="button" data-tip="Copy the permanent zero-egg friend blacklist as CSV.">Copy CSV</button></div>
            <div class="oweh-divider"></div>
            <div class="oweh-subtitle">New friends from Ninja Please + Ads</div>
            <div class="oweh-actions">
              <button id="oweh-ninja-start" type="button" data-tip="Read Ninja Please and Ads post comments from the last 24 hours, merge unique user IDs, and skip everyone already asked. Sends nothing.">1 · Scan comments</button>
              <button id="oweh-ninja-stop" class="oweh-danger" type="button" data-tip="Stop the Ninja + Ads scan.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-requests-start" type="button" data-tip="Send one friend request per queued commenter, skipping everyone already asked. Scans nothing.">2 · Send requests</button>
              <button id="oweh-requests-stop" class="oweh-danger" type="button" data-tip="Stop sending friend requests.">Stop</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="species">
          <summary><i class="oweh-ico">✦</i>Species <span>Name the Species memory</span></summary>
          <div class="oweh-module-body">
            <div id="oweh-species-stats" class="oweh-inline-meta">Species checks: 0 detected · 0 correct · 0 manual prompts</div>
            <div id="oweh-species-inspector-stats" class="oweh-inline-meta">Species Inspector: 0 question(s) recorded</div>
            <div class="oweh-actions">
              <button id="oweh-species-seed-start" type="button" data-tip="Learn species silhouettes from the pets listed in the Adoption Center (read-only, no clicks; needs ovipets.com). Images you label in Species review are learned too. More learned shapes make Name the Species answers more accurate.">Learn species shapes</button>
              <button id="oweh-species-seed-stop" class="oweh-danger" type="button" data-tip="Stop Learn species shapes after the current pet.">Stop</button>
            </div>
            <button id="oweh-species-review" class="oweh-primary-wide" type="button" data-tip="Open a separate tab with every saved Name the Species image (correct and wrong). Label the unresolved ones yourself; each label is saved to the species database and teaches the silhouette matcher.">Review species images</button>
            <div class="oweh-actions oweh-tools-row">
              <button id="oweh-export-species-db" class="oweh-link-button" type="button" data-tip="Download a compact backup of learned Species image memory, answer IDs and statistics. Keep this file when moving to another computer.">Backup DB</button>
              <button id="oweh-import-species-db" class="oweh-link-button" type="button" data-tip="Import/merge a Species database backup or a previous Species Inspector JSON export. Existing knowledge is preserved and merged.">Import DB</button>
              <input id="oweh-import-species-file" type="file" accept="application/json,.json" hidden>
              <button id="oweh-export-species" class="oweh-link-button" type="button" data-tip="Download the full privacy-scoped Species Inspector dataset for analysis. Learned memory is included.">Export JSON</button>
              <button id="oweh-clear-species" class="oweh-link-button" type="button" data-tip="Clear only the Species Inspector trace dataset. Learned answer memory is kept so future guesses stay smarter.">Clear traces</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="pet">
          <summary><i class="oweh-ico">✎</i>Current pet <span>save · name</span></summary>
          <div class="oweh-module-body">
            <div id="oweh-pet-name" class="oweh-pet-name">Open a pet profile to see a naming suggestion</div>
            <div class="oweh-actions">
              <button id="oweh-save" type="button" data-tip="Save the currently open pet's ID, colors, gender, species and visible pedigree to the local index.">Save</button>
              <button id="oweh-apply-name" type="button" disabled data-tip="Rename the current owned pet with its suggested hexadecimal color name.">Apply name</button>
              <button id="oweh-copy-name" class="oweh-secondary" type="button" disabled data-tip="Copy the BODY1-BODY2-SCALES hexadecimal name suggested for the current pet.">Copy name</button>
            </div>
            <div class="oweh-inline-meta oweh-note" data-tip="Update database (Profiles step) and the Hatchery newborn pass rename pets automatically; this is the manual one-pet path.">Newborns and Update database rename automatically.</div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="diag">
          <summary><i class="oweh-ico">⚑</i>Diagnostics <span>logbook</span></summary>
          <div class="oweh-module-body">
            <div id="oweh-diagnostic-stats" class="oweh-inline-meta">Diagnostic Log: loading…</div>
            <div class="oweh-actions oweh-tools-row">
              <button id="oweh-export-diagnostics" class="oweh-link-button" type="button" data-tip="Download the persistent diagnostic timeline, failure reasons and a current worker/egg state snapshot for later debugging.">Export log</button>
              <button id="oweh-clear-diagnostics" class="oweh-link-button" type="button" data-tip="Clear the retained diagnostic timeline. Current automation/database state is not changed.">Clear log</button>
            </div>
            <div class="oweh-inline-meta oweh-note">Keeps up to 5,000 events / 14 days: runtime errors, worker lifecycle, sweep progress, egg timeouts and forced recovery.</div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules" data-accent="settings">
          <summary><i class="oweh-ico">⚙</i>Settings <span>delays · target</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-row" data-tip="Optional wait between individual egg-turn actions."><label for="oweh-delay">Turn delay</label><input id="oweh-delay" type="number" min="0" max="30" step="0.5" value="0"><span>s</span></div>
            <div class="oweh-row" data-tip="Time allowed for OviPets page content to render before the next workflow step."><label for="oweh-page-delay">Page load</label><input id="oweh-page-delay" type="number" min="0.25" max="10" step="0.25" value="1.5"><span>s</span></div>
            <div class="oweh-row" data-tip="Females with no FF/00 color pair and an average target distance at or below this value are routed to Breeding Stock."><label for="oweh-stock-distance">Stock distance</label><input id="oweh-stock-distance" type="number" min="0" max="765" step="1" value="96"><span>max</span></div>
            <div class="oweh-row" data-tip="Most egg tabs Full sweep and own-Hatchery turning may open at once. Lower it (4–8) to save CPU; 15 lets the adaptive 10 → 12 → 15 speed run uncapped."><label for="oweh-egg-tab-cap">Egg tabs</label><input id="oweh-egg-tab-cap" type="number" min="1" max="15" step="1" value="15"><span>max</span></div>
            <label class="oweh-check" data-tip="Play a sound and focus the exact tab whenever an unknown Name the Species verification needs your answer."><input id="oweh-species-sound" type="checkbox" checked> Species verification alert</label>
            <div class="oweh-target-title">Fixed pure target</div>
            <div class="oweh-grid" data-tip="The breeding score is fixed to this project's target colors.">
              <label>Body 1<input id="oweh-body1" value="#FFFFFF" maxlength="7" readonly></label>
              <label>Body 2<input id="oweh-body2" value="#FF0000" maxlength="7" readonly></label>
              <label>Scales<input id="oweh-scales" value="#000000" maxlength="7" readonly></label>
              <label>Extra 1<input id="oweh-extra1" value="#FF0000" maxlength="7" readonly></label>
              <label>Extra 2<input id="oweh-extra2" value="#000000" maxlength="7" readonly></label>
            </div>
          </div>
        </details>
      </div>
    `;
    document.body.appendChild(panel);
    ensureBreedPlanView(panel);
    ensureCullView(panel);
    attachTooltip(panel);
    loadPanelSettings(panel);

    const missingControls = [];
    bindPanelAction(panel, "#oweh-stop-all", "Stopping all automation", stopAllAutomation, missingControls);
    for (const [selector, spec] of Object.entries(OWEH.collect("buttons"))) {
      bindPanelAction(panel, selector, spec.label, spec.handler, missingControls);
    }
    bindPanelAction(panel, "#oweh-save", "Saving current pet", saveCurrentPet, missingControls);
    bindPanelAction(panel, "#oweh-refresh-health", "Checking database health", async () => {
      const health = await refreshDatabaseHealth(true);
      setStatus(health ? `Database health refreshed — ${health.complete}/${health.present} complete profiles` : "Database health check failed");
    }, missingControls);
    bindPanelAction(panel, "#oweh-copy-name", "Copying suggested name", async event => {
      const name = event.currentTarget.dataset.name;
      if (!name) return;
      try {
        await navigator.clipboard.writeText(name);
        setStatus(`Copied "${name}" to clipboard`);
      } catch {
        setStatus("Could not copy automatically — select the suggested name text manually");
      }
    }, missingControls);
    bindPanelAction(panel, "#oweh-rank", "Ranking partners", rankPartners, missingControls);
    bindPanelAction(panel, "#oweh-start", "Starting egg run", startOwnEggs, missingControls);
    bindPanelAction(panel, "#oweh-stop", "Stopping egg run", stopOwnEggs, missingControls);
    bindPanelAction(panel, "#oweh-scan-friends", "Scanning friend list", scanFriends, missingControls);
    bindPanelAction(panel, "#oweh-start-sweep", "Starting background friend sweep", requestFriendSweepWorker, missingControls);
    bindPanelAction(panel, "#oweh-next-friend", "Opening next friend", requestGoToNextFriend, missingControls);
    bindPanelAction(panel, "#oweh-stop-sweep", "Stopping friend sweep", stopFriendSweep, missingControls);
    bindPanelAction(panel, "#oweh-copy-blacklist", "Copying blacklist", copyBlacklistCsv, missingControls);
    bindPanelAction(panel, "#oweh-apply-name", "Applying suggested name", applySuggestedName, missingControls);
    bindPanelAction(panel, "#oweh-start-breed", "Building pure-line breeding campaign", requestStartBreedCampaign, missingControls);
    bindPanelAction(panel, "#oweh-start-breed-target", "Building Same-FF target breeding campaign", requestStartBreedTargetCampaign, missingControls);
    bindPanelAction(panel, "#oweh-stop-breed", "Stopping breeding campaign", stopBreedCampaign, missingControls);
    bindPanelAction(panel, "#oweh-confirm-breed", "Confirming breeding plan", confirmBreedPreview, missingControls);
    bindPanelAction(panel, "#oweh-discard-breed", "Discarding breeding plan", discardBreedPreview, missingControls);
    bindPanelAction(panel, "#oweh-copy-retention", "Copying retention review", copyRetentionReviewCsv, missingControls);
    bindPanelAction(panel, "#oweh-start-hatchlings", "Starting Hatchery processing", requestStartHatchlingProcessing, missingControls);
    bindPanelAction(panel, "#oweh-stop-hatchlings", "Stopping Hatchery processing", stopHatchlingProcessing, missingControls);
    bindPanelAction(panel, "#oweh-export-species", "Exporting Species Inspector data", async () => {
      await exportSpeciesInspector();
      await updateSpeciesInspectorStats(true);
    }, missingControls);
    bindPanelAction(panel, "#oweh-export-species-db", "Exporting Species database", async () => {
      await exportSpeciesDatabase();
      await updateSpeciesInspectorStats(true);
    }, missingControls);
    bindPanelAction(panel, "#oweh-species-review", "Opening Species Review", async () => {
      const result = await runtimeRequest({ type: "openSpeciesReview" });
      if (!result?.ok) throw new Error(result?.error || "Species Review tab could not be opened");
      setStatus("Species Review opened in a new tab");
    }, missingControls);
    const importSpeciesFile = panel.querySelector("#oweh-import-species-file");
    bindPanelAction(panel, "#oweh-import-species-db", "Choosing Species database backup", async () => {
      if (!importSpeciesFile) throw new Error("Species database file picker is missing");
      importSpeciesFile.value = "";
      importSpeciesFile.click();
    }, missingControls);
    if (!importSpeciesFile) missingControls.push("#oweh-import-species-file");
    else importSpeciesFile.addEventListener("change", async () => {
      const file = importSpeciesFile.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        await importSpeciesDatabase(payload);
        await updateSpeciesInspectorStats(true);
      } catch (error) {
        console.error("[OviPets Helper] Species database import failed", error);
        setStatus(`Species database import failed: ${error?.message || error}`);
      } finally {
        importSpeciesFile.value = "";
      }
    });
    bindPanelAction(panel, "#oweh-clear-species", "Clearing Species Inspector data", async () => {
      await clearSpeciesInspector();
      await updateSpeciesInspectorStats(true);
    }, missingControls);
    bindPanelAction(panel, "#oweh-export-diagnostics", "Exporting Diagnostic Log", async () => {
      await exportDiagnosticLog();
      await updateDiagnosticStats(true);
    }, missingControls);
    bindPanelAction(panel, "#oweh-clear-diagnostics", "Clearing Diagnostic Log", async () => {
      await clearDiagnosticLog();
      await updateDiagnosticStats(true);
    }, missingControls);
    if (missingControls.length) {
      console.error("[OviPets Helper] Panel controls missing", missingControls);
      setStatus(`Panel initialization incomplete: ${missingControls.join(", ")}`);
    }

    storageSet({ owehTargetColors: { ...targetColors } });
    return panel;
  }

  function setEggRunning(value) {
    const panel = document.getElementById(PANEL_ID);
    const start = panel?.querySelector("#oweh-start");
    const stop = panel?.querySelector("#oweh-stop");
    if (start && start.disabled !== Boolean(value)) start.disabled = Boolean(value);
    if (stop && stop.disabled !== !value) stop.disabled = !value;
  }

  function updatePetNameSuggestion() {
    const label = document.querySelector("#oweh-pet-name");
    const copyButton = document.querySelector("#oweh-copy-name");
    const applyButton = document.querySelector("#oweh-apply-name");
    if (!label || !copyButton || !applyButton) return;
    const suggestion = getPetNameSuggestion();
    const text = suggestion ? `Suggested name: ${suggestion}` : "Open a pet profile to see a naming suggestion";
    // Refresh runs from a document-wide MutationObserver, so every DOM write is guarded.
    if (label.textContent !== text) label.textContent = text;
    if (copyButton.disabled !== !suggestion) copyButton.disabled = !suggestion;
    if (copyButton.dataset.name !== (suggestion || "")) copyButton.dataset.name = suggestion || "";
    if (applyButton.disabled !== !suggestion) applyButton.disabled = !suggestion;
  }

  function updateBlacklistCount() {
    const label = document.querySelector("#oweh-blacklist-count");
    if (!label) return;
    Promise.resolve(friendBlacklist()).then(blacklist => {
      const text = `Blacklist: ${Object.keys(blacklist || {}).length} friend(s)`;
      if (label.textContent !== text) label.textContent = text;
    });
  }


  // sync() runs on every coalesced DOM refresh (in up to 15 egg tabs at once) and the summary
  // reads the whole Inspector store, network traces included — so passive refreshes are
  // throttled; export/import/clear force an immediate recount.
  let speciesStatsAt = 0;
  let speciesStatsPending = false;
  async function updateSpeciesInspectorStats(force = false) {
    const label = document.querySelector("#oweh-species-inspector-stats");
    if (!label || typeof getSpeciesInspectorSummary !== "function") return;
    if (!force && (speciesStatsPending || Date.now() - speciesStatsAt < 5000)) return;
    speciesStatsPending = true;
    try {
      const summary = await getSpeciesInspectorSummary();
      speciesStatsAt = Date.now();
      const text = `Species Inspector: ${summary?.questions || 0} question(s) · ${summary?.correct || 0} correct · ${summary?.wrong || 0} wrong · ${summary?.network || 0} trace event(s)`;
      if (label.textContent !== text) label.textContent = text;
    } catch {} finally {
      speciesStatsPending = false;
    }
  }

  let diagnosticStatsAt = 0;
  let diagnosticStatsPending = false;
  async function updateDiagnosticStats(force = false) {
    const label = document.querySelector("#oweh-diagnostic-stats");
    if (!label || typeof getDiagnosticSummary !== "function") return;
    const now = Date.now();
    if (!force && (diagnosticStatsPending || now - diagnosticStatsAt < 3000)) return;
    diagnosticStatsPending = true;
    try {
      const summary = await getDiagnosticSummary();
      diagnosticStatsAt = Date.now();
      const errors = Number(summary?.counts?.error || 0);
      const warnings = Number(summary?.counts?.warning || 0);
      const last = summary?.last;
      const lastText = last ? ` · last: ${last.level} ${last.source}/${last.event}` : "";
      const text = `Diagnostic Log: ${summary?.total || 0} event(s) · ${errors} error · ${warnings} warning${lastText}`;
      if (label.textContent !== text) label.textContent = text;
    } catch {
      if (label.textContent !== "Diagnostic Log: unavailable") label.textContent = "Diagnostic Log: unavailable";
    } finally {
      diagnosticStatsPending = false;
    }
  }

  function isVisible(jobCount) {
    return Boolean(isContextVisible(jobCount));
  }

  function sync(jobCount = 0) {
    const panel = ensure();
    panel?.classList.toggle("oweh-hidden", !isVisible(jobCount));
    updatePetNameSuggestion();
    updateSpeciesInspectorStats();
    updateDiagnosticStats();
  }

  return { api: { ensure, sync, setEggRunning, updatePetNameSuggestion, updateBlacklistCount, updateSpeciesInspectorStats, updateDiagnosticStats, isVisible } };
});

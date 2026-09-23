"use strict";

// Control-panel presentation and wiring. This module owns panel DOM, settings inputs,
// tooltip/collapse behavior and lightweight UI-only state. Automation state machines remain
// in features/* and are injected here as actions so the panel cannot become authoritative
// application state.
OWEH.register("ui-panel", helpers => {
  const { storageGet, storageGetMany, storageSet, setStatus, uiPanelActions } = helpers;
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

    const speciesSoundInput = panel.querySelector("#oweh-species-sound");
    storageGet("owehSpeciesAlertSound", true).then(value => { speciesSoundInput.checked = value !== false; });
    speciesSoundInput.addEventListener("change", () => storageSet({ owehSpeciesAlertSound: speciesSoundInput.checked }));

    const removeEmptyInput = panel.querySelector("#oweh-remove-empty");
    storageGet("owehRemoveEmptyFriends", true).then(value => { removeEmptyInput.checked = value !== false; });
    removeEmptyInput.addEventListener("change", () => storageSet({ owehRemoveEmptyFriends: removeEmptyInput.checked }));

    const autoRenameInput = panel.querySelector("#oweh-auto-rename");
    storageGet("owehAutoRename", true).then(value => { autoRenameInput.checked = value !== false; });
    autoRenameInput.addEventListener("change", () => storageSet({ owehAutoRename: autoRenameInput.checked }));
  }

  function attachTooltip(panel) {
    document.getElementById(TOOLTIP_ID)?.remove();
    const tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
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

  function ensure() {
    const existing = document.getElementById(PANEL_ID);
    if (existing?.dataset.owehInstance === PANEL_INSTANCE) return existing;
    // Extension updates can leave old DOM on the OviPets SPA after the isolated-world
    // listeners were destroyed. Replace that stale panel instead of leaving inert buttons.
    existing?.remove();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.dataset.owehInstance = PANEL_INSTANCE;
    panel.innerHTML = `
      <header class="oweh-header">
        <div class="oweh-brand">
          <span class="oweh-title">OviPets Helper</span>
          <span class="oweh-version">v5.3.17</span>
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

        <details class="oweh-module" name="oweh-modules" open>
          <summary>Pet maintenance <span>one button = one job</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions">
              <button id="oweh-catalog-start" type="button" data-tip="Scan every Overview enclosure and save the pet list to the database. Opens no profile, renames and moves nothing.">Update pet catalog</button>
              <button id="oweh-catalog-stop" class="oweh-danger" type="button" data-tip="Stop the catalog update.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-profiles-start" type="button" data-tip="Open the profile of every pet whose stored profile is missing, incomplete, out of date (flagged by Update pet catalog) or wrongly named, and save it. Does not scan the Overview — run Update pet catalog first.">Refresh pet profiles</button>
              <button id="oweh-profiles-stop" class="oweh-danger" type="button" data-tip="Stop refreshing pet profiles.">Stop</button>
            </div>
            <label class="oweh-check" data-tip="While refreshing profiles, rename owned pets as BODY1-BODY2-SCALES using their hexadecimal color codes."><input id="oweh-auto-rename" type="checkbox" checked> Rename while refreshing profiles</label>
            <div class="oweh-actions">
              <button id="oweh-sort-start" type="button" data-tip="Move pets into the enclosure the breeding program wants, from the database. Scans and feeds nothing.">Sort pets into enclosures</button>
              <button id="oweh-sort-stop" class="oweh-danger" type="button" data-tip="Stop sorting.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-feed-start" type="button" data-tip="Feed every pet that is not known to be full or fed recently, using the free per-pet Feed action (never the Credit-priced Mass Feed).">Feed pets</button>
              <button id="oweh-feed-stop" class="oweh-danger" type="button" data-tip="Stop feeding.">Stop</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Ninja + Ads <span>scan / send</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions">
              <button id="oweh-ninja-start" type="button" data-tip="Read Ninja Please and Ads post comments from the last 24 hours, merge unique user IDs, and skip everyone already asked. Sends nothing.">Scan Ninja + Ads</button>
              <button id="oweh-ninja-stop" class="oweh-danger" type="button" data-tip="Stop the Ninja + Ads scan.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-requests-start" type="button" data-tip="Send one friend request per queued commenter, skipping everyone already asked. Scans nothing.">Send friend requests</button>
              <button id="oweh-requests-stop" class="oweh-danger" type="button" data-tip="Stop sending friend requests.">Stop</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Hatchery &amp; Eggs <span>turn / hatch / process</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions">
              <button id="oweh-start" type="button" data-tip="On your own Hatchery: hatch-ready eggs use the guarded OviPets UI command directly; turnable eggs still open real profile tabs so Name the Species can be handled safely.">Turn / Hatch available eggs</button>
              <button id="oweh-stop" class="oweh-danger" type="button" disabled data-tip="Stop the current egg turn/hatch queue safely.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-start-hatchlings" type="button" data-tip="Process newly hatched pets: read colors, rename them, route pure/stock females, and move every male into Males.">Process hatchlings</button>
              <button id="oweh-stop-hatchlings" class="oweh-danger" type="button" data-tip="Stop the active Hatchery hatchling processor.">Stop</button>
            </div>
            <div id="oweh-species-stats" class="oweh-inline-meta">Species checks: 0 detected · 0 correct · 0 manual prompts</div>
            <div id="oweh-species-inspector-stats" class="oweh-inline-meta">Species Inspector: 0 question(s) recorded</div>
            <div class="oweh-actions">
              <button id="oweh-export-species" class="oweh-secondary" type="button" data-tip="Download the full privacy-scoped Species Inspector dataset for analysis. Learned memory is included.">Export Species JSON</button>
              <button id="oweh-export-species-db" class="oweh-secondary" type="button" data-tip="Download a compact backup of learned Species image memory, answer IDs and statistics. Keep this file when moving to another computer.">Export Species DB</button>
              <button id="oweh-import-species-db" class="oweh-secondary" type="button" data-tip="Import/merge a Species database backup or a previous Species Inspector JSON export. Existing knowledge is preserved and merged.">Import Species DB</button>
              <input id="oweh-import-species-file" type="file" accept="application/json,.json" hidden>
              <button id="oweh-clear-species" class="oweh-secondary" type="button" data-tip="Clear only the Species Inspector trace dataset. Learned answer memory is kept so future guesses stay smarter.">Clear Inspector</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Friends <span>sweep</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions">
              <button id="oweh-scan-friends" type="button" data-tip="Open and scan your complete Friends list, then cache every resolvable friend ID.">Scan friend list</button>
              <button id="oweh-start-sweep" type="button" data-tip="Fast Sweep snapshots each friend once, then drains adaptive batches of 10 → 12 → 15 profile tabs. It reloads only once for final verification and self-heals on stalls.">Start full sweep</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-next-friend" class="oweh-secondary" type="button" data-tip="Skip the current friend and open the next eligible friend in the queue.">Next</button>
              <button id="oweh-stop-sweep" class="oweh-danger" type="button" data-tip="Stop the friend sweep and its egg queue.">Stop sweep</button>
            </div>
            <div class="oweh-inline-meta">Fast Sweep: snapshot queue · adaptive 10 → 12 → 15 tabs · one final verify</div>
            <label class="oweh-check" data-tip="Remove a friend only when their Hatchery contains no eggs at all. Already-turned eggs still count as eggs."><input id="oweh-remove-empty" type="checkbox" checked> Remove friends with zero eggs</label>
            <div class="oweh-inline-meta"><span id="oweh-blacklist-count">Blacklist: 0</span><button id="oweh-copy-blacklist" class="oweh-secondary" type="button" data-tip="Copy the permanent zero-egg friend blacklist as CSV.">Copy blacklist CSV</button></div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Breeding <span>female-first · Males</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-actions">
              <button id="oweh-start-breed" type="button" data-tip="Pure-line strategy: scan the full enclosure snapshot, then choose complementary Body-1 FF pairs while preserving pedigree safety and male-line diversity.">Start pure-line campaign</button>
              <button id="oweh-start-breed-target" type="button" data-tip="Same-FF target-improvement strategy: scan every enclosure, take every breedable female, list every safe same-species male with the same Body-1 FF mask, then choose the male whose Body 2 / Scales / Extra 1 / Extra 2 contains the closest target slot.">Start Same-FF target campaign</button>
              <button id="oweh-stop-breed" class="oweh-danger" type="button" data-tip="Stop the active breeding campaign without clearing cached pet data.">Stop</button>
            </div>
            <div class="oweh-actions">
              <button id="oweh-rank" class="oweh-secondary" type="button" data-tip="Rank the currently visible breeding candidates against the fixed FF/00 pure target.">Rank visible partners</button>
              <button id="oweh-copy-retention" class="oweh-secondary" type="button" data-tip="Copy the lowest-ranked retention review as CSV. This never removes pets automatically.">Copy retention CSV</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Pet Tools <span>name / sort</span></summary>
          <div class="oweh-module-body">
            <div id="oweh-db-meta" class="oweh-inline-meta">Database: not scanned</div>
            <div id="oweh-db-health" class="oweh-inline-meta">Health: checking…</div>
            <button id="oweh-refresh-health" class="oweh-secondary" type="button" data-tip="Inspect transactional pet records, stale profiles, active task leases, and mutation commands awaiting reconciliation.">Refresh database health</button>
            <div class="oweh-inline-meta" data-tip="Pets are auto-renamed BODY1-BODY2-SCALES at two other points too: right after hatching (Hatchery &amp; Eggs → Process hatchlings) and during a profile refresh (Pet maintenance → Rename while refreshing profiles checkbox). Below is the third, manual, one-pet-at-a-time path.">Rename: manual (below) · also automatic after hatching &amp; while refreshing profiles</div>
            <div id="oweh-pet-name" class="oweh-pet-name">Open a pet profile to see a naming suggestion</div>
            <div class="oweh-actions">
              <button id="oweh-save" type="button" data-tip="Save the currently open pet's ID, colors, gender, species and visible pedigree to the local index.">Save current pet</button>
              <button id="oweh-copy-name" class="oweh-secondary" type="button" disabled data-tip="Copy the BODY1-BODY2-SCALES hexadecimal name suggested for the current pet.">Copy name</button>
              <button id="oweh-apply-name" type="button" disabled data-tip="Rename the current owned pet with its suggested hexadecimal color name.">Apply name</button>
            </div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Diagnostics <span>logbook / black box</span></summary>
          <div class="oweh-module-body">
            <div id="oweh-diagnostic-stats" class="oweh-inline-meta">Diagnostic Log: loading…</div>
            <div class="oweh-actions">
              <button id="oweh-export-diagnostics" class="oweh-secondary" type="button" data-tip="Download the persistent diagnostic timeline, failure reasons and a current worker/egg state snapshot for later debugging.">Export Diagnostic Log</button>
              <button id="oweh-clear-diagnostics" class="oweh-secondary" type="button" data-tip="Clear the retained diagnostic timeline. Current automation/database state is not changed.">Clear Diagnostic Log</button>
            </div>
            <div class="oweh-inline-meta">Keeps up to 5,000 events / 14 days. Runtime errors, worker lifecycle, sweep progress, egg timeouts and forced recovery are recorded automatically.</div>
          </div>
        </details>

        <details class="oweh-module" name="oweh-modules">
          <summary>Settings <span>delays / target</span></summary>
          <div class="oweh-module-body">
            <div class="oweh-row" data-tip="Optional wait between individual egg-turn actions."><label for="oweh-delay">Turn delay</label><input id="oweh-delay" type="number" min="0" max="30" step="0.5" value="0"><span>s</span></div>
            <div class="oweh-row" data-tip="Time allowed for OviPets page content to render before the next workflow step."><label for="oweh-page-delay">Page load</label><input id="oweh-page-delay" type="number" min="0.25" max="10" step="0.25" value="1.5"><span>s</span></div>
            <div class="oweh-row" data-tip="Females with no FF/00 color pair and an average target distance at or below this value are routed to Breeding Stock."><label for="oweh-stock-distance">Stock distance</label><input id="oweh-stock-distance" type="number" min="0" max="765" step="1" value="96"><span>max</span></div>
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
    bindPanelAction(panel, "#oweh-copy-retention", "Copying retention review", copyRetentionReviewCsv, missingControls);
    bindPanelAction(panel, "#oweh-start-hatchlings", "Starting Hatchery processing", requestStartHatchlingProcessing, missingControls);
    bindPanelAction(panel, "#oweh-stop-hatchlings", "Stopping Hatchery processing", stopHatchlingProcessing, missingControls);
    bindPanelAction(panel, "#oweh-export-species", "Exporting Species Inspector data", async () => {
      await exportSpeciesInspector();
      await updateSpeciesInspectorStats();
    }, missingControls);
    bindPanelAction(panel, "#oweh-export-species-db", "Exporting Species database", async () => {
      await exportSpeciesDatabase();
      await updateSpeciesInspectorStats();
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
        await updateSpeciesInspectorStats();
      } catch (error) {
        console.error("[OviPets Helper] Species database import failed", error);
        setStatus(`Species database import failed: ${error?.message || error}`);
      } finally {
        importSpeciesFile.value = "";
      }
    });
    bindPanelAction(panel, "#oweh-clear-species", "Clearing Species Inspector data", async () => {
      await clearSpeciesInspector();
      await updateSpeciesInspectorStats();
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


  async function updateSpeciesInspectorStats() {
    const label = document.querySelector("#oweh-species-inspector-stats");
    if (!label || typeof getSpeciesInspectorSummary !== "function") return;
    try {
      const summary = await getSpeciesInspectorSummary();
      const text = `Species Inspector: ${summary?.questions || 0} question(s) · ${summary?.correct || 0} correct · ${summary?.wrong || 0} wrong · ${summary?.network || 0} trace event(s)`;
      if (label.textContent !== text) label.textContent = text;
    } catch {}
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
    updateBlacklistCount();
    updateSpeciesInspectorStats();
    updateDiagnosticStats();
  }

  return { api: { ensure, sync, setEggRunning, updatePetNameSuggestion, updateBlacklistCount, updateSpeciesInspectorStats, updateDiagnosticStats, isVisible } };
});

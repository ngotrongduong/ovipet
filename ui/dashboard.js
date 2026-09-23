"use strict";

// Activity/database-health presentation state. The dashboard owns its own debounce/cache and
// renders only from durable storage + the shared-worker lease; content.js supplies the small
// visibility/status callbacks needed to compose it with the rest of the panel.
OWEH.register("ui-dashboard", helpers => {
  const { storageGetMany, runtimeRequest, setStatus, uiDashboardActions } = helpers;
  const { panelId, isPanelVisible } = uiDashboardActions;
  const STRAIGHT_JOB_LABELS = {
    catalog: "Update catalog", sort: "Sort pets", feed: "Feed pets", ninja: "Scan Ninja", requests: "Send requests"
  };
  let updating = false;
  let timer = null;
  let lastDatabaseHealthAt = 0;
  let cachedDatabaseHealth = null;
  let lastShownSweepNotice = 0;
  let lastJobCount = 0;

  function compactProgress(index, total) {
    const current = Math.max(0, Number(index || 0));
    const maximum = Math.max(0, Number(total || 0));
    return maximum ? `${Math.min(current + 1, maximum)}/${maximum}` : "working";
  }

  async function refreshHealth(force = false) {
    if (!force && cachedDatabaseHealth && Date.now() - lastDatabaseHealthAt < 30000) return cachedDatabaseHealth;
    const result = await runtimeRequest({ type: "stateHealth" });
    if (!result.ok) return cachedDatabaseHealth;
    cachedDatabaseHealth = result.health;
    lastDatabaseHealthAt = Date.now();
    const detail = document.querySelector("#oweh-db-health");
    if (detail) {
      const health = result.health;
      detail.textContent = `Health: ${health.complete}/${health.present} complete · ${health.incomplete} incomplete · ${health.stale} stale · ${health.uncertainCommands} command(s) awaiting reconciliation · ${health.activeTasks} active task(s)`;
      detail.classList.toggle("oweh-health-warning", Boolean(health.incomplete || health.uncertainCommands || health.staleTasks));
    }
    return result.health;
  }

  async function update() {
    if (updating) return;
    const panel = document.getElementById(panelId);
    const summary = panel?.querySelector("#oweh-active-summary");
    const jobsContainer = panel?.querySelector("#oweh-active-jobs");
    const headerState = panel?.querySelector("#oweh-header-state");
    const databaseMeta = panel?.querySelector("#oweh-db-meta");
    if (!panel || !summary || !jobsContainer || !headerState) return;
    updating = true;
    try {
      const state = await storageGetMany({
        owehEggRun: { active: false, count: 0 },
        owehSweep: { active: false, index: 0, maxFriends: 0, cycle: 1, waitingUntil: 0 },
        owehWorker: null,
        owehBreedCampaign: { active: false, femaleIndex: 0, bredCount: 0 },
        owehBreedQueue: [],
        owehPetIndex: { active: false, index: 0, indexed: 0 },
        owehPetScanQueue: [],
        owehHatchlingRun: { active: false, phase: "", index: 0 },
        owehHatchlingQueue: [],
        owehFriendRemoval: { active: false },
        owehDatabaseMeta: { catalogCount: 0, completeProfiles: 0, missingProfiles: 0, enclosureCount: 0, catalogAt: 0 },
        owehSweepNotice: null
      });
      const notice = state.owehSweepNotice;
      if (notice?.text && notice.at > lastShownSweepNotice && Date.now() - notice.at < 15000) {
        lastShownSweepNotice = notice.at;
        setStatus(notice.text);
      }
      if (databaseMeta) {
        const meta = state.owehDatabaseMeta || {};
        const text = `Database: ${Number(meta.completeProfiles || 0)}/${Number(meta.catalogCount || 0)} profiles · ${Number(meta.enclosureCount || 0)} enclosures`;
        if (databaseMeta.textContent !== text) databaseMeta.textContent = text;
      }
      refreshHealth(false);
      const jobs = [];
      const workerIsLive = state.owehWorker && Date.now() < Number(state.owehWorker.leaseUntil || 0);
      const workerOwns = owner => workerIsLive && state.owehWorker.owner === owner;

      for (const [owner, name] of Object.entries(STRAIGHT_JOB_LABELS)) {
        if (workerOwns(owner)) jobs.push({ name, detail: `${state.owehWorker.phase || "starting"} · background`, tone: "pet" });
      }
      if (state.owehEggRun?.active) {
        jobs.push({ name: "Egg turn", detail: `${Number(state.owehEggRun.count || 0)} done`, tone: "egg" });
      }
      if (state.owehSweep?.active) {
        const location = workerOwns("sweep") ? "background" : "recovering";
        const cycle = Math.max(1, Number(state.owehSweep.cycle || 1));
        const waitMs = Math.max(0, Number(state.owehSweep.waitingUntil || 0) - Date.now());
        const waitDetail = waitMs > 0 ? ` · cooldown ${Math.max(1, Math.ceil(waitMs / 60000))}m` : "";
        jobs.push({ name: "Friend sweep", detail: `pass ${cycle} · ${compactProgress(state.owehSweep.index, state.owehSweep.maxFriends)}${waitDetail} · ${location}`, tone: "friend" });
      } else if (workerOwns("sweep")) {
        jobs.push({ name: "Friend sweep", detail: `preparing · background (${state.owehWorker.phase || "starting"})`, tone: "friend" });
      }
      if (state.owehFriendRemoval?.active) jobs.push({ name: "Friend removal", detail: "confirming", tone: "friend" });
      if (state.owehPetIndex?.active) {
        jobs.push({ name: "Pet index", detail: compactProgress(state.owehPetIndex.index, state.owehPetScanQueue.length), tone: "pet" });
      }
      if (state.owehBreedCampaign?.active) {
        const strategy = state.owehBreedCampaign.strategy === "same-ff-target" ? "Same-FF target" : "Pure line";
        jobs.push({ name: "Breeding", detail: `${strategy} · ${compactProgress(state.owehBreedCampaign.femaleIndex, state.owehBreedQueue.length)} · ${Number(state.owehBreedCampaign.bredCount || 0)} bred`, tone: "breed" });
      }
      if (state.owehHatchlingRun?.active) {
        const phase = state.owehHatchlingRun.phase === "maleMove" ? "moving males" : "checking hatchlings";
        jobs.push({ name: "Hatchling processing", detail: `${phase} ${compactProgress(state.owehHatchlingRun.index, state.owehHatchlingQueue.length)}`, tone: "egg" });
      }

      const signature = JSON.stringify(jobs);
      if (jobsContainer.dataset.signature !== signature) {
        jobsContainer.dataset.signature = signature;
        jobsContainer.replaceChildren(...jobs.map(job => {
          const chip = document.createElement("span");
          chip.className = `oweh-job oweh-job-${job.tone}`;
          chip.textContent = `${job.name} · ${job.detail}`;
          chip.title = `${job.name} is currently active (${job.detail}).`;
          return chip;
        }));
      }
      lastJobCount = jobs.length;
      panel.classList.toggle("oweh-hidden", !isPanelVisible(lastJobCount));
      const summaryText = lastJobCount ? `${lastJobCount} automation${lastJobCount === 1 ? "" : "s"} running` : "No automation running";
      if (summary.textContent !== summaryText) summary.textContent = summaryText;
      const headerText = lastJobCount ? `${lastJobCount} active` : "Idle";
      if (headerState.textContent !== headerText) headerState.textContent = headerText;
      headerState.classList.toggle("oweh-active", Boolean(lastJobCount));
      panel.classList.toggle("oweh-has-active", Boolean(lastJobCount));
    } finally {
      updating = false;
    }
  }

  function schedule(delay = 80) {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      update();
    }, delay);
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return { api: { refreshHealth, update, schedule, cancel, getJobCount: () => lastJobCount } };
});

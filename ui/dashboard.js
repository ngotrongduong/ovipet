"use strict";

// Activity/database-health presentation state. The dashboard owns its own debounce/cache and
// renders only from durable storage + the shared-worker lease; content.js supplies the small
// visibility/status callbacks needed to compose it with the rest of the panel.
OWEH.register("ui-dashboard", helpers => {
  const { storageGet, storageGetMany, runtimeRequest, setStatus, uiDashboardActions } = helpers;
  const breedingReadiness = helpers.domain?.breedingPlan?.breedingReadiness;
  const BREED_PREVIEW_MAX_AGE_MS = 15 * 60 * 1000;
  const { panelId, isPanelVisible } = uiDashboardActions;
  const STRAIGHT_JOB_LABELS = {
    maintain: "Update database", ninja: "Scan Ninja", requests: "Send requests"
  };
  let updating = false;
  let timer = null;
  let lastDatabaseHealthAt = 0;
  let cachedDatabaseHealth = null;
  let lastShownSweepNotice = 0;
  let lastJobCount = 0;
  let lastReadinessAt = 0;
  let cachedReadiness = null;
  let readinessKey = "";

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

  // Females ready X/Y straight from the pet database; no worker tab, page or command involved.
  async function refreshBreedReadiness(force = false) {
    const target = document.querySelector("#oweh-breed-ready");
    if (!target || !breedingReadiness || !storageGet) return null;
    if (target.closest?.("details")?.open === false) return cachedReadiness;
    if (!force && Date.now() - lastReadinessAt < 30000) return cachedReadiness;
    lastReadinessAt = Date.now();
    const summary = breedingReadiness(await storageGet("owehPets", {}));
    cachedReadiness = summary;
    target.textContent = summary.total
      ? `Females ready: ${summary.ready}/${summary.total} · ${summary.cooldown} on cooldown · ${summary.unverified} pedigree unverified`
      : "Females ready: no female in the breeding enclosures yet — run Update database";
    return summary;
  }

  function renderBreedPreview(panel, preview, campaign) {
    const box = panel.querySelector("#oweh-breed-preview");
    const confirm = panel.querySelector("#oweh-confirm-breed");
    const discard = panel.querySelector("#oweh-discard-breed");
    if (!box) return;
    const age = preview ? Date.now() - Number(preview.createdAt || 0) : Infinity;
    const fresh = Boolean(preview?.queue?.length) && age <= BREED_PREVIEW_MAX_AGE_MS;
    let text = "No plan yet — press a Plan button";
    if (preview && !fresh) text = "The last plan expired (older than 15 minutes) — plan again";
    if (fresh) {
      const strategy = preview.strategy === "same-ff-target" ? "Same-FF target" : "Pure-line";
      const pairs = preview.queue.filter(row => row?.maleId);
      const sample = pairs.slice(0, 3).map(row => `${row.name || row.id} × ${row.maleName || row.maleId}`).join(", ");
      text = `${strategy} plan · ${preview.species || "?"} · ${Number(preview.pairable ?? pairs.length)} pair(s) for ${Number(preview.femaleCount || 0)} female(s) · ${Number(preview.unpaired || 0)} unpaired · built ${Math.max(0, Math.round(age / 60000))}m ago${sample ? ` · ${sample}${pairs.length > 3 ? ", …" : ""}` : ""}`;
    }
    if (box.textContent !== text) box.textContent = text;
    if (confirm) confirm.disabled = !fresh || Boolean(campaign?.active);
    if (discard) discard.disabled = !preview;
  }

  // Side window next to the panel: the full pair list of the current plan (or of the confirmed
  // campaign while/after it runs). Read-only presentation of durable storage; it never plans,
  // confirms or breeds. The window opens by itself once per new plan/campaign; after the user
  // closes it, the "View pairs" button reopens it.
  const SECONDARY_LABELS = { body2: "Body 2", scales: "Scales", extra1: "Extra 1", extra2: "Extra 2" };
  let planViewKey = "";
  let planViewSignature = "";

  function formatChance(pure) {
    const value = Number(pure?.pureProbability);
    if (!Number.isFinite(value) || value <= 0) return "—";
    const percent = value * 100;
    return percent >= 0.01 ? `${percent.toFixed(2)}%` : `${percent.toExponential(1)}%`;
  }

  function planViewSource(state) {
    const preview = state.owehBreedPreview;
    const campaign = state.owehBreedCampaign || {};
    const queue = Array.isArray(state.owehBreedQueue) ? state.owehBreedQueue : [];
    const strategyName = value => value === "same-ff-target" ? "Same-FF target" : "Pure-line";
    if (campaign.active && queue.length) {
      return { key: `campaign:${campaign.startedAt || 0}`, mode: "running", rows: queue, strategy: strategyName(campaign.strategy), species: campaign.species, progress: Number(campaign.femaleIndex || 0), campaign };
    }
    const age = preview ? Date.now() - Number(preview.createdAt || 0) : Infinity;
    if (preview?.queue?.length && age <= BREED_PREVIEW_MAX_AGE_MS) {
      return { key: `plan:${preview.createdAt || 0}`, mode: "plan", rows: preview.queue, strategy: strategyName(preview.strategy), species: preview.species, limit: Number(state.owehBreedPairLimit || 0), preview };
    }
    if (campaign.confirmedAt && queue.length) {
      return { key: `campaign:${campaign.startedAt || 0}`, mode: "finished", rows: queue, strategy: strategyName(campaign.strategy), species: campaign.species, progress: queue.length, campaign };
    }
    return null;
  }

  function planViewRows(source) {
    return source.rows.map((row, index) => {
      const pure = row?.pure || null;
      const candidates = Array.isArray(row?.maleCandidates) ? row.maleCandidates : [];
      const chosen = candidates[Number(row?.maleCandidateIndex || 0)] || candidates[0] || null;
      let status = "queued";
      if (!row?.maleId) status = "no safe male";
      if (source.mode === "plan" && source.limit && index >= source.limit) status = "over limit";
      if (source.mode !== "plan") {
        if (index < source.progress) status = "done";
        else if (index === source.progress && source.mode === "running") status = "breeding";
      }
      const secondaryDistance = Number(row?.maleSecondaryBestDistance);
      return {
        index: index + 1,
        female: row?.name || String(row?.id || "?"),
        femaleId: String(row?.id || ""),
        male: row?.maleId ? (row.maleName || String(row.maleId)) : "—",
        maleId: row?.maleId ? String(row.maleId) : "",
        body1: pure ? `${Number(pure.body1ReachableChannels || 0)}/3 · +${Number(pure.body1NewExactChannels || 0)} FF` : "—",
        chance: formatChance(pure),
        secondary: row?.maleSecondaryBestDistance !== null && Number.isFinite(secondaryDistance)
          ? `${SECONDARY_LABELS[row.maleSecondaryBestKey] || row.maleSecondaryBestKey || "slot"} ${secondaryDistance}`
          : "—",
        candidates: candidates.length ? `${Math.min(Number(row?.maleCandidateIndex || 0) + 1, candidates.length)}/${candidates.length}` : "0",
        gameListed: chosen?.gameListed === true ? "yes" : "",
        status
      };
    });
  }

  function planViewCell(tag, text, className) {
    const cell = document.createElement(tag);
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function renderBreedPlanView(state, panelHidden) {
    const view = document.getElementById("oweh-breed-plan-view");
    if (!view) return;
    const source = planViewSource(state);
    const opener = document.querySelector("#oweh-view-breed-plan");
    if (opener) opener.disabled = !source;
    if (!source) {
      view.classList.add("oweh-hidden");
      planViewKey = "";
      planViewSignature = "";
      return;
    }
    if (source.key !== planViewKey) {
      planViewKey = source.key;
      view.dataset.dismissed = "";
    }
    view.classList.toggle("oweh-hidden", panelHidden || view.dataset.dismissed === "1");
    const rows = planViewRows(source);
    const pairs = rows.filter(row => row.maleId).length;
    const heading = source.mode === "plan"
      ? `${source.strategy} plan · ${source.species || "all species"} · ${pairs} pair(s) / ${rows.length} female(s)${source.limit ? ` · limit ${source.limit}` : ""} · waiting for Confirm`
      : `${source.strategy} campaign · ${source.species || "all species"} · ${Math.min(source.progress, rows.length)}/${rows.length} processed · ${Number(source.campaign?.bredCount || 0)} bred${source.mode === "finished" ? " · finished" : ""}`;
    const signature = JSON.stringify([heading, rows]);
    if (signature === planViewSignature) return;
    planViewSignature = signature;
    const meta = view.querySelector("#oweh-plan-view-meta");
    if (meta) meta.textContent = heading;
    const body = view.querySelector("#oweh-plan-view-rows");
    if (!body) return;
    body.replaceChildren(...rows.map(row => {
      const tr = document.createElement("tr");
      tr.className = `oweh-plan-row oweh-plan-${row.status.replace(/\s+/g, "-")}`;
      const female = planViewCell("td", row.female);
      female.title = `Female ID ${row.femaleId}`;
      const male = planViewCell("td", row.male);
      if (row.maleId) male.title = `Male ID ${row.maleId}`;
      tr.append(
        planViewCell("td", String(row.index), "oweh-plan-num"),
        female,
        male,
        planViewCell("td", row.body1),
        planViewCell("td", row.chance),
        planViewCell("td", row.secondary),
        planViewCell("td", row.candidates),
        planViewCell("td", row.gameListed),
        planViewCell("td", row.status, "oweh-plan-status")
      );
      return tr;
    }));
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
        owehSweepNotice: null,
        owehBreedPreview: null,
        owehBreedPairLimit: 0
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
      renderBreedPreview(panel, state.owehBreedPreview, state.owehBreedCampaign);
      // A new plan or a finished pairing changes cooldowns: recount right away instead of in 30s.
      const nextReadinessKey = `${state.owehBreedPreview?.createdAt || 0}|${state.owehBreedCampaign?.active}|${state.owehBreedCampaign?.bredCount || 0}|${state.owehDatabaseMeta?.catalogAt || 0}`;
      const readinessChanged = nextReadinessKey !== readinessKey;
      readinessKey = nextReadinessKey;
      refreshBreedReadiness(readinessChanged).catch(() => {});
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
      } else if (workerOwns("breed") && !state.owehPetIndex?.active) {
        // Planning (full-enclosure scan + pair selection) runs under the breed lease before the
        // campaign record turns active; without this the panel read "Idle" for the whole scan.
        jobs.push({ name: "Breeding", detail: `planning · background (${state.owehWorker.phase || "starting"})`, tone: "breed" });
      }
      if (state.owehHatchlingRun?.active) {
        jobs.push({ name: "Newborns", detail: `name · save · move ${compactProgress(state.owehHatchlingRun.index, state.owehHatchlingQueue.length)}`, tone: "egg" });
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
      const panelHidden = !isPanelVisible(lastJobCount);
      panel.classList.toggle("oweh-hidden", panelHidden);
      renderBreedPlanView(state, panelHidden);
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

  return { api: { refreshHealth, refreshBreedReadiness, update, schedule, cancel, getJobCount: () => lastJobCount } };
});

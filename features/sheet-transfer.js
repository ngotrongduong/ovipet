"use strict";

// Explicit-ID discard from a Google Sheets CSV, local CSV or pasted IDs.
// This is deliberately INDEPENDENT of the heuristic "Discard surplus" rules.
// A reviewed snapshot is required before the permanent game command is sent.
OWEH.register("feature-sheet-transfer", helpers => {
  const {
    storageGet, storageSet, setStatus, petFetch, domain, getPetsByIds,
    runtimeRequest, gameActions, isWorkerOwner, settings, sleep
  } = helpers;
  const csv = domain.sheetTransfer;
  if (!csv) throw new Error("sheetTransfer domain missing");
  const runner = () => OWEH.get("runner")?.api;
  const PLAN_KEY = "owehSheetDiscardPlan";
  const SOURCE_KEY = "owehSheetDiscardSource";
  const LIMIT_KEY = "owehSheetDiscardLimit";
  const PLAN_AGE_MS = 15 * 60 * 1000;
  const MAX_IN_RUN = 200;
  const MAX_FAILURES = 3;
  let exporting = false;
  let planning = false;

  function ui(selector) { return document.querySelector(selector); }
  function summary(message) {
    const node = ui("#oweh-sheet-preview");
    if (node && node.textContent !== message) node.textContent = message;
    setStatus(message);
  }
  function hasColors(pet) {
    return csv.COLOR_KEYS.every(key => /^#?[0-9a-f]{6}$/i.test(pet?.colors?.[key] || ""));
  }
  function signature(pet) {
    return csv.COLOR_KEYS.map(key => String(pet?.colors?.[key] || "").toUpperCase()).join("|");
  }
  function kindAt(id, live) {
    if (live.eggs.has(id)) return "egg";
    if (live.pets.has(id)) return "pet";
    return "";
  }
  async function liveState() {
    const [owned, hatchery] = await Promise.all([petFetch.readOwnedPetIds(), petFetch.readHatchery()]);
    if (owned.partial || hatchery.hatcherySeen !== true) throw new Error("Owned Overview/Hatchery is incomplete; no discard actions allowed");
    return {
      pets: new Set((owned.ids || []).map(String)),
      eggs: new Set((hatchery.eggIds || []).map(String)),
      unnamed: new Set((hatchery.unnamedIds || []).map(String))
    };
  }
  async function workerBusy() {
    const worker = await storageGet("owehWorker", null);
    return worker && Date.now() < Number(worker.leaseUntil || 0) ? String(worker.owner || "unknown") : "";
  }
  function downloadCsv(body) {
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ovipets-inventory-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // Snapshot of EVERY current owned pet + egg, not just pets previously indexed.
  // Unknown five-slot colors are fetched (3 parallel). Unreadable entries remain in
  // the CSV, explicitly marked missing-colors, never silently dropped.
  async function exportInventory() {
    if (exporting) return;
    exporting = true;
    try {
      const busy = await workerBusy();
      if (busy) throw new Error("Stop the active " + busy + " worker before exporting");
      summary("Inventory: reading all owned enclosures and the Hatchery...");
      const [catalog, hatchery, cached, fallbackOwner] = await Promise.all([
        petFetch.collectCatalog({ skipTab: () => false }),
        petFetch.readHatchery(),
        storageGet("owehPets", {}),
        storageGet("owehOwnUserId", null)
      ]);
      if (catalog.partial || hatchery.hatcherySeen !== true) throw new Error("Incomplete Overview/Hatchery read; CSV was not exported");
      const catalogMap = new Map((catalog.catalog || []).filter(pet => csv.validId(pet.id)).map(pet => [String(pet.id), pet]));
      const eggIds = new Set((hatchery.eggIds || []).map(String).filter(csv.validId));
      const ids = [...new Set([...catalogMap.keys(), ...eggIds])];
      const records = new Map();
      const unknown = [];
      for (const id of ids) {
        const base = cached[id] || {};
        const record = { ...base, ...catalogMap.get(id), id, colors: base.colors || catalogMap.get(id)?.colors };
        records.set(id, record);
        if (!hasColors(record) || !record.species) unknown.push(id);
      }
      const owner = catalog.ownUserId || fallbackOwner;
      let cursor = 0, failed = 0, scanned = 0;
      const readWorker = async () => {
        while (cursor < unknown.length) {
          const id = unknown[cursor++];
          const result = await petFetch.readPet(id, owner, { skipPedigree: false }).catch(() => null);
          if (result?.ok) {
            const before = records.get(id);
            records.set(id, { ...before, ...result.record, id, colors: result.record.colors || before.colors,
              enclosure: catalogMap.get(id)?.enclosure || (eggIds.has(id) ? "Hatchery" : before.enclosure) });
          } else failed++;
          scanned++;
          if (scanned % 50 === 0) summary("Inventory: reading missing color profiles " + scanned + "/" + unknown.length + "...");
          if (typeof sleep === "function") await sleep(150);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, unknown.length) }, readWorker));
      const rows = ids.map(id => {
        const record = records.get(id);
        const kind = eggIds.has(id) ? "egg" : "pet";
        return csv.inventoryRow(record, kind, id);
      });
      rows.sort((a, b) => a.Kind.localeCompare(b.Kind) || a.ID.localeCompare(b.ID, undefined, { numeric: true }));
      const incomplete = rows.filter(row => row.DataStatus !== "complete").length;
      downloadCsv(csv.serialize(rows));
      summary("Inventory exported: " + rows.length + " IDs (" + eggIds.size + " eggs, "
        + (rows.length - eggIds.size) + " pets), " + incomplete + " incomplete-color rows; "
        + failed + " profile read failures. Import CSV into Google Sheets as plain-text IDs.");
    } catch (error) {
      summary("Inventory export failed: " + (error?.message || error));
      throw error;
    } finally {
      exporting = false;
    }
  }

  async function getSource() {
    const input = ui("#oweh-sheet-url");
    const file = ui("#oweh-sheet-file")?.files?.[0] || null;
    const pasted = String(ui("#oweh-sheet-ids")?.value || "").trim();
    const url = String(input?.value || "").trim();
    const count = Number(Boolean(file)) + Number(Boolean(url)) + Number(Boolean(pasted));
    if (count !== 1) throw new Error("Choose exactly one source: CSV file, published Sheets URL or pasted IDs");
    if (file) {
      if (file.size > 2_000_000) throw new Error("Local CSV exceeds 2 MB");
      return { text: await file.text(), source: "CSV file: " + file.name.slice(0, 100) };
    }
    if (url) {
      const result = await runtimeRequest({ type: "sheetCsvFetch", url });
      if (!result?.ok) throw new Error(result?.error || "Google Sheets CSV unavailable");
      await storageSet({ [SOURCE_KEY]: url });
      return { text: result.text, source: "Published Google Sheets CSV" };
    }
    return { text: pasted, source: "Pasted IDs" };
  }

  function showPlan(plan) {
    if (!plan) return summary("No ID discard list loaded");
    const queue = (plan.rows || []).filter(row => row.status === "queued");
    const other = (plan.rows || []).filter(row => row.status !== "queued");
    const expired = Date.now() - Number(plan.createdAt) > PLAN_AGE_MS;
    const detail = queue.slice(0, 12).map(row => row.id + " (" + row.kind + ")").join(", ");
    summary("ID discard list: " + queue.length + " queued, " + other.length + " processed, "
      + Number(plan.missing || 0) + " not currently owned/visible. Source: " + plan.source
      + (expired ? " · EXPIRED, load again" : "")
      + (detail ? " · first IDs: " + detail : ""));
  }
  async function preview() {
    if (planning) return;
    planning = true;
    try {
      const busy = await workerBusy();
      if (busy) throw new Error("The shared worker is busy: " + busy);
      summary("Loading the selected list and checking currently owned IDs...");
      const source = await getSource();
      const ids = csv.selectedIds(source.text);
      const live = await liveState();
      const records = await getPetsByIds(ids);
      const rows = [];
      let missing = 0;
      for (const id of ids) {
        const kind = kindAt(id, live);
        if (!kind) { missing++; continue; }
        const record = records[id] || {};
        rows.push({ id, kind, species: record.species || "", name: record.name || "",
          colors: signature(record), status: "queued" });
      }
      if (!rows.length) throw new Error("None of the selected IDs is currently owned or a current Hatchery egg");
      const plan = { createdAt: Date.now(), source: source.source, requested: ids.length,
        missing, rows, confirmedAt: 0 };
      await storageSet({ [PLAN_KEY]: plan });
      showPlan(plan);
    } catch (error) {
      if (!(await workerBusy())) await storageSet({ [PLAN_KEY]: null });
      summary("ID list rejected: " + (error?.message || error));
      throw error;
    } finally {
      planning = false;
    }
  }

  // Once the user confirms this reviewed snapshot, a bounded number of commands
  // are sent automatically through the existing confirmed-discard page bridge.
  async function confirm() {
    const plan = await storageGet(PLAN_KEY, null);
    if (!plan?.rows?.some(row => row.status === "queued")) throw new Error("No queued IDs; load and review a sheet first");
    if (Date.now() - Number(plan.createdAt || 0) > PLAN_AGE_MS) throw new Error("List expired: re-check the sheet and preview again");
    await storageSet({ [PLAN_KEY]: { ...plan, confirmedAt: plan.createdAt } });
    return job.request();
  }

  const job = runner().createJob({
    owner: "sheet-discard",
    label: "Discard ID list",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      const plan = await storageGet(PLAN_KEY, null);
      if (!plan || plan.confirmedAt !== plan.createdAt ||
        Date.now() - Number(plan.createdAt || 0) > PLAN_AGE_MS) {
        status("ID discard: plan missing, unconfirmed or expired"); return;
      }
      const stillCurrent = async () => (await storageGet(PLAN_KEY, null))?.createdAt === plan.createdAt;
      const save = async () => { if (await stillCurrent()) await storageSet({ [PLAN_KEY]: plan }); };
      const requestedLimit = Number(await storageGet(LIMIT_KEY, 25));
      const limit = Number.isInteger(requestedLimit) ? Math.min(MAX_IN_RUN, Math.max(1, requestedLimit)) : 25;
      const live = await liveState();
      const previous = await getPetsByIds(plan.rows.map(row => row.id));
      let attempts = 0, failures = 0;
      // "sent" means the bridge may have delivered the command. Never re-send
      // a timed-out ID blindly; verify against fresh game lists instead.
      async function reconcile() {
        const fresh = await liveState();
        let gone = 0;
        const updates = {};
        for (const row of plan.rows) {
          if (row.status !== "sent") continue;
          if (!kindAt(row.id, fresh) && !fresh.unnamed.has(row.id)) {
            row.status = "discarded"; gone++;
            updates[row.id] = { id: row.id, present: false, retentionDiscardedAt: Date.now(),
              retentionDiscardReason: "explicit-id-list" };
          } else row.status = "unverified";
        }
        if (Object.keys(updates).length) await storageSet({ owehPets: updates });
        await save();
        return gone;
      }
      if (plan.rows.some(row => row.status === "sent")) await reconcile();
      phase("ID discard · verified owned IDs");
      for (const row of plan.rows) {
        if (isCancelled() || attempts >= limit) break;
        if (row.status !== "queued") continue;
        if (!(await stillCurrent())) { status("ID discard: reviewed list changed; stopping"); break; }
        if (!(await isWorkerOwner("sheet-discard"))) { status("ID discard: worker lease lost"); break; }
        if (kindAt(row.id, live) !== row.kind) {
          row.status = "skipped"; row.reason = "not-current-owned-kind"; await save(); continue;
        }
        if (row.colors !== signature(previous[row.id] || {})) {
          row.status = "skipped"; row.reason = "color-snapshot-changed"; await save(); continue;
        }
        const result = await gameActions.discardPet(row.id);
        // A timed-out command might have succeeded: mark as sent, never retry it automatically.
        if (result?.ok || /^(?:bridge-timeout|command-timeout)$/.test(String(result?.reason || ""))) {
          row.status = "sent";
        } else {
          row.status = "error";
          row.reason = result?.reason || "command-failed";
        }
        attempts++;
        failures = result?.ok ? 0 : failures + 1;
        await save();
        status("ID discard: " + attempts + "/" + limit + " commands attempted; " + failures + " consecutive errors");
        if (failures >= MAX_FAILURES) break;
        await sleep(settings.DEFAULT_REQUEST_DELAY);
      }
      try {
        const gone = await reconcile();
        status("ID discard verified: " + gone + " removed in this check; "
          + plan.rows.filter(row => row.status === "queued").length + " queued; "
          + plan.rows.filter(row => row.status === "unverified").length
          + " unverified (never retried automatically).");
      } catch (error) {
        await save();
        status("ID discard sent commands but could not verify the live result: "
          + (error?.message || error) + ". Sent IDs will not be resent automatically.");
      }
    }
  });

  const storedUrl = storageGet(SOURCE_KEY, "").then(value => {
    const box = ui("#oweh-sheet-url");
    if (box && !box.value && value) box.value = value;
  }).catch(() => {});
  function hydrate() {
    storedUrl.catch(() => {});
    storageGet(PLAN_KEY, null).then(plan => {
      const node = ui("#oweh-sheet-preview");
      if (node && node.textContent.startsWith("No ID")) showPlan(plan);
    }).catch(() => {});
    const loadingControl = ui("#oweh-sheet-limit");
    if (loadingControl && !loadingControl.dataset.initialized) loadingControl.dataset.initialized = "loading";
    storageGet(LIMIT_KEY, 25).then(value => {
      const control = ui("#oweh-sheet-limit");
      if (control && control.dataset.initialized === "loading") {
        control.value = String(Math.min(MAX_IN_RUN, Math.max(1, Number(value) || 25)));
        control.dataset.initialized = "1";
        control.addEventListener("change", async () => {
          const limit = Math.min(MAX_IN_RUN, Math.max(1, Math.floor(Number(control.value) || 25)));
          control.value = String(limit);
          await storageSet({ [LIMIT_KEY]: limit });
        });
      }
    }).catch(() => {});
  }
  const refresh = () => {
    const url = ui("#oweh-sheet-url");
    if (url && !url.dataset.initialized) {
      url.dataset.initialized = "1";
      storageGet(SOURCE_KEY, "").then(value => { if (!url.value) url.value = String(value || ""); }).catch(() => {});
    }
    const limit = ui("#oweh-sheet-limit");
    if (limit && !limit.dataset.initialized) hydrate();
  };

  return {
    api: { exportInventory, preview, confirm, stop: job.stop },
    onRefresh: refresh,
    workerHandlers: { "sheet-discard": job.workerHandler },
    buttons: {
      "#oweh-export-inventory": { label: "Exporting all owned pets and eggs", handler: exportInventory },
      "#oweh-sheet-preview-button": { label: "Checking selected IDs", handler: preview },
      "#oweh-sheet-confirm-button": { label: "Discarding reviewed IDs", handler: confirm },
      "#oweh-sheet-stop-button": { label: "Stopping ID discard", handler: job.stop }
    }
  };
});
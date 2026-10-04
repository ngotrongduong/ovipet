"use strict";

// Discard surplus (2026-10-05): one review for hatched pets and eggs, replacing the male-only
// cull and the separate "Discard poor eggs" button. "Plan discard" is read-only: it reads the
// live Overview and Hatchery, runs domain/surplus.js over the pet database and saves a review
// (owehSurplusPreview). Nothing is sent. "Confirm & discard" stamps that review and starts a
// one-button shared-worker job that sends OviPets' own Edit > Send To > Discard command for
// exactly the reviewed rows.
//
// Discarding is permanent, so the run trusts OviPets, not the database:
//   - the list is rebuilt from what OviPets lists right now, and a row is sent only if it is
//     still surplus there (a replacement sold or discarded by hand no longer counts);
//   - "sent" is not "discarded": a row becomes discarded only once OviPets no longer lists it,
//     and sent rows are settled before any plan can be replaced, dismissed or expire;
//   - whether a run is alive is decided by the shared-worker lease alone (jobs/runner.js), so
//     Stop or a closed tab leaves no "running" flag behind.
OWEH.register("feature-surplus", helpers => {
  const { storageGet, storageSet, setStatus, sleep, isWorkerOwner, domain, gameActions, settings, petFetch } = helpers;
  const { colors } = domain;
  const surplus = domain.surplus || globalThis.OWEH?.domain?.surplus;
  if (!surplus?.planSurplus) throw new Error("feature-surplus requires domain.surplus");
  // Same freshness rule as the breeding preview: the review reflects the game at planning time.
  const PREVIEW_MAX_AGE_MS = 15 * 60 * 1000;
  // The command was read from the live dialog but a run cannot be rehearsed: stop instead of
  // working through the whole list when OviPets does not answer it, and keep a run short
  // until the user raises the limit (0 = the whole list).
  const MAX_CONSECUTIVE_FAILURES = 3;
  const DEFAULT_LIMIT = 5;
  const MIN_REPLACEMENT_CHOICES = Object.freeze([20, 10, 5, 3]);
  // A command that timed out may still have landed: it counts as sent until OviPets' own
  // lists say otherwise. Any other failure was refused before reaching the game.
  const UNANSWERED = /^(?:bridge-timeout|command-timeout)$/;
  let planning = false;

  async function runIsLive() {
    const worker = await storageGet("owehWorker", null);
    return Boolean(worker) && worker.owner === "surplus" && Date.now() < Number(worker.leaseUntil || 0);
  }

  async function readMinReplacements() {
    const stored = Number(await storageGet("owehSurplusMinReplacements", surplus.DEFAULT_MIN_REPLACEMENTS));
    return MIN_REPLACEMENT_CHOICES.includes(stored) ? stored : surplus.DEFAULT_MIN_REPLACEMENTS;
  }

  async function readLimit() {
    const stored = Number(await storageGet("owehSurplusLimit", DEFAULT_LIMIT));
    return Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : DEFAULT_LIMIT;
  }

  async function readProtectedIds() {
    const [preview, queue, campaign] = await Promise.all([
      storageGet("owehBreedPreview", null),
      storageGet("owehBreedQueue", []),
      storageGet("owehBreedCampaign", { active: false })
    ]);
    return surplus.protectedIdsFromQueues(preview?.queue, campaign?.active ? queue : []);
  }

  // What OviPets lists right now, or null when any part of it cannot be trusted (an enclosure
  // that failed to load, a Hatchery answer without its section). Read-only.
  async function readLive() {
    try {
      const [owned, hatchery] = await Promise.all([petFetch.readOwnedPetIds(), petFetch.readHatchery()]);
      if (owned.partial || hatchery.hatcherySeen !== true) return null;
      const set = list => new Set((list || []).map(String));
      return { pets: set(owned.ids), eggs: set(hatchery.eggIds), unnamed: set(hatchery.unnamedIds) };
    } catch {
      return null;
    }
  }

  // The pet database with presence taken from the live Overview, so a pet sold or discarded
  // by hand since the last Update database neither gets listed nor counts as a replacement.
  function liveView(pets, live) {
    const view = {};
    for (const [key, pet] of Object.entries(pets || {})) {
      view[key] = { ...pet, present: live.pets.has(String(pet?.id ?? key)) };
    }
    return view;
  }

  function planFromLive(pets, live, { target, minReplacements, tolerance, protectedIds }) {
    return surplus.planSurplus(liveView(pets, live), target, {
      eggIds: [...live.eggs], minReplacements, tolerance, protectedIds
    });
  }

  // Decides every "sent" row from what OviPets lists now: no longer listed means discarded.
  // An egg that hatched instead shows up as an unnamed newborn or a pet and was not discarded.
  async function settleSent(rows, live) {
    const gone = {};
    const tally = { discarded: 0, stillPresent: 0 };
    for (const row of rows || []) {
      if (row.status !== "sent") continue;
      const id = String(row.id);
      const listed = live.pets.has(id) || (row.kind === "egg" && (live.eggs.has(id) || live.unnamed.has(id)));
      if (listed) {
        row.status = "error";
        row.error = row.error || "still-present";
        tally.stillPresent += 1;
      } else {
        row.status = "discarded";
        delete row.error;
        tally.discarded += 1;
        gone[id] = { id, present: false, retentionDiscardedAt: Date.now(), retentionDiscardReason: "surplus" };
      }
    }
    if (Object.keys(gone).length) await storageSet({ owehPets: gone });
    return tally;
  }

  const kindCounts = counts => `${Number(counts?.egg || 0)} egg(s), ${Number(counts?.female || 0)} female(s), ${Number(counts?.male || 0)} male(s)`;

  async function plan() {
    if (planning) return;
    planning = true;
    try {
      if (await runIsLive()) {
        setStatus("Discard is running right now — press Stop first");
        return;
      }
      const pets = await storageGet("owehPets", {});
      if (!Object.keys(pets).length) {
        setStatus("Discard plan: the pet database is empty — run Update database first");
        return;
      }
      setStatus("Discard plan: reading the live Overview and Hatchery...");
      const live = await readLive();
      if (!live) {
        setStatus("Discard plan: the Overview or the Hatchery could not be read completely — nothing was planned");
        return;
      }
      // Rows an earlier run sent but never verified are settled before their plan is replaced.
      const previous = await storageGet("owehSurplusPreview", null);
      if (previous?.rows?.some(row => row.status === "sent")) await settleSent(previous.rows, live);
      const minReplacements = await readMinReplacements();
      const target = { ...colors.STRICT_PURE_TARGET };
      const result = planFromLive(pets, live, { target, minReplacements, protectedIds: await readProtectedIds() });
      await storageSet({
        owehSurplusPreview: {
          createdAt: Date.now(),
          target,
          minReplacements,
          rows: result.rows.map(row => ({ ...row, status: "queued" })),
          summary: result.summary
        }
      });
      const s = result.summary;
      const held = [
        s.generated ? `${s.generated} Generated kept` : "",
        s.unchecked ? `${s.unchecked} not yet checked for Generated — run Update database, then plan again` : "",
        s.protected ? `${s.protected} kept for the breed queue` : "",
        s.eggsNotIndexed ? `${s.eggsNotIndexed} egg(s) not in the database yet — run Newborns only to index them` : ""
      ].filter(Boolean).join(" · ");
      const next = result.rows.length
        ? " — nothing sent yet. Open View discard list, then press Confirm & discard."
        : " — nothing to discard.";
      setStatus(`Discard plan: ${result.rows.length} can go (${kindCounts(s.surplus)}) out of ${kindCounts(s.considered)}, each with ≥${minReplacements} kept pets at least as good in every colour channel${held ? ` · ${held}` : ""}${next}`);
    } finally {
      planning = false;
    }
  }

  async function dismiss() {
    if (await runIsLive()) {
      setStatus("Discard is running right now — press Stop first");
      return;
    }
    const previous = await storageGet("owehSurplusPreview", null);
    if (previous?.rows?.some(row => row.status === "sent")) {
      const live = await readLive();
      if (live) await settleSent(previous.rows, live);
    }
    await storageSet({ owehSurplusPreview: null });
    setStatus("Discard plan dismissed — nothing more will be sent");
  }

  // Why a reviewed row must not be sent after all, or null.
  function skipReason(row, pet, live, protectedIds, stillSurplus) {
    const id = String(row.id);
    if (!pet || pet.owned === false) return "not-in-database";
    if (row.kind === "egg") {
      if (!live.eggs.has(id)) return "no-longer-an-egg";
    } else if (!live.pets.has(id)) {
      return "gone";
    }
    if (protectedIds.has(id)) return "in-breeding-plan";
    if (pet.generated === true) return "generated";
    if (row.kind !== "egg" && pet.generated !== false) return "generated-unchecked";
    if (surplus.colorKey(pet) !== row.colors) return "colors-changed";
    if (row.kind !== "egg" && String(pet.gender || "").toLowerCase() !== row.kind) return "sex-changed";
    return stillSurplus.has(id) ? null : "no-longer-surplus";
  }

  const job = OWEH.get("runner").api.createJob({
    owner: "surplus",
    label: "Discard surplus",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      const preview = await storageGet("owehSurplusPreview", null);
      const rows = preview?.rows || [];
      const pending = () => rows.some(row => row.status === "queued" || row.status === "sent");
      if (!pending()) {
        status("Discard: nothing queued — press Plan discard first");
        return;
      }
      const stillOurs = async () => Number((await storageGet("owehSurplusPreview", null))?.createdAt) === Number(preview.createdAt);
      // Never written over a plan that replaced this one.
      const save = async () => {
        if (!(await stillOurs())) return;
        await storageSet({ owehSurplusPreview: { ...preview, rows, updatedAt: Date.now(), finishedAt: pending() ? null : Date.now() } });
      };
      const counts = { discarded: 0, stillPresent: 0, skipped: 0, errors: 0 };
      const settle = async current => {
        const tally = await settleSent(rows, current);
        counts.discarded += tally.discarded;
        counts.stillPresent += tally.stillPresent;
        await save();
      };

      phase("discard · checking");
      status("Discard: checking the live Overview and Hatchery...");
      const live = await readLive();
      if (!live) {
        status("Discard: the Overview or the Hatchery could not be read completely — nothing was sent");
        return;
      }
      // Whatever an earlier run sent is settled first, so no exit below can drop it unverified.
      if (rows.some(row => row.status === "sent")) await settle(live);
      if (Number(preview.confirmedPlan) !== Number(preview.createdAt)) {
        status("Discard: this plan was not confirmed — review it, then press Confirm & discard");
        return;
      }
      if (Date.now() - Number(preview.createdAt || 0) > PREVIEW_MAX_AGE_MS) {
        if (await stillOurs()) await storageSet({ owehSurplusPreview: null });
        status("The discard plan is older than 15 minutes and was thrown away — plan it again");
        return;
      }

      const limit = await readLimit();
      const protectedIds = await readProtectedIds();
      const pets = await storageGet("owehPets", {});
      const stillSurplus = new Set(planFromLive(pets, live, {
        target: preview.target,
        minReplacements: preview.minReplacements,
        tolerance: preview.summary?.tolerance,
        protectedIds
      }).rows.map(row => String(row.id)));

      const total = rows.filter(row => row.status === "queued").length;
      const missing = {};
      let dispatched = 0;
      let failures = 0;
      let stopped = "";
      try {
        for (const row of rows) {
          if (row.status !== "queued") continue;
          if (isCancelled() || (limit && dispatched >= limit)) break;
          const skip = skipReason(row, pets[row.id], live, protectedIds, stillSurplus);
          if (skip) {
            row.status = "skipped";
            row.error = skip;
            counts.skipped += 1;
            // A hatched pet the Overview no longer lists is gone, whatever the database says.
            if (skip === "gone") missing[row.id] = { id: String(row.id), present: false };
            continue;
          }
          // Last look before a permanent command: a lost lease or Stop ends the run here.
          if (!(await isWorkerOwner("surplus"))) {
            stopped = "this tab no longer holds the shared background tab";
            break;
          }
          if (isCancelled()) break;
          const result = await gameActions.discardPet(row.id);
          const reason = String(result?.reason || "command-failed");
          if (result?.ok || UNANSWERED.test(reason)) {
            row.status = "sent";
            if (!result?.ok) row.error = reason;
            dispatched += 1;
          } else {
            row.status = "error";
            row.error = reason;
            counts.errors += 1;
          }
          failures = result?.ok ? 0 : failures + 1;
          // Durable after every command: a row that was sent is never left "queued".
          await save();
          phase(`discard ${dispatched}/${limit ? Math.min(limit, total) : total}`);
          status(`Discard: ${dispatched} sent · ${counts.skipped} skipped · ${counts.errors} error(s)`);
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            stopped = `OviPets did not confirm ${failures} discard commands in a row (${reason})`;
            break;
          }
          await sleep(settings.DEFAULT_REQUEST_DELAY);
        }
        if (Object.keys(missing).length) await storageSet({ owehPets: missing });

        if (rows.some(row => row.status === "sent")) {
          phase("discard · verifying");
          status("Discard: verifying against the live Overview and Hatchery...");
          await sleep(500);
          const after = await readLive();
          if (after) await settle(after);
        }
      } finally {
        await save();
      }
      const unverified = rows.filter(row => row.status === "sent").length;
      const remaining = rows.filter(row => row.status === "queued").length;
      status(`Discard ${isCancelled() ? "stopped" : "finished"}: ${counts.discarded} confirmed gone`
        + (unverified ? `, ${unverified} sent but not verified yet — Confirm & discard or Plan discard checks them` : "")
        + (counts.stillPresent ? `, ${counts.stillPresent} still present` : "")
        + (counts.skipped ? `, ${counts.skipped} skipped` : "")
        + (counts.errors ? `, ${counts.errors} error(s)` : "")
        + (stopped ? ` · stopped early: ${stopped}` : "")
        + (remaining ? ` · ${remaining} still queued — Confirm & discard continues` : ""));
    }
  });

  // The click is the confirmation: it stamps the plan the user is looking at, and the job
  // refuses a plan without that stamp (one rebuilt after the click was never reviewed).
  async function confirm() {
    if (await runIsLive()) return job.request();
    const preview = await storageGet("owehSurplusPreview", null);
    if (!preview?.rows?.some(row => row.status === "queued" || row.status === "sent")) {
      setStatus("Discard: nothing queued — press Plan discard first");
      return;
    }
    await storageSet({ owehSurplusPreview: { ...preview, confirmedPlan: preview.createdAt } });
    return job.request();
  }

  return {
    api: { plan, dismiss, confirm, stop: job.stop, DEFAULT_LIMIT, MIN_REPLACEMENT_CHOICES },
    workerHandlers: { surplus: job.workerHandler },
    buttons: {
      "#oweh-surplus-plan": { label: "Planning discard", handler: plan },
      "#oweh-surplus-dismiss": { label: "Dismissing discard plan", handler: dismiss },
      "#oweh-surplus-confirm": { label: "Starting Discard surplus", handler: confirm },
      "#oweh-surplus-stop": { label: "Stopping Discard surplus", handler: job.stop }
    }
  };
});

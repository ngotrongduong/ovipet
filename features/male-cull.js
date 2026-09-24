"use strict";

// v5.6.0 male cull. "Plan cull" is database-only: it runs domain/male-cull.js over the cached
// pet database and saves a review (owehCullPreview) — nothing is moved. "Confirm cull" is a
// one-button shared-worker job that moves exactly the reviewed males into the Males discard
// enclosure through the real pets_enclosure command. The extension never deletes or sells a
// pet; emptying Males discard stays a manual, in-game decision.
OWEH.register("feature-male-cull", helpers => {
  const { storageGet, storageSet, getPetsByIds, setStatus, sleep, domain, gameActions, settings } = helpers;
  const { colors, breedingPlan } = domain;
  const maleCull = domain.maleCull || globalThis.OWEH?.domain?.maleCull;
  if (!maleCull?.planMaleCull) throw new Error("feature-male-cull requires domain.maleCull");
  const CULL_ENCLOSURE = breedingPlan.CULL_ENCLOSURE;
  // Same freshness rule as the breeding preview: the review reflects the database at planning time.
  const PREVIEW_MAX_AGE_MS = 15 * 60 * 1000;
  // A run writes progress after every male; a "running" flag older than this is a leftover from
  // a closed tab and must not block Plan/Discard forever.
  const RUNNING_STALE_MS = 60 * 1000;
  let planning = false;

  const isRunning = preview => Boolean(preview?.running) && Date.now() - Number(preview.updatedAt || 0) < RUNNING_STALE_MS;

  function resolveEnclosureId(enclosureIds, label) {
    const wanted = breedingPlan.normalizeEnclosureLabel(label);
    const key = Object.keys(enclosureIds || {}).find(name => breedingPlan.normalizeEnclosureLabel(name) === wanted);
    return key === undefined ? null : String(enclosureIds[key]);
  }

  async function readProtectedIds() {
    const [preview, queue, campaign] = await Promise.all([
      storageGet("owehBreedPreview", null),
      storageGet("owehBreedQueue", []),
      storageGet("owehBreedCampaign", { active: false })
    ]);
    return maleCull.protectedMaleIds(preview?.queue, campaign?.active ? queue : []);
  }

  async function plan() {
    if (planning) return;
    planning = true;
    try {
      if (isRunning(await storageGet("owehCullPreview", null))) {
        setStatus("Male cull is moving males right now — press Stop first");
        return;
      }
      const pets = await storageGet("owehPets", {});
      if (!Object.keys(pets).length) {
        setStatus("Male cull: the pet database is empty — run Update database first");
        return;
      }
      const target = { ...colors.STRICT_PURE_TARGET };
      const result = maleCull.planMaleCull(pets, target, { protectedIds: await readProtectedIds() });
      const enclosureId = resolveEnclosureId(await storageGet("owehEnclosureIds", {}), CULL_ENCLOSURE);
      const now = Date.now();
      await storageSet({
        owehCullPreview: {
          createdAt: now,
          target,
          enclosureMissing: enclosureId === null,
          rows: result.cull.map(row => ({ ...row, status: "queued" })),
          summary: result.summary
        }
      });
      const missing = Object.entries(result.summary.coverage || {})
        .filter(([, row]) => row.missing.length)
        .map(([name, row]) => `${name}: ${row.missing.join(", ")}`);
      const coverageText = missing.length ? ` · no exact pet yet for ${missing.join(" | ")}` : " · every target channel has an exact pet";
      const enclosureText = enclosureId === null
        ? ` · enclosure "${CULL_ENCLOSURE}" is not in the database yet — run Update database before confirming`
        : "";
      setStatus(`Male cull plan: ${result.cull.length} of ${result.summary.considered} male(s) are covered by ≥${result.summary.minDominators} better males from different lineages${coverageText}${enclosureText} — nothing moved yet. Review it and press Confirm cull.`);
    } finally {
      planning = false;
    }
  }

  async function discard() {
    if (isRunning(await storageGet("owehCullPreview", null))) {
      setStatus("Male cull is moving males right now — press Stop first");
      return;
    }
    await storageSet({ owehCullPreview: null });
    setStatus("Male cull plan discarded — nothing was moved");
  }

  const job = OWEH.get("runner").api.createJob({
    owner: "cull",
    label: "Male cull",
    url: "https://ovipets.com/#!/?src=pets&sub=overview",
    async run({ isCancelled, phase, status }) {
      const preview = await storageGet("owehCullPreview", null);
      const queued = (preview?.rows || []).filter(row => row.status === "queued");
      if (!queued.length) {
        status("Male cull: nothing to move — press Plan cull first");
        return;
      }
      if (!preview.running && Date.now() - Number(preview.createdAt || 0) > PREVIEW_MAX_AGE_MS) {
        await storageSet({ owehCullPreview: null });
        status("Male cull plan is older than 15 minutes and was discarded — plan it again");
        return;
      }
      const enclosureIds = await storageGet("owehEnclosureIds", {});
      const enclosureId = resolveEnclosureId(enclosureIds, CULL_ENCLOSURE);
      if (enclosureId === null) {
        status(`Male cull: enclosure "${CULL_ENCLOSURE}" is not in the database — create it in OviPets, run Update database, then confirm again. Nothing moved.`);
        return;
      }
      const protectedIds = await readProtectedIds();
      const rows = preview.rows;
      const save = extra => storageSet({ owehCullPreview: { ...preview, rows, updatedAt: Date.now(), ...extra } });
      await save({ running: true, enclosureMissing: false });
      const counts = { moved: 0, skipped: 0, errors: 0 };
      try {
        for (let index = 0; index < rows.length; index += 1) {
          if (isCancelled()) break;
          const row = rows[index];
          if (row.status !== "queued") continue;
          // Plan cull / Discard replaced the review while this job ran: stop, never move stale rows.
          if (Number((await storageGet("owehCullPreview", null))?.createdAt) !== Number(preview.createdAt)) {
            status("Male cull stopped: the plan was replaced or discarded while moving");
            return;
          }
          const done = rows.filter(item => item.status !== "queued").length;
          phase(`cull ${done + 1}/${rows.length}`);
          const pet = (await getPetsByIds([row.id]))[row.id];
          if (!pet || pet.gender !== "Male" || pet.present === false || protectedIds.has(row.id)
            || breedingPlan.isCullEnclosure(pet.enclosure)) {
            row.status = "skipped";
            counts.skipped += 1;
          } else {
            status(`Male cull: moving ${row.name} → ${CULL_ENCLOSURE} (${done + 1}/${rows.length})`);
            const moved = await gameActions.fastMovePetToEnclosure(row.id, CULL_ENCLOSURE);
            if (moved.moved) {
              row.status = "moved";
              counts.moved += 1;
              await storageSet({ owehPets: { [row.id]: { id: row.id, enclosure: CULL_ENCLOSURE, enclosureId } } });
            } else {
              row.status = "error";
              row.error = moved.reason || "move-failed";
              counts.errors += 1;
            }
          }
          // Durable progress after every male, so the side window and a reload see the truth.
          await save({ running: true });
          await sleep(Math.max(500, settings.getDelayMs()));
        }
      } finally {
        if (Number((await storageGet("owehCullPreview", null))?.createdAt) === Number(preview.createdAt)) {
          const left = rows.filter(item => item.status === "queued").length;
          await save({ running: false, finishedAt: left ? null : Date.now() });
        }
      }
      const remaining = rows.filter(item => item.status === "queued").length;
      status(`Male cull ${isCancelled() ? "stopped" : "finished"}: moved ${counts.moved} to ${CULL_ENCLOSURE}${counts.skipped ? `, ${counts.skipped} skipped` : ""}${counts.errors ? `, ${counts.errors} error(s)` : ""}${remaining ? ` · ${remaining} still queued — Confirm cull resumes` : ""}`);
    }
  });

  return {
    api: { plan, discard, request: job.request, stop: job.stop, resolveEnclosureId },
    workerHandlers: { cull: job.workerHandler },
    buttons: {
      "#oweh-cull-plan": { label: "Planning male cull", handler: plan },
      "#oweh-cull-discard": { label: "Discarding male cull plan", handler: discard },
      ...job.buttons("#oweh-cull-confirm", "#oweh-cull-stop")
    }
  };
});

"use strict";

// Shared plumbing for "one button = one job" jobs that run in the shared background tab.
// A job is just { owner, label, url, run(ctx) }: this wrapper supplies the parts that used to
// be copy-pasted (and subtly different) per feature — claiming the shared tab, the busy
// message, waiting for the game to finish loading, cooperative cancellation, catching errors,
// and releasing the tab when the work ends.
//
// Jobs made with createJob keep NO persistent "active" flag in storage: whether one is
// running is decided only by the shared-worker lease, so there is nothing that can be left
// stuck `true` after a crash (the v5.0.1 bug class) and nothing a page reload can wrongly
// resume. Progress is shown via the lease's phase text.
OWEH.register("runner", helpers => {
  const { requestClaimWorker, requestReleaseWorker, reportWorkerPhase, reportWorkerDone, setStatus, waitForGameReady } = helpers;

  // opts.manualDone: the job hands work to a driver that reports completion itself (used only
  // by the profile refresh, which navigates pet to pet). Everything else is straight-line.
  function createJob({ owner, label, url, run, needsGame = true, manualDone = false }) {
    let stopped = false;
    let running = false;

    async function request() {
      setStatus(`Claiming the shared background tab for "${label}"...`);
      const response = await requestClaimWorker(owner, url);
      if (!response.ok) {
        setStatus(response.reason === "busy"
          ? `Shared background tab is busy running "${response.owner}" (${response.phase || "working"}) — stop it first, then try again`
          : `Could not start "${label}"${response.error ? `: ${response.error}` : ""}`);
        return;
      }
      setStatus(response.alreadyRunning
        ? `"${label}" is already running in the shared background tab`
        : `"${label}" started in the shared background tab`);
    }

    async function stop() {
      await requestReleaseWorker(owner);
      setStatus(`"${label}" stopped`);
    }

    async function start(generation, extra) {
      if (running) return;
      running = true;
      stopped = false;
      let finishedNormally = false;
      try {
        if (needsGame && !(await waitForGameReady())) {
          setStatus(`"${label}": OviPets did not finish loading in time — nothing was changed`);
          return;
        }
        if (stopped) return;
        await run({
          generation,
          extra: extra || {},
          isCancelled: () => stopped,
          phase: text => reportWorkerPhase(text),
          status: setStatus
        });
        finishedNormally = true;
      } catch (error) {
        console.error(`[OviPets Helper] job "${owner}" failed`, error);
        setStatus(`"${label}" failed: ${error?.message || error}`);
      } finally {
        running = false;
        if (!stopped && !(manualDone && finishedNormally)) reportWorkerDone();
      }
    }

    return {
      owner,
      label,
      request,
      stop,
      workerHandler: { start, stop: () => { stopped = true; } },
      buttons: (startSelector, stopSelector) => ({
        [startSelector]: { label: `Starting ${label}`, handler: request },
        [stopSelector]: { label: `Stopping ${label}`, handler: stop }
      })
    };
  }

  return { api: { createJob } };
});

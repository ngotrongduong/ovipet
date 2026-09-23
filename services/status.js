"use strict";

// The panel status line. setStatus() writes #oweh-status and logs alert-like lines to the
// diagnostic log; reportWorkerDone() publishes the last line as a cross-tab notice before the
// shared worker tab is released, so the tab where the user pressed the button can see why the
// job ended.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/status.js");

  function createStatus(deps) {
    const { diagnosticLog, storageSet, workerClient, releaseFinishedWorker } = deps;
    let lastDiagnosticStatusText = "";
    let lastStatusText = "";

    function setStatus(text) {
      const el = document.querySelector("#oweh-status");
      if (el && el.textContent !== text) el.textContent = text;
      const value = String(text || "");
      if (value) lastStatusText = value;
      const diagnosticValue = value
        .replace(/\b0\s+(?:failed|timeouts?|errors?|aborted)\b/ig, "")
        .replace(/\b0\s+timed\s+out\b/ig, "");
      if (value && value !== lastDiagnosticStatusText && /(failed|stopped|timeout|timed out|interrupted|could not|error|busy|lost|aborted)/i.test(diagnosticValue)) {
        lastDiagnosticStatusText = value;
        diagnosticLog("warning", "status", "status.alert", { text: value });
      }
    }

    // The shared worker tab closes as soon as its job reports done, taking its final status line
    // with it. Publish that line through the cross-tab notice first so the tab where the user
    // pressed the button can show why the job ended (e.g. "no breedable females").
    function reportWorkerDone() {
      if (workerClient.getOwner() != null && lastStatusText) {
        void storageSet({ owehSweepNotice: { text: lastStatusText, at: Date.now() } });
      }
      releaseFinishedWorker();
    }

    return { setStatus, reportWorkerDone };
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.status = Object.freeze({ createStatus });
})();

"use strict";

// Content-side Diagnostic Logbook client. The durable ring buffer lives in the service worker
// (bg/diagnostic-log.js); this only appends events and drives the panel's Export/Clear/Summary.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before services/diagnostics.js");

  function createDiagnostics(deps) {
    const { runtimeRequest, isExtensionContextInvalidated, setStatus } = deps;

    function diagnosticLog(level, source, event, data = {}) {
      if (isExtensionContextInvalidated?.()) {
        return Promise.resolve({ ok: false, error: "extension-context-invalidated", contextInvalidated: true });
      }
      return runtimeRequest({
        type: "diagnosticLogAppend",
        entry: {
          level, source, event,
          data: { ...data, route: typeof location !== "undefined" ? `${location.pathname}${location.hash || ""}`.slice(0, 500) : "" }
        }
      });
    }

    async function exportDiagnosticLog() {
      const result = await runtimeRequest({ type: "diagnosticLogExport" });
      if (!result.ok || !result.payload) throw new Error(result.error || "diagnostic-export-failed");
      const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `ovipets-diagnostic-log-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Diagnostic Log exported (${result.payload.summary?.total || 0} event(s))`);
      return result.payload;
    }

    async function clearDiagnosticLog() {
      const result = await runtimeRequest({ type: "diagnosticLogClear" });
      if (!result.ok) throw new Error(result.error || "diagnostic-clear-failed");
      setStatus("Diagnostic Log cleared");
    }

    async function getDiagnosticSummary() {
      const result = await runtimeRequest({ type: "diagnosticLogSummary" });
      return result.ok ? result.summary : { total: 0, counts: {}, last: null };
    }

    return Object.freeze({ diagnosticLog, exportDiagnosticLog, clearDiagnosticLog, getDiagnosticSummary });
  }

  OWEH.services = OWEH.services || {};
  OWEH.services.diagnostics = Object.freeze({ createDiagnostics });
})();

"use strict";

(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before core/storage-client.js");

  const INVALIDATED_ERROR = "extension-context-invalidated";
  let contextInvalidated = false;

  function errorMessage(error) {
    return String(error?.message || error || "unknown-error");
  }

  function isContextInvalidatedError(error) {
    return /extension context invalidated/i.test(errorMessage(error));
  }

  function invalidatedResult(error = null) {
    contextInvalidated = true;
    return {
      ok: false,
      error: INVALIDATED_ERROR,
      contextInvalidated: true,
      detail: error ? errorMessage(error).slice(0, 300) : undefined
    };
  }

  function runtimeRequest(message) {
    if (contextInvalidated) return Promise.resolve(invalidatedResult());
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          try {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              if (isContextInvalidatedError(lastError)) return resolve(invalidatedResult(lastError));
              return resolve({ ok: false, error: lastError.message || String(lastError) });
            }
            resolve(response || { ok: false, error: "empty-response" });
          } catch (error) {
            if (isContextInvalidatedError(error)) return resolve(invalidatedResult(error));
            resolve({ ok: false, error: errorMessage(error) });
          }
        });
      } catch (error) {
        if (isContextInvalidatedError(error)) return resolve(invalidatedResult(error));
        resolve({ ok: false, error: errorMessage(error) });
      }
    });
  }

  function localGet(defaults) {
    if (contextInvalidated) return Promise.resolve({ ...defaults });
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(defaults, values => {
          try {
            const lastError = chrome.runtime?.lastError;
            if (lastError) {
              if (isContextInvalidatedError(lastError)) {
                invalidatedResult(lastError);
                return resolve({ ...defaults });
              }
              return reject(new Error(lastError.message || String(lastError)));
            }
            resolve(values || { ...defaults });
          } catch (error) {
            if (isContextInvalidatedError(error)) {
              invalidatedResult(error);
              return resolve({ ...defaults });
            }
            reject(error);
          }
        });
      } catch (error) {
        if (isContextInvalidatedError(error)) {
          invalidatedResult(error);
          return resolve({ ...defaults });
        }
        reject(error);
      }
    });
  }

  function localSet(values) {
    if (contextInvalidated) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(values, () => {
          try {
            const lastError = chrome.runtime?.lastError;
            if (lastError) {
              if (isContextInvalidatedError(lastError)) {
                invalidatedResult(lastError);
                return resolve(false);
              }
              return reject(new Error(lastError.message || String(lastError)));
            }
            resolve(true);
          } catch (error) {
            if (isContextInvalidatedError(error)) {
              invalidatedResult(error);
              return resolve(false);
            }
            reject(error);
          }
        });
      } catch (error) {
        if (isContextInvalidatedError(error)) {
          invalidatedResult(error);
          return resolve(false);
        }
        reject(error);
      }
    });
  }

  async function storageGet(key, fallback) {
    // The pet database is authoritative. A failed read fails closed: the pre-migration
    // chrome.storage.local.owehPets map is stale (it can still list a culled male in "Males").
    if (key === "owehPets") {
      const result = await runtimeRequest({ type: "petDbGetAll" });
      if (result.ok) return result.pets || {};
      if (result.contextInvalidated) return fallback;
      throw new Error(result.error || "pet-db-get-all-failed");
    }
    const value = await localGet({ [key]: fallback });
    return value[key];
  }

  async function getPetsByIds(ids) {
    const result = await runtimeRequest({ type: "petDbGetMany", ids: [...new Set((ids || []).map(id => String(id || "")).filter(Boolean))] });
    if (result.contextInvalidated) return {};
    if (!result.ok) throw new Error(result.error || "pet-db-get-many-failed");
    return result.pets || {};
  }

  // Owned, present pets with only the requested fields (see bg/state-db.js getPetFields).
  async function getPetFields(fields, { gender = null } = {}) {
    const result = await runtimeRequest({ type: "petDbGetFields", fields, gender });
    if (result.contextInvalidated) return {};
    if (!result.ok) throw new Error(result.error || "pet-db-get-fields-failed");
    return result.pets || {};
  }

  async function storageSet(values) {
    const next = { ...values };
    if (next.owehPets) {
      const result = await runtimeRequest({ type: "petDbMerge", pets: next.owehPets });
      if (result.ok) delete next.owehPets;
      else if (result.contextInvalidated) return false;
      // Never write pet records to the legacy map, and never save the rest of this batch
      // (progress that describes those records) without them.
      else throw new Error(result.error || "pet-db-merge-failed");
    }
    if (!Object.keys(next).length) return true;
    return localSet(next);
  }

  async function storageGetMany(defaults) {
    return localGet(defaults);
  }

  function isExtensionContextInvalidated() {
    return contextInvalidated;
  }

  OWEH.core = OWEH.core || {};
  OWEH.core.storage = Object.freeze({
    runtimeRequest,
    storageGet,
    getPetsByIds,
    getPetFields,
    storageSet,
    storageGetMany,
    isExtensionContextInvalidated,
    isContextInvalidatedError
  });
})();

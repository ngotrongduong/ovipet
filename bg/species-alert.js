"use strict";

(() => {
  globalThis.OWEH_BG ||= {};
  if (OWEH_BG.speciesAlert) return;
  const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
  let creatingOffscreenDocument = null;

  async function ensureOffscreenDocument() {
    if (!chrome.offscreen?.createDocument) return false;
    const url = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const contexts = chrome.runtime.getContexts
      ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })
      : [];
    if (contexts.length) return true;
    if (!creatingOffscreenDocument) {
      creatingOffscreenDocument = chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play an alert when OviPets requires a manual species answer"
      }).finally(() => {
        creatingOffscreenDocument = null;
      });
    }
    await creatingOffscreenDocument;
    return true;
  }

  async function showSpeciesVerification(sender, playSound) {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (Number.isInteger(tabId)) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    if (Number.isInteger(windowId)) await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    if (playSound !== false && await ensureOffscreenDocument()) {
      chrome.runtime.sendMessage({ type: "playSpeciesAlert" }, () => void chrome.runtime.lastError);
    }
  }

  OWEH_BG.speciesAlert = { ensureOffscreenDocument, showSpeciesVerification };
})();

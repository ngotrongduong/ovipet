"use strict";

// Fetches only the OviPets credit-challenge image used by Name the Species. The isolated
// content world cannot reliably read pixels from app.ovipets.com because the DOM image may be
// both lazy-loaded and cross-origin. Fetching the exact image in the extension service worker
// (guarded by host_permissions + a strict URL allowlist) lets the content script build a local
// data URL and compute a perceptual fingerprint without weakening the page bridge.
(() => {
  globalThis.OWEH_BG ||= {};

  const MAX_IMAGE_BYTES = 1024 * 1024;
  const ALLOWED_HOSTS = new Set(["ovipets.com", "app.ovipets.com"]);

  function allowedSpeciesImageUrl(raw) {
    try {
      const url = new URL(String(raw || ""));
      if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return null;
      if (!/^\/img\/pet\/\d+\/credit-challenge\/?$/.test(url.pathname)) return null;
      return url;
    } catch {
      return null;
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const size = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += size) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
    }
    return btoa(binary);
  }

  async function fetchSpeciesImage(raw) {
    const url = allowedSpeciesImageUrl(raw);
    if (!url) return { ok: false, error: "invalid-species-image-url" };
    const response = await fetch(url.href, { credentials: "include", cache: "no-store" });
    if (!response.ok) return { ok: false, error: `species-image-http-${response.status}` };
    const type = String(response.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!/^image\//i.test(type)) return { ok: false, error: "species-image-not-image" };
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "species-image-size" };
    const dataUrl = `data:${type};base64,${bytesToBase64(new Uint8Array(buffer))}`;
    return { ok: true, dataUrl, source: url.href, bytes: buffer.byteLength };
  }

  globalThis.OWEH_BG.speciesImage = { allowedSpeciesImageUrl, fetchSpeciesImage };
})();

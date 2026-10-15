"use strict";

// Read only a deliberately published Google Sheets CSV. No OAuth token, cookies or
// credentials. A private spreadsheet is supported via local CSV export/import instead.
(() => {
  globalThis.OWEH_BG ||= {};
  function normalizeUrl(raw) {
    let url;
    try { url = new URL(String(raw || "").trim()); } catch { throw new Error("Invalid Google Sheets CSV URL"); }
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
      throw new Error("Only HTTPS docs.google.com spreadsheet CSV links are supported");
    }
    if (url.username || url.password || url.port || url.hash) throw new Error("Unexpected URL credentials or fragment");
    const path = url.pathname;
    const published = /^\/spreadsheets\/d\/e\/[A-Za-z0-9_-]+\/pub$/.test(path)
      && url.searchParams.get("output") === "csv";
    const exportUrl = /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/export$/.test(path)
      && url.searchParams.get("format") === "csv";
    if (!published && !exportUrl) {
      throw new Error("Use the published CSV link or Sheets File > Share > Publish to web > CSV");
    }
    for (const key of url.searchParams.keys()) {
      if (!["format", "output", "gid", "single"].includes(key)) throw new Error("Unexpected CSV URL parameter");
    }
    return url.toString();
  }
  async function load(url, fetcher = fetch) {
    const csvUrl = normalizeUrl(url);
    const response = await fetcher(csvUrl, { method: "GET", cache: "no-store", credentials: "omit", redirect: "follow" });
    if (!response.ok) throw new Error("Google Sheet could not be read (HTTP " + response.status + ")");
    const final = new URL(response.url || csvUrl);
    if (final.protocol !== "https:" ||
      !(final.hostname === "docs.google.com" || final.hostname === "googleusercontent.com"
        || final.hostname.endsWith(".googleusercontent.com"))) {
      throw new Error("CSV was redirected outside the permitted Google domain");
    }
    const size = Number(response.headers?.get?.("content-length") || 0);
    if (size > 2_000_000) throw new Error("Sheet CSV exceeds 2 MB");
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("Sheet CSV exceeds 2 MB");
    if (/^\s*<!doctype html|^\s*<html/i.test(body)) throw new Error("This sheet is private or not published as CSV");
    return body;
  }
  OWEH_BG.sheetCsv = Object.freeze({ normalizeUrl, load });
})();
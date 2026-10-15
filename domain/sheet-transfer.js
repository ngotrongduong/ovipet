"use strict";

// CSV is the interchange format: open it in Google Sheets, mark Discard=YES, export a
// CSV of that sheet, or supply a published CSV URL. No account tokens enter this module.
(() => {
  globalThis.OWEH = globalThis.OWEH || {};
  OWEH.domain = OWEH.domain || {};
  const COLOR_KEYS = ["body1", "body2", "scales", "extra1", "extra2"];
  const HEADERS = ["ID", "Kind", "Species", "Name", "Gender", "Enclosure", "Body1",
    "Body2", "Scales", "Extra1", "Extra2", "Generated", "PedigreeVerified",
    "ParentIDs", "DataStatus", "Discard"];
  const validId = value => /^[1-9]\d{0,19}$/.test(String(value || "").trim());
  function safeCell(value) {
    let cell = String(value == null ? "" : value);
    // Prevent spreadsheet formula interpretation of user-controlled text.
    if (/^\s*[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  function serialize(rows) {
    return "\uFEFF" + [HEADERS, ...rows.map(row => HEADERS.map(key => row[key] == null ? "" : row[key]))]
      .map(row => row.map(safeCell).join(",")).join("\r\n") + "\r\n";
  }
  function inventoryRow(record, kind, id) {
    const colors = record?.colors || {};
    const row = {
      ID: String(id), Kind: kind, Species: record?.species || "", Name: record?.name || "",
      Gender: kind === "egg" ? "" : record?.gender || "",
      Enclosure: record?.enclosure || (kind === "egg" ? "Hatchery" : ""),
      Body1: colors.body1 || "", Body2: colors.body2 || "", Scales: colors.scales || "",
      Extra1: colors.extra1 || "", Extra2: colors.extra2 || "",
      Generated: record?.generated === true ? "YES" : record?.generated === false ? "NO" : "",
      PedigreeVerified: record?.pedigreeVerified === true ? "YES" : "NO",
      ParentIDs: Array.isArray(record?.parentIds) ? record.parentIds.join("|") : "",
      DataStatus: COLOR_KEYS.every(key => /^#?[0-9a-f]{6}$/i.test(colors[key] || "")) ? "complete" : "missing-colors",
      Discard: ""
    };
    return row;
  }

  // RFC4180-style parser with quoted commas, CRLF and embedded newlines. Reject broken quotes.
  function parseCsv(input) {
    const s = String(input || "").replace(/^\uFEFF/, "");
    if (!s.trim()) throw new Error("CSV or ID list is empty");
    const rows = [];
    let row = [], cell = "", quoted = false, afterQuote = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; afterQuote = true; }
        } else cell += c;
      } else if (c === '"' && !cell && !afterQuote) quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; afterQuote = false; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[i + 1] === "\n") i++;
        row.push(cell); if (row.some(v => v.trim())) rows.push(row);
        row = []; cell = ""; afterQuote = false;
      } else if (afterQuote && c !== " " && c !== "\t") throw new Error("Invalid characters after CSV quote");
      else if (afterQuote) {}
      else if (c === '"') throw new Error("Unexpected CSV quote");
      else cell += c;
    }
    if (quoted) throw new Error("Unclosed CSV quote");
    row.push(cell);
    if (row.some(v => v.trim())) rows.push(row);
    if (!rows.length) throw new Error("No CSV rows");
    return rows;
  }

  function selectedIds(text) {
    const rows = parseCsv(text);
    const head = rows[0].map(v => v.trim().toLowerCase().replace(/[\s_-]/g, ""));
    const idIndex = head.findIndex(v => v === "id" || v === "petid" || v === "eggid");
    const discardIndex = head.findIndex(v => v === "discard" || v === "delete" || v === "remove");
    const hasHeader = idIndex !== -1;
    const onlyIds = rows.every(row => row.length === 1);
    if (!hasHeader && !onlyIds) throw new Error('Spreadsheet must have an ID column and a Discard column');
    if (hasHeader && head.length > 1 && discardIndex < 0) {
      throw new Error('A multi-column spreadsheet must have a Discard column (mark YES)');
    }
    const ids = [], seen = new Set(), invalid = [];
    const start = hasHeader ? 1 : 0;
    const index = hasHeader ? idIndex : 0;
    for (let n = start; n < rows.length; n++) {
      const row = rows[n];
      const marker = discardIndex < 0 ? "YES" : String(row[discardIndex] || "").trim().toUpperCase();
      if (!marker || ["NO", "FALSE", "0", "KEEP"].includes(marker)) continue;
      if (!["YES", "Y", "TRUE", "1", "DISCARD", "DELETE", "X"].includes(marker)) {
        throw new Error("Invalid Discard cell on CSV row " + (n + 1) + ": " + marker.slice(0, 24));
      }
      const id = String(row[index] || "").trim();
      if (!validId(id)) { invalid.push(n + 1); continue; }
      if (!seen.has(id)) { ids.push(id); seen.add(id); }
    }
    if (invalid.length) throw new Error("Invalid numeric IDs on CSV rows: " + invalid.slice(0, 8).join(", "));
    if (!ids.length) throw new Error("No IDs marked YES (or listed in a one-column ID file)");
    if (ids.length > 5000) throw new Error("Maximum 5,000 IDs per reviewed list");
    return ids;
  }

  OWEH.domain.sheetTransfer = Object.freeze({ COLOR_KEYS, HEADERS, validId, serialize, inventoryRow, parseCsv, selectedIds });
})();
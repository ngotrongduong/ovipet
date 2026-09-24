"use strict";

// Pure parsers for the game's JSONP panel markup (v5.5.0). OviPets serves every panel as
// `cb({"output": "<ui:section ...>"})`; reading those responses directly lets the command-first
// jobs refresh the catalog, profiles and pedigrees without navigating the worker tab.
// The markup puts spaces around `=` (`name = "value"`) and nests dialogs as entity-escaped
// text, so every pattern here matches raw `<ui:` tags only and never the escaped copies.
(() => {
  if (!globalThis.OWEH) throw new Error("jobs/core.js must load before dom/markup.js");

  const HEX = /#([0-9A-F]{6})\b/i;

  function unwrapCb(text) {
    const body = String(text || "").trim().replace(/^cb\(/, "").replace(/\);?\s*$/, "");
    const parsed = JSON.parse(body);
    if (typeof parsed?.output !== "string") throw new Error("panel response has no output");
    return parsed.output;
  }

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function stripScripts(output) {
    return String(output || "").replace(/<script>[\s\S]*?<\/script>/g, "");
  }

  function attr(tag, name) {
    const match = String(tag || "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
    return match ? decodeEntities(match[1] ?? match[2]) : null;
  }

  // The text between an opening `<ui:section ... id = "x">` and the next top-level section.
  function sectionById(output, id) {
    const html = stripScripts(output);
    const open = new RegExp(`<ui:section\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`);
    const match = open.exec(html);
    if (!match) return null;
    const rest = html.slice(match.index + match[0].length);
    const next = rest.search(/<ui:section\b[^>]*\btitle\s*=/);
    return { tag: match[0], body: next < 0 ? rest : rest.slice(0, next) };
  }

  function items(html) {
    return [...String(html || "").matchAll(/<ui:i value\s*=\s*"(\d+)"[^>]*>([\s\S]*?)<\/ui:i>/g)]
      .map(match => ({ id: match[1], body: match[2] }));
  }

  function parseEnclosureTabs(output) {
    return [...stripScripts(output).matchAll(/<ui:tab\b[^>]*>/g)]
      .map(match => {
        const label = attr(match[0], "label") || "";
        const panel = attr(match[0], "panel") || "";
        const id = panel.match(/[?&]enclosure=(\d+)/)?.[1] ?? label.match(/enclosure\s*=\s*"(\d+)"/)?.[1];
        const text = label.replace(/<[^>]*>/g, "").trim();
        return id == null ? null : { id: String(id), label: text, panel };
      })
      .filter(Boolean);
  }

  function parseEnclosurePets(output, enclosure = null) {
    const html = stripScripts(output);
    const enclosureId = enclosure?.id ?? html.match(/<ui:section\b[^>]*\bid\s*=\s*"pets-(\d+)"/)?.[1] ?? null;
    const seen = new Set();
    const pets = [];
    for (const { id, body } of items(html)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const petLink = body.match(/<a href\s*=\s*"[^"]*usr=(\d+)[^"]*"\s+class\s*=\s*"pet">/);
      const nameTag = body.match(/<a\b[^>]*class\s*=\s*"pet name"[^>]*>([\s\S]*?)<\/a>/);
      const imgTag = body.match(/<img src\s*=\s*"[^"]*\/img\/pet\/\d+[^"]*"[^>]*>/)?.[0] || "";
      const modified = attr(imgTag, "src")?.match(/[?&]modified=(\d+)/)?.[1] || null;
      pets.push({
        id,
        usr: petLink?.[1] || null,
        name: nameTag ? decodeEntities(nameTag[1]).trim() : (attr(imgTag, "title") || "").trim(),
        onCooldown: /\/heart_iceblue\.png/.test(body),
        modified,
        enclosure: enclosure?.label ?? null,
        enclosureId: enclosureId == null ? null : String(enclosureId)
      });
    }
    return pets;
  }

  function overviewValue(html, label) {
    const match = html.match(new RegExp(`<div class\\s*=\\s*"attr"><p>${label}</p></div><div class\\s*=\\s*"value"><p>([\\s\\S]*?)</p>`));
    return match ? decodeEntities(match[1].replace(/<[^>]*>/g, "")).trim() : "";
  }

  function colorRow(html, id) {
    const row = html.match(new RegExp(`<ui:r id\\s*=\\s*"${id}">([\\s\\S]*?)</ui:r>`))?.[1] || "";
    return [...row.matchAll(/<ui:d class\s*=\s*"c(\d)">([\s\S]*?)<\/ui:d>/g)]
      .filter(match => match[1] !== "0")
      .map(match => match[2].match(/([0-9A-F]{6})<\/var>/i)?.[1] || match[2].match(HEX)?.[1] || null)
      .map(value => value ? `#${value.toUpperCase()}` : null);
  }

  function parseProfile(output) {
    const html = stripScripts(output);
    const section = sectionById(html, "profile");
    if (!section) return null;
    const name = (attr(section.tag, "title") || "").trim();
    const id = attr(section.tag, "prev")?.match(/[?&]pet=(\d+)/)?.[1]
      || html.match(/'pet_(?:name|rename|feed)','PetID=(\d+)'/)?.[1] || null;
    const colors = {};
    const [body1, body2] = colorRow(html, "Body");
    const [scales] = colorRow(html, "Scales");
    const [extra1, extra2] = colorRow(html, "Extra");
    if (body1) colors.body1 = body1;
    if (body2) colors.body2 = body2;
    if (scales) colors.scales = scales;
    if (extra1) colors.extra1 = extra1;
    if (extra2) colors.extra2 = extra2;
    const food = html.match(/<ui:progressbar value\s*=\s*"(\d+(?:\.\d+)?)"[^>]*class\s*=\s*"food"/)?.[1];
    const specialGender = section.body.match(/<img src\s*=\s*"\/static\/icons\/(male|female)\.png"/)?.[1];
    const gender = overviewValue(html, "Gender")
      || (specialGender ? specialGender[0].toUpperCase() + specialGender.slice(1) : "");
    const selectTag = html.match(/<ui:input type\s*=\s*"select" name\s*=\s*"Enclosure"[^>]*>([\s\S]*?)<\/ui:input>/);
    const enclosureOptions = {};
    let enclosureId = null;
    let enclosureLabel = null;
    for (const option of (selectTag?.[1] || "").matchAll(/<ui:o value\s*=\s*"(\d+)"([^>]*)>([\s\S]*?)<\/ui:o>/g)) {
      const label = decodeEntities(option[3]).trim();
      enclosureOptions[label] = option[1];
      if (/status\s*=\s*"selected"/.test(option[2])) {
        enclosureId = option[1];
        enclosureLabel = label;
      }
    }
    return {
      id,
      name,
      unnamed: name === "Unnamed",
      gender,
      species: overviewValue(html, "Species"),
      hatched: overviewValue(html, "Hatched") || null,
      colors,
      foodPercent: food == null ? null : Number(food),
      enclosureId,
      enclosureLabel,
      enclosureOptions,
      canName: /'pet_name','PetID=/.test(html),
      canRename: /'pet_rename','PetID=/.test(html),
      canFeed: /'pet_feed','PetID=/.test(html)
    };
  }

  // Same node shape as OWEH.dom.profile.pedigreeAncestorGraph: ancestor links in document
  // order (breadth-first), deduplicated. Daughters and Sons come before the ancestors
  // fieldset and are excluded. `verified` means the ancestors fieldset was present.
  function parsePedigree(output) {
    const html = stripScripts(output);
    const start = html.search(/<ui:fieldset\b[^>]*class\s*=\s*"ancestors"/);
    if (start < 0) return { verified: false, nodes: [] };
    const tail = html.slice(start);
    const end = tail.indexOf("</ui:fieldset>");
    const body = end < 0 ? tail : tail.slice(0, end);
    const seen = new Set();
    const nodes = [];
    for (const match of body.matchAll(/<a href\s*=\s*"[^"]*[?&;]pet=(\d+)[^"]*"\s+class\s*=\s*"pet"/g)) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const position = nodes.length;
      nodes.push({
        id,
        generation: position < 2 ? 1 : (position < 6 ? 2 : 3),
        relation: position === 0 ? "parent-1" : (position === 1 ? "parent-2" : "ancestor"),
        inferred: true
      });
    }
    return { verified: true, nodes };
  }

  function parseHatchery(output) {
    const hatchery = sectionById(output, "hatchery");
    const unnamed = sectionById(output, "unnamed");
    const eggs = items(hatchery?.body).map(({ id, body }) => ({
      id,
      turnable: /<img\b[^>]*title\s*=\s*"Turn Egg"/.test(body),
      hatchable: /<img\b[^>]*title\s*=\s*"Hatch Egg"/.test(body)
    }));
    return {
      eggIds: eggs.map(egg => egg.id),
      turnable: eggs.filter(egg => egg.turnable).map(egg => egg.id),
      hatchable: eggs.filter(egg => egg.hatchable).map(egg => egg.id),
      unnamedIds: [...new Set(items(unnamed?.body).map(item => item.id))]
    };
  }

  // v5.5.2: the Breeding tab (`sec=breeding&enclosure=<id>`) lists only the partners OviPets
  // itself allows — related and cooling-down pets are already filtered out by the game. Each
  // card carries `pet_breed` with `MotherID=..&FatherID=..`; returns the partner ids of `petId`.
  function parseBreedingPartners(output, petId) {
    const self = String(petId || "");
    const partners = new Set();
    for (const match of String(output || "").matchAll(/MotherID=(\d+)&(?:amp;)*FatherID=(\d+)/g)) {
      const other = match[1] === self ? match[2] : match[1];
      if (other && other !== self) partners.add(other);
    }
    return [...partners];
  }

  // Combines a parsed profile and pedigree into the record shape OWEH.dom.profile.readPet
  // produces, so the pet database cannot tell a fetched record from a navigated one.
  function petRecord({ id, profile, pedigree, url, now = Date.now() }) {
    if (!profile || Object.keys(profile.colors || {}).length < 3) return null;
    const petId = String(id || profile.id || "");
    if (!petId) return null;
    const verified = Boolean(pedigree?.verified);
    const nodes = verified ? pedigree.nodes.map(node => ({ ...node })) : [];
    return {
      id: petId,
      name: profile.name || petId,
      gender: profile.gender || "",
      species: profile.species || "",
      colors: { ...profile.colors },
      ancestors: nodes.map(node => node.id),
      pedigree: nodes,
      pedigreeVerified: verified,
      parentIds: nodes.filter(node => node.generation === 1).map(node => node.id),
      url: url || `https://ovipets.com/#!/?src=pets&sub=profile&pet=${petId}`,
      updatedAt: now,
      foodPercent: Number.isFinite(profile.foodPercent) ? profile.foodPercent : null,
      foodCheckedAt: Number.isFinite(profile.foodPercent) ? now : null
    };
  }

  OWEH.dom = OWEH.dom || {};
  OWEH.dom.markup = Object.freeze({
    unwrapCb,
    decodeEntities,
    stripScripts,
    attr,
    sectionById,
    parseEnclosureTabs,
    parseEnclosurePets,
    parseProfile,
    parsePedigree,
    parseHatchery,
    parseBreedingPartners,
    petRecord
  });
})();

"use strict";

// Builds data/species-static.js, the built-in Name-the-Species silhouette library.
//
//   node scripts/build-species-static.js [--source <learning-export.json>] [<cases.json> ...]
//
// --source  rebuild the learned part from a Species learning/Inspector export (its `shapes` map,
//           every species in it). Without it the current data/species-static.js is the base.
// cases     files from the panel's "Export wrongs" button, or label files from the owner's
//           verification page. Every case with a correctSpecies is appended as a confirmed
//           silhouette (confirmed by the game after a rejected answer, or by the owner's eyes).
//
// The quiz offered 10 species until 2026-10; since then it offers about 39. A species is
// whatever the inputs name: there is no fixed list.
//
// Learned labels are noisy: the old learner stored a few Vulpes under Canis and a Raptor under
// Gekko, and with nearest-neighbour matching one mislabeled silhouette keeps beating the right
// species by a bit or two. A learned silhouette is therefore dropped when none of its 5 nearest
// neighbours share its label and at least 4 of them agree on one other species — but only in
// a species with enough learned silhouettes for "none of its neighbours" to mean something.
// Confirmed silhouettes are never dropped; they sit at the end of each species and
// meta.gameConfirmed counts them so the next build can tell them apart.
//
// Only color-independent 32x32 alpha masks are written: no ids, thumbnails or traces.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const TARGET = path.join(ROOT, "data", "species-static.js");
const NEIGHBOURS = 5;
const MIN_AGREEING = 4;
// A species with a handful of silhouettes has no "own" neighbours to be found among.
const MIN_CLASS_FOR_NOISE_FILTER = 20;
const SPECIES_NAME = /^[A-Za-z][A-Za-z -]{1,30}$/;

function loadRuntime() {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, "domain", "species-shape.js"), "utf8"), sandbox);
  if (fs.existsSync(TARGET)) vm.runInContext(fs.readFileSync(TARGET, "utf8"), sandbox);
  return { shapeApi: sandbox.OWEH_SPECIES_SHAPE, current: sandbox.OWEH_STATIC_SPECIES || null };
}

function parseArgs(argv) {
  const args = { source: null, cases: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") args.source = argv[index += 1];
    else args.cases.push(argv[index]);
  }
  return args;
}

function distanceMatrix(entries, hamming) {
  const matrix = entries.map(() => new Uint16Array(entries.length));
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      matrix[i][j] = matrix[j][i] = hamming(entries[i].shape, entries[j].shape);
    }
  }
  return matrix;
}

function nearest(matrix, entries, index, count) {
  const order = [];
  for (let other = 0; other < entries.length; other += 1) {
    if (other !== index && !entries[other].dropped) order.push(other);
  }
  return order.sort((a, b) => matrix[index][a] - matrix[index][b]).slice(0, count);
}

const classSizes = entries => entries.reduce((sizes, entry) => {
  if (!entry.dropped) sizes[entry.species] = (sizes[entry.species] || 0) + 1;
  return sizes;
}, {});

// Repeats until stable: removing one mislabeled silhouette can expose its mislabeled neighbour.
function dropMislabeled(matrix, entries) {
  const dropped = [];
  for (;;) {
    const sizes = classSizes(entries);
    const victims = [];
    entries.forEach((entry, index) => {
      if (entry.dropped || entry.confirmed || sizes[entry.species] < MIN_CLASS_FOR_NOISE_FILTER) return;
      const votes = {};
      for (const other of nearest(matrix, entries, index, NEIGHBOURS)) {
        votes[entries[other].species] = (votes[entries[other].species] || 0) + 1;
      }
      const [looksLike, agreeing] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || [];
      if (!votes[entry.species] && agreeing >= MIN_AGREEING) victims.push({ entry, looksLike });
    });
    if (!victims.length) return dropped;
    for (const victim of victims) {
      victim.entry.dropped = true;
      dropped.push(victim);
    }
  }
}

// Leave-one-out nearest neighbour over every species (harder than the 6 options of a real
// quiz), reported separately for well-sampled and thin species.
function leaveOneOut(matrix, entries) {
  const sizes = classSizes(entries);
  const tally = { large: { right: 0, total: 0, errors: {} }, small: { right: 0, total: 0, errors: {} } };
  entries.forEach((entry, index) => {
    if (entry.dropped) return;
    const bucket = tally[sizes[entry.species] >= MIN_CLASS_FOR_NOISE_FILTER ? "large" : "small"];
    const closest = entries[nearest(matrix, entries, index, 1)[0]];
    bucket.total += 1;
    if (closest?.species === entry.species) bucket.right += 1;
    else bucket.errors[`${entry.species}->${closest?.species}`] = (bucket.errors[`${entry.species}->${closest?.species}`] || 0) + 1;
  });
  return tally;
}

function build() {
  const args = parseArgs(process.argv.slice(2));
  const { shapeApi, current } = loadRuntime();
  const entries = [];
  const seen = new Set();
  const add = (species, shape, confirmed) => {
    const name = String(species || "").trim();
    if (!SPECIES_NAME.test(name) || !shapeApi.validShape(shape) || seen.has(`${name}|${shape}`)) return false;
    seen.add(`${name}|${shape}`);
    entries.push({ species: name, shape, confirmed, dropped: false });
    return true;
  };

  let provenance = {
    sourceExportedAt: current?.meta?.sourceExportedAt || null,
    sourceExtensionVersion: current?.meta?.sourceExtensionVersion || null
  };
  const currentConfirmed = [];
  for (const [species, record] of Object.entries(current?.library || {})) {
    const examples = record?.examples || [];
    const learned = examples.length - Number(current?.meta?.gameConfirmed?.[species] || 0);
    examples.forEach((shape, index) => {
      if (index >= learned) currentConfirmed.push({ species, shape });
      else if (!args.source) add(species, shape, false);
    });
  }
  if (args.source) {
    const source = JSON.parse(fs.readFileSync(args.source, "utf8"));
    provenance = { sourceExportedAt: source.exportedAt || null, sourceExtensionVersion: source.extensionVersion || null };
    for (const [species, record] of Object.entries(source.shapes || {})) {
      for (const shape of record?.examples || []) add(species, shape, false);
    }
  }
  for (const { species, shape } of currentConfirmed) add(species, shape, true);

  const cases = args.cases.flatMap(file => JSON.parse(fs.readFileSync(file, "utf8")).cases || [])
    .filter(item => SPECIES_NAME.test(String(item.correctSpecies || "").trim()) && shapeApi.validShape(item.shape));
  const speciesOf = () => [...new Set(entries.filter(entry => !entry.dropped).map(entry => entry.species))].sort();
  const libraryOf = () => Object.fromEntries(speciesOf().map(species => [species, {
    examples: [false, true].flatMap(confirmed => entries
      .filter(entry => entry.species === species && entry.confirmed === confirmed && !entry.dropped)
      .map(entry => entry.shape))
  }]));

  // Held-out check first: would the cleaned library have answered these before learning them?
  let matrix = distanceMatrix(entries, shapeApi.hamming);
  const dropped = dropMislabeled(matrix, entries);
  const cleaned = libraryOf();
  const heldOut = { right: 0, judged: 0 };
  for (const item of cases) {
    if (!Array.isArray(item.options) || !item.options.length) continue;
    const without = Object.fromEntries(Object.entries(cleaned)
      .map(([species, record]) => [species, { examples: record.examples.filter(shape => shape !== item.shape) }]));
    const ranked = shapeApi.rankOptions({ shape: item.shape, options: item.options, library: without, random: () => 0 });
    heldOut.judged += 1;
    if (ranked?.species === item.correctSpecies) heldOut.right += 1;
  }

  let appended = 0;
  for (const item of cases) {
    const correct = String(item.correctSpecies).trim();
    // The game (or the owner) rejected this exact silhouette for every other species.
    for (const entry of entries) {
      if (entry.shape !== item.shape || entry.species === correct || entry.confirmed || entry.dropped) continue;
      entry.dropped = true;
      dropped.push({ entry });
    }
    if (add(correct, item.shape, true)) appended += 1;
  }
  matrix = distanceMatrix(entries, shapeApi.hamming);
  dropped.push(...dropMislabeled(matrix, entries));
  const loo = leaveOneOut(matrix, entries);

  const library = libraryOf();
  const species = Object.keys(library);
  const count = pick => Object.fromEntries(species.map(name => [name, pick(name)]));
  const kept = entries.filter(entry => !entry.dropped);
  const meta = {
    ...provenance,
    species: species.length,
    examples: kept.length,
    counts: count(name => library[name].examples.length),
    gameConfirmed: count(name => kept.filter(entry => entry.species === name && entry.confirmed).length),
    droppedMislabeled: Number(args.source ? 0 : current?.meta?.droppedMislabeled || 0) + dropped.length,
    quizSpecies: species
  };

  const lines = species.map(name => `    ${JSON.stringify(name)}: Object.freeze(${JSON.stringify(library[name])})`);
  fs.writeFileSync(TARGET, `"use strict";

// Static production Name-the-Species silhouette database.
// GENERATED by scripts/build-species-static.js - do not edit by hand.
// Learned silhouettes come first in each species; the last meta.gameConfirmed[species] entries
// were confirmed after a rejected answer (by OviPets on a retry, or by the owner's review).
// Raw quiz traces, thumbnails, exact-image history and user/page metadata are intentionally
// NOT embedded. This file contains only color-independent 32x32 alpha-mask silhouettes.
(() => {
  const meta = Object.freeze(${JSON.stringify(meta)});
  const library = Object.freeze({
${lines.join(",\n")}
  });
  globalThis.OWEH_STATIC_SPECIES = Object.freeze({ meta, library });
})();
`);

  for (const { entry, looksLike } of dropped) {
    console.log(`dropped ${entry.species} silhouette${looksLike ? ` that looks like ${looksLike}` : " rejected for that species"}`);
  }
  const errorText = errors => Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([pair, n]) => `${pair}${n > 1 ? ` x${n}` : ""}`).join(" ") || "no errors";
  console.log(`cases with a confirmed species: ${cases.length}, appended ${appended}`
    + (heldOut.judged ? ` — before learning them the library answered ${heldOut.right}/${heldOut.judged} correctly` : ""));
  console.log(`library: ${kept.length} silhouettes in ${species.length} species`);
  console.log(species.map(name => `${name} ${meta.counts[name]}${meta.gameConfirmed[name] ? ` (${meta.gameConfirmed[name]} confirmed)` : ""}`).join(", "));
  console.log(`leave-one-out, species with >=${MIN_CLASS_FOR_NOISE_FILTER} silhouettes: ${loo.large.right}/${loo.large.total} (${errorText(loo.large.errors)})`);
  console.log(`leave-one-out, thinner species: ${loo.small.right}/${loo.small.total} (${errorText(loo.small.errors)})`);
}

build();

"use strict";

// Builds data/species-static.js, the built-in Name-the-Species silhouette library.
//
//   node scripts/build-species-static.js [--source <learning-export.json>] [<wrongs-export.json> ...]
//
// --source  rebuild the base library from a Species learning/Inspector export (its `shapes` map).
//           Without it the current data/species-static.js is the base.
// wrongs    files from the panel's "Export wrongs" button. Every case OviPets resolved
//           (correctSpecies set) is appended as a game-confirmed silhouette.
//
// Learned labels are noisy: the old learner stored a few Vulpes under Canis and a Raptor under
// Gekko, and with nearest-neighbour matching one mislabeled silhouette keeps beating the right
// species by a bit or two. A learned silhouette is therefore dropped when none of its 5 nearest
// neighbours share its label and at least 4 of them agree on one other species. Game-confirmed
// silhouettes are never dropped; they sit at the end of each species and meta.gameConfirmed
// counts them so the next build can tell them apart.
//
// Only color-independent 32x32 alpha masks are written: no ids, thumbnails or traces.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const TARGET = path.join(ROOT, "data", "species-static.js");
const QUIZ_SPECIES = ["Canis", "Draconis", "Equus", "Feline", "Gekko", "Lupus", "Mantis", "Raptor", "Slime", "Vulpes"];
const NEIGHBOURS = 5;
const MIN_AGREEING = 4;

function loadRuntime() {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, "domain", "species-shape.js"), "utf8"), sandbox);
  if (fs.existsSync(TARGET)) vm.runInContext(fs.readFileSync(TARGET, "utf8"), sandbox);
  return { shapeApi: sandbox.OWEH_SPECIES_SHAPE, current: sandbox.OWEH_STATIC_SPECIES || null };
}

function parseArgs(argv) {
  const args = { source: null, wrongs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") args.source = argv[index += 1];
    else args.wrongs.push(argv[index]);
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

// Repeats until stable: removing one mislabeled silhouette can expose its mislabeled neighbour.
function dropMislabeled(matrix, entries) {
  const dropped = [];
  for (;;) {
    const victims = [];
    entries.forEach((entry, index) => {
      if (entry.dropped || entry.confirmed) return;
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

// Leave-one-out nearest-neighbour over all 10 species (harder than the 6 options of a real quiz).
function leaveOneOutErrors(matrix, entries) {
  const errors = [];
  entries.forEach((entry, index) => {
    if (entry.dropped) return;
    const closest = entries[nearest(matrix, entries, index, 1)[0]];
    if (closest.species !== entry.species) errors.push(`${entry.species}->${closest.species}`);
  });
  return errors;
}

function build() {
  const args = parseArgs(process.argv.slice(2));
  const { shapeApi, current } = loadRuntime();
  const entries = [];
  const seen = new Set();
  const add = (species, shape, confirmed) => {
    if (!QUIZ_SPECIES.includes(species) || !shapeApi.validShape(shape) || seen.has(`${species}|${shape}`)) return false;
    seen.add(`${species}|${shape}`);
    entries.push({ species, shape, confirmed, dropped: false });
    return true;
  };

  let provenance = {
    sourceExportedAt: current?.meta?.sourceExportedAt || null,
    sourceExtensionVersion: current?.meta?.sourceExtensionVersion || null
  };
  const currentConfirmed = [];
  for (const species of QUIZ_SPECIES) {
    const examples = current?.library?.[species]?.examples || [];
    const learned = examples.length - Number(current?.meta?.gameConfirmed?.[species] || 0);
    examples.forEach((shape, index) => {
      if (index >= learned) currentConfirmed.push({ species, shape });
      else if (!args.source) add(species, shape, false);
    });
  }
  if (args.source) {
    const source = JSON.parse(fs.readFileSync(args.source, "utf8"));
    provenance = { sourceExportedAt: source.exportedAt || null, sourceExtensionVersion: source.extensionVersion || null };
    for (const species of QUIZ_SPECIES) {
      for (const shape of source.shapes?.[species]?.examples || []) add(species, shape, false);
    }
  }
  for (const { species, shape } of currentConfirmed) add(species, shape, true);

  const cases = args.wrongs.flatMap(file => JSON.parse(fs.readFileSync(file, "utf8")).cases || [])
    .filter(item => QUIZ_SPECIES.includes(item.correctSpecies) && shapeApi.validShape(item.shape));
  // Held-out check first: would the cleaned library have answered these before learning them?
  let matrix = distanceMatrix(entries, shapeApi.hamming);
  const dropped = dropMislabeled(matrix, entries);
  const libraryOf = () => Object.fromEntries(QUIZ_SPECIES.map(species => [species, {
    examples: [false, true].flatMap(confirmed => entries
      .filter(entry => entry.species === species && entry.confirmed === confirmed && !entry.dropped)
      .map(entry => entry.shape))
  }]));
  const cleaned = libraryOf();
  for (const item of cases) {
    const heldOut = Object.fromEntries(Object.entries(cleaned)
      .map(([species, record]) => [species, { examples: record.examples.filter(shape => shape !== item.shape) }]));
    const ranked = shapeApi.rankOptions({ shape: item.shape, options: item.options, library: heldOut });
    console.log(`wrong case ${item.eggId}: answered ${item.wrongSpecies}, correct ${item.correctSpecies}; ` +
      `before learning it the rebuilt library says ${ranked.species} (${ranked.distance})`);
  }

  let appended = 0;
  for (const item of cases) {
    // The game rejected this exact silhouette for wrongSpecies.
    for (const entry of entries) {
      if (entry.shape !== item.shape || entry.species === item.correctSpecies || entry.confirmed || entry.dropped) continue;
      entry.dropped = true;
      dropped.push({ entry });
    }
    if (add(item.correctSpecies, item.shape, true)) appended += 1;
  }
  matrix = distanceMatrix(entries, shapeApi.hamming);
  dropped.push(...dropMislabeled(matrix, entries));
  const errors = leaveOneOutErrors(matrix, entries);

  const library = libraryOf();
  const count = pick => Object.fromEntries(QUIZ_SPECIES.map(species => [species, pick(species)]));
  const kept = entries.filter(entry => !entry.dropped);
  const meta = {
    ...provenance,
    species: QUIZ_SPECIES.length,
    examples: kept.length,
    counts: count(species => library[species].examples.length),
    gameConfirmed: count(species => kept.filter(entry => entry.species === species && entry.confirmed).length),
    droppedMislabeled: Number(args.source ? 0 : current?.meta?.droppedMislabeled || 0) + dropped.length,
    quizSpecies: QUIZ_SPECIES
  };

  const lines = QUIZ_SPECIES.map(species => `    ${JSON.stringify(species)}: Object.freeze(${JSON.stringify(library[species])})`);
  fs.writeFileSync(TARGET, `"use strict";

// Static production Name-the-Species silhouette database.
// GENERATED by scripts/build-species-static.js - do not edit by hand.
// Learned silhouettes come first in each species; the last meta.gameConfirmed[species] entries
// are corrections OviPets itself confirmed after a rejected answer.
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
    console.log(`dropped ${entry.species} silhouette${looksLike ? ` that looks like ${looksLike}` : " rejected by the game"}`);
  }
  console.log(`appended ${appended} game-confirmed silhouette(s)`);
  console.log(`library: ${kept.length} silhouettes - ${QUIZ_SPECIES.map(species => `${species} ${meta.counts[species]}`).join(", ")}`);
  console.log(`leave-one-out nearest neighbour, 10 options: ${kept.length - errors.length}/${kept.length} (${errors.join(" ") || "no errors"})`);
}

build();

# Name the Species — Inspector / Learning Dataset

Current release compatibility: v5.4.3

## Purpose

The inspector exists to discover whether OviPets exposes useful answer identity on the browser side and to build a progressively better image/species memory without collecting unrelated account data.

It can observe only information delivered to the browser. It cannot read private server-side source code.

## What is recorded while Turn Egg / Name the Species is active

- egg/user IDs already present in the OviPets route;
- verification dialog HTML/attributes;
- image source URL(s), selected safe attributes, a perceptual fingerprint and small thumbnail;
- answer option text/attributes;
- selected answer and correct/wrong outcome;
- terminal wrong-answer Error dialog snapshot;
- OviPets script source URLs;
- matching MAIN-world global function/value hints whose names contain species/egg/turn/verify/captcha/quiz/dialog;
- narrowly filtered same-origin XHR/fetch metadata during the trace window, with unrelated parameters redacted and unrelated response bodies omitted.

## Explicitly not recorded

- cookies or authorization headers;
- passwords;
- chat messages;
- general browsing history;
- unrelated response bodies;
- cross-origin traffic.

## Live wrong-answer rule

Edge QA and Inspector network data confirmed two distinct outcomes:

1. `The answer is incorrect, please try again.` is **retryable**. Record that species as wrong for the current visual identity, dismiss the Error, click Turn Egg again on the same egg, and exclude the rejected species from subsequent guesses.
2. `The egg can no longer be turned.` is **terminal**. Report the egg as `exhausted`, close only the extension-owned tab, and continue the batch.

Do not infer a wrong answer from timeout, silence, navigation, or simply selecting another option. Only the explicit incorrect Error/network response is authoritative negative evidence.

## Learning identity

The solver/Inspector uses the strongest available identity in this order:

- perceptual visual fingerprint of the challenge image;
- canonical challenge image source URL;
- question key fallback.

Because the challenge image is served from `app.ovipets.com`, v5.3.5 uses a strict background fetcher limited to `/img/pet/<id>/credit-challenge` so the isolated content script can safely compute a thumbnail/fingerprint without weakening the page bridge.

### Silhouette matching (v5.4.0)

The challenge image shows a random species with random colors and genes, so the exact identities above rarely repeat. Each species keeps a fixed pose, so the Inspector also records a 32x32 alpha-mask silhouette (`shape`, 256 hex chars). When no confirmed exact memory exists, the solver ranks the offered options with `domain/species-shape.js`: a learned silhouette within 150 of 1,024 pixels is answered (`shape-match`, v5.4.1; measured same-species median 114, other-species median 175); otherwise it prefers an option never learned (`shape-unknown`), then the nearest (`shape-nearest`). Confirmed answers are added to `owehSpeciesShapes` (max 150 distinct silhouettes per species since v5.4.2; when full, the older of the closest pair is dropped) through the serialized background writer, older confirmed URLs are back-filled once, and exports/imports carry `shapes`.

**Learn Species Shapes** (v5.4.1, `jobs/species-seed.js`) seeds the library before any challenge is answered: normal pet images (`/img/pet/<id>`) share the challenge's 500x500 frame, so own saved pets and Adoption Center pets (species read from their public profile) are masked and learned. The more species are covered, the better the exclusion step works.

The real `pet_turn_egg` response is the authoritative outcome. `status: success` adds a positive vote; `status: failed` with the explicit incorrect message adds negative evidence. Answer IDs are also learned from the question/network request.

## Export

Open the extension panel → Hatchery & Eggs → **Export Species JSON**.

The exported JSON includes both the raw inspector sessions and the learned answer memory. Upload that JSON for offline analysis of:

- stable asset IDs/URLs;
- recurring fingerprints;
- client-side function names or script bundles;
- network fields that may identify species;
- correct/wrong mappings and confidence.

Use **Clear Inspector** to remove the trace dataset. Learned answer memory is intentionally retained so the solver does not lose past correct/wrong knowledge.

## Backup / restore

Use **Export Species DB** for a compact portable backup containing learned visual mappings, wrong-answer exclusions, Answer IDs and statistics. Use **Import Species DB** on the same or another computer to merge that backup into the current database. Import is idempotent: importing the same file again does not multiply votes.

**Import Species DB** also accepts previous full **Export Species JSON** files. For older Inspector exports whose `learnedMemory`/`answerIds` were empty, v5.3.5 mines the stored trace/network sessions and reconstructs recoverable positive/negative outcomes and Answer-ID mappings so early data is not discarded.


## v5.3.11 lightweight sweep tabs

Fast Sweep-owned tabs may block normal image/media/font resources to reduce memory/network load. Name-the-Species learning remains functional because the challenge source URL is still present in the DOM and the guarded background species-image service fetches the challenge asset directly for fingerprinting.

# Name the Species — Inspector / Learning Dataset

Current release compatibility: v5.3.11

## Purpose

The Inspector observes only browser-delivered Name-the-Species data and builds reusable image/species knowledge. It cannot read private server-side source code.

It records the quiz dialog, challenge image sources/fingerprint/thumbnail, option text + Answer IDs, selected answer/outcome, relevant Error dialogs, selected client-side source hints, and narrowly filtered same-origin quiz XHR/fetch evidence. It does not record cookies, auth headers, passwords, chat, general browsing history or unrelated response bodies.

## Live outcome rules

1. `The answer is incorrect, please try again.` is **retryable**. Store that species as wrong for the current visual identity, dismiss Error, Turn Egg again on the same egg and exclude that species.
2. `The egg can no longer be turned.` is **terminal**. Report exhausted, close only the extension-owned tab and continue the batch.

Timeout/silence/navigation/choosing another option are not proof that an answer was wrong.

## Learning identity

The solver and Inspector share:

- perceptual challenge-image fingerprint;
- canonical image source;
- question-key fallback.

The image is served from `app.ovipets.com`. A strict background service may fetch only `/img/pet/<id>/credit-challenge`, letting the content script compute a visual fingerprint without weakening the page bridge.

The real `pet_turn_egg` response is authoritative: success adds a positive vote; explicit incorrect failure adds negative evidence. Answer IDs are learned from options/network requests.

## Portable backup

- **Export Species JSON** — full trace + learning data for analysis.
- **Export Species DB** — compact portable learned database.
- **Import Species DB** — merges compact DB backups or older full Inspector exports.

Import is idempotent: reimporting the same file does not multiply votes. It merges instead of replacing.

For older Inspector exports whose learned-memory fields are empty, v5.3.10 continues to mine stored trace/network sessions to reconstruct recoverable positive/negative mappings and Answer IDs. This preserves early experimental data.

**Clear Inspector** removes trace sessions while retaining learned memory.


## Current integration status

As of v5.3.11, Species Inspector remains compatible with Continuous Full Sweep, 60s per-egg watchdogs, 120s batch watchdogs, protected/self-healing sweep coordinator recovery, portable Species DB import/export, and the Diagnostic Logbook. Species learning data is preserved independently from diagnostic-log retention.


## Fast Sweep integration

v5.3.11 reduces the fixed delay between selecting a species and confirming it: after selecting an option, the solver waits for the actual OK control to become usable (bounded readiness wait) and then confirms. Retryable incorrect answers still require explicit server/Error evidence before negative learning. The 60-second egg-tab watchdog remains unchanged.

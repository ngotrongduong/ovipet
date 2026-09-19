# Name the Species — Inspector / Learning Dataset

Release: v5.3.2

The inspector exists to discover whether OviPets exposes useful answer identity on the browser side and to build a progressively better image/species memory. It can observe only information delivered to the browser; it cannot read private server-side source code.

While Turn Egg / Name the Species is active it records the verification dialog, image URL/attributes, perceptual fingerprint, small thumbnail, option text, selected answer/outcome, terminal Error snapshot, OviPets script URLs, matching client-side global function/value hints, and narrowly filtered same-origin XHR/fetch evidence. Unrelated query/body fields are redacted and unrelated response bodies are omitted.

It does not record cookies, authorization headers, passwords, chat, general browsing history, unrelated response bodies, or cross-origin traffic.

Live rule: when `The answer is incorrect, please try again.` appears, record the submitted species as wrong, mark the session terminal, do not Turn Egg again in that tab, report the egg as `exhausted`, close only that extension-owned tab, and do not reopen that egg during the same visit.

Use **Hatchery & Eggs → Export Species JSON** to download the dataset. Upload that JSON for analysis of stable asset IDs, recurring fingerprints, source hints, network fields, and correct/wrong mappings. **Clear Inspector** removes trace sessions while keeping learned answer memory.

---
name: dom-contract-audit
description: Use when a feature depends on a new or changed OviPets DOM selector/state/completion signal.
---

# DOM Contract Audit

For each assumption record:

- page/route;
- exact purpose;
- selector/signal;
- observed positive state;
- observed negative state;
- completion signal;
- date verified;
- confidence/limitations.

Prefer stable semantic attributes and game controls over visual hierarchy.

Create a sanitized minimal fixture when possible and add a test. If live verification is missing, mark the assumption unverified and add it to LIVE_QA_CHECKLIST rather than guessing.

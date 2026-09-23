---
name: safe-module-extraction
description: Use when moving OviPets behavior out of content.js/background.js into smaller modules without changing behavior.
---

Read WORKING_STATE/ARCHITECTURE/REFACTOR_MAP; pick one boundary; identify callers/globals/side effects; add characterization tests; create narrow API; move minimum code; run syntax+full tests; review diff; update working state. Gotchas: do not change selectors/storage keys/behavior while extracting; do not replace one giant legacy bag with another; preserve manifest order.

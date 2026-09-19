---
name: safe-module-extraction
description: Use when moving OviPets behavior out of content.js/background.js into smaller modules without changing behavior.
---

# Safe Module Extraction

1. Read WORKING_STATE, ARCHITECTURE and REFACTOR_MAP.
2. Pick one coherent boundary only.
3. Identify globals, callers, side effects and persistent-state dependencies.
4. Add characterization tests if the contract is not already protected.
5. Create the narrow target API.
6. Move code with the minimum wiring change.
7. Run syntax + full tests.
8. Review the diff for accidental behavior changes.
9. Update WORKING_STATE if architecture materially changed.

## Gotchas

- Do not change selectors while extracting DOM code.
- Do not rename storage keys without migration.
- Do not replace explicit services with a giant new context/legacy bag.
- Do not mix extraction with new feature behavior.
- Preserve manifest script dependency order until a separate module-tooling decision.

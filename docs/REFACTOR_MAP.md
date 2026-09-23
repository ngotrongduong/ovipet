# Refactor Map

content.js progress (2026-09-24): orchestration helpers moved to services/{diagnostics,overview-catalog,pet-edit,friend-directory,retention}.js; content.js is ~650 lines of composition/boot wiring. Remaining in content.js: breeding-candidate ranking, sweep read/step helpers, status/refresh plumbing and the OWEH.boot helper bag. Guard every further move with tests/content-boot-wiring.test.js.

content.js target: core/{config,storage-client,game-bridge,worker-client,scheduler}.js; dom/{routes,hatchery,profile,overview,friends,chat}.js; domain/{colors,pedigree,breeding-score,breeding-plan}.js; features/{own-eggs,friend-sweep,hatchlings,pet-index,breeding-campaign}.js; ui/{panel,dashboard}.js; content-entry.js bootstrap only.

background.js target: bg/{state-db,command-journal,worker-manager,egg-tabs,species-alert}.js with background.js mostly routing.

Extraction order: pure domain -> core clients -> DOM readers -> feature state machines -> UI -> background services.

Safe extraction means existing tests pass before/after, storage keys/schema stay unchanged, selector behavior stays unchanged unless separately audited, lifecycle semantics stay unchanged, retired workflows are not restored, and the diff is reversible without data migration.

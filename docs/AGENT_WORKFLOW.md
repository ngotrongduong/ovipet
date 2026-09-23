# Agentic Development Workflow

1. Scope: read WORKING_STATE/ROADMAP/issue and keep one coherent boundary.
2. Specialist pass: lifecycle, DOM, refactor or performance specialist establishes invariants/tests.
3. Implementation: smallest change; use the matching skill.
4. Verification: focused tests then full syntax + suite; live QA when needed.
5. Independent review: relevant specialist then oweh-regression-reviewer.
6. Documentation: update WORKING_STATE and relevant architecture/DOM docs.
7. PR/merge: acceptance criteria, CI, tests, review, required live QA, docs all green.

Parallelize independent reading/review tasks, not conflicting writes. The primary agent owns final integration.

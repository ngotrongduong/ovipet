# Agentic Development Workflow

This is the default workflow for runtime changes.

## 1. Scope

- Read WORKING_STATE, ROADMAP and the relevant issue.
- Keep the change inside one phase and one coherent boundary.
- State whether the PR is behavior change, bug fix, performance change, or behavior-preserving extraction.

## 2. Specialist pass

Use the smallest relevant specialist before implementation when risk is high:

- worker/lifecycle -> ovi-mv3-lifecycle-reviewer
- DOM selectors/contracts -> ovi-dom-contract-auditor
- refactor boundary -> ovi-refactor-architect
- performance -> ovi-performance-auditor

The specialist identifies invariants and tests; it does not silently expand scope.

## 3. Implementation

Prefer the smallest change that satisfies the issue acceptance criteria.

For refactors, use safe-module-extraction.
For lifecycle changes, use worker-state-machine.
For bugs, use regression-proof.

## 4. Verification

Run focused tests first, then full syntax + full test suite.

If the change depends on live OviPets behavior, update LIVE_QA_CHECKLIST and do not claim CI proved the live contract.

## 5. Independent review

Run the relevant specialist again on the diff if necessary, then run oweh-regression-reviewer as the final cross-cutting gate.

Review should prioritize correctness and known regression classes over style commentary.

## 6. Documentation

Update WORKING_STATE when architecture/state/phase changes.
Update ARCHITECTURE only for durable architectural decisions.
Update DOM evidence when selectors/contracts change.
Update changelog/version only for a release.

## 7. PR/merge

A runtime PR is merge-ready when:

- acceptance criteria are met;
- CI is green;
- regression tests exist for fixed bugs where practical;
- specialist/regression review has no unresolved high-signal issue;
- required live QA is recorded;
- docs reflect the new state.

## Parallel-agent rule

Parallelize independent reading/review tasks, not conflicting writes to the same files. The primary agent owns final integration and resolves contradictions between specialists.

# Agent & Skill Research Notes

Date: 2026-09-19

This document records the public patterns studied before adding OviPets-specific agents and skills. The project uses original instructions tailored to this codebase; third-party prompts are not copied wholesale.

## Sources reviewed

### Anthropic — anthropics/skills

Repository: https://github.com/anthropics/skills

Useful pattern:

- a skill is a small self-contained folder with SKILL.md;
- metadata/description should make activation discoverable;
- supporting references/scripts are loaded only when needed;
- keep broad project rules outside skills.

Adopted here: small project-specific skills with narrow triggers.

### Anthropic — anthropics/claude-code code-review workflow

Repository: https://github.com/anthropics/claude-code

Useful pattern:

- use independent reviewers for the same diff;
- separate policy/instruction compliance from bug finding;
- optimize for high-signal findings rather than style noise.

Adopted here: separate architecture/lifecycle/regression agents, with the main agent combining results.

### Claude Code community best-practice repositories

Examples reviewed:

- https://github.com/shanraisshan/claude-code-best-practice
- https://github.com/erkcet/awesome-claude-code
- https://github.com/shakacode/claude-code-commands-skills-agents

Useful patterns:

- agent context should be specialized;
- skill descriptions are activation triggers, not long summaries;
- keep Gotchas/known failure modes;
- use supporting references instead of growing one huge prompt;
- use subagents to protect the primary context from large exploratory output.

Adopted here: flat .claude/agents files, folder-based skills, explicit known-failure checklists.

### Agent skill quality/evaluation repositories

Examples reviewed:

- https://github.com/rlespinasse/agent-skills
- https://github.com/ever-just/agentskills
- https://github.com/JayRHa/AgentSkills

Useful patterns:

- skills should encode repeatable procedures, not generic advice;
- include edge cases/anti-patterns;
- validate skill structure and links;
- add evaluation scenarios when a skill becomes critical enough.

Adopted here: release/refactor/worker/DOM/test skills are procedures tied to this extension.

## Why these agents were selected

### ovi-mv3-lifecycle-reviewer

MV3 worker suspension, durable state and generation races are the highest-risk reliability area.

### ovi-dom-contract-auditor

OviPets is an external live website. Selector assumptions and action-completion signals must be treated as versioned contracts.

### ovi-regression-test-engineer

The project is being refactored while behavior must remain stable. Characterization and state-machine tests are essential.

### ovi-refactor-architect

content.js is too large, but a big-bang rewrite is riskier than the current debt. This agent enforces extraction boundaries and dependency direction.

### ovi-performance-auditor

MutationObserver churn, full IndexedDB materialization and mutation throughput become increasingly important as pet/friend counts grow.

### existing oweh-regression-reviewer

Keep the existing project-specific regression reviewer. It remains the final cross-cutting review layer after implementation.

## Why these skills were selected

- safe-module-extraction — repeatable behavior-preserving refactor workflow.
- worker-state-machine — protocol checklist for owner/generation/ACK/recovery.
- dom-contract-audit — repeatable live-DOM evidence workflow.
- regression-proof — test-first bug/regression procedure.
- release-gate — deterministic pre-merge/release verification.

## Patterns intentionally not adopted

- Huge generic agent packs: too much overlap and activation ambiguity.
- Auto-install/self-updating third-party skills: project agents must remain reviewable and pinned in this repository.
- Agents that can both redesign architecture and merge their own work without review.
- Generic style-review agents that produce large low-signal nit lists.
- Persistent in-memory assumptions for MV3 background state.

## Security rule for third-party agent material

Never run an external install script or copy a third-party skill into this project without reading its complete contents, license and tool permissions first.

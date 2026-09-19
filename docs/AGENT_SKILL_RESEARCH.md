# Agent & Skill Research Notes

Date: 2026-09-19

This document records the public patterns studied before adding OviPets-specific agents and skills. The project uses original instructions tailored to this codebase; third-party prompts are not copied wholesale.

## Sources reviewed

### Anthropic — anthropics/skills

Repository: https://github.com/anthropics/skills

Useful pattern:

- a skill is a small self-contained folder with SKILL.md;
- name + description are the always-visible activation metadata;
- the skill body is loaded only when triggered;
- scripts/references/assets provide progressive disclosure rather than growing one huge prompt;
- critical skills should be evaluated with representative prompts/cases.

Adopted here: small project-specific skills with narrow triggers and supporting project docs outside the skill body.

### Anthropic — anthropics/claude-code code-review workflow

Repository: https://github.com/anthropics/claude-code

Useful pattern:

- launch multiple independent reviewers for the same diff;
- separate instruction/compliance checking from bug hunting;
- validate candidate findings before surfacing them;
- optimize for high-signal findings and aggressively avoid speculative/style noise.

Adopted here: specialist lifecycle/DOM/refactor/performance reviewers plus a final OviPets regression reviewer.

### Anthropic — PR review toolkit

Repository: https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit

Useful pattern:

- choose a reviewer based on the kind of change rather than running every possible reviewer;
- use test-focused review before PR and targeted re-review after fixes;
- run independent concerns in parallel only when they do not depend on each other.

Adopted here: AGENTS.md routes worker, DOM, tests, refactors and performance to different specialists, while the main agent owns integration.

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
- use isolated/subagent context for exploratory work when appropriate.

Adopted here: flat .claude/agents files, folder-based skills, explicit known-failure checklists, and a primary-agent integration rule.

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

MV3 worker suspension, durable state, tab ownership and generation races are the highest-risk reliability area.

### ovi-dom-contract-auditor

OviPets is an external live website. Selector assumptions and action-completion signals must be treated as versioned contracts.

### ovi-regression-test-engineer

The project is being hardened and refactored while behavior must remain stable. Characterization and state-machine tests are essential.

### ovi-refactor-architect

content.js is too large, but a big-bang rewrite is riskier than the current debt. This agent enforces extraction boundaries and dependency direction.

### ovi-performance-auditor

MutationObserver churn, full IndexedDB materialization and mutation throughput become increasingly important as pet/friend counts grow.

### oweh-regression-reviewer

This is the final project-specific cross-cutting review layer. It checks known OviPets failure classes rather than producing generic style advice.

## Why these skills were selected

- safe-module-extraction — repeatable behavior-preserving refactor workflow.
- worker-state-machine — protocol checklist for owner/generation/tab ownership/ACK/recovery.
- dom-contract-audit — repeatable live-DOM evidence workflow.
- regression-proof — test-first bug/regression procedure.
- release-gate — deterministic pre-merge/release verification.

## Working rule for agent count

Use the fewest specialists that materially reduce risk. Do not run every agent on every change. Parallel agents are for independent reading/review; conflicting writes to the same files remain owned by the primary implementation agent.

## Patterns intentionally not adopted

- Huge generic agent packs: too much overlap and activation ambiguity.
- Auto-install/self-updating third-party skills: project agents must remain reviewable and pinned in this repository.
- Agents that can both redesign architecture and merge their own work without review.
- Generic style-review agents that produce large low-signal nit lists.
- Persistent in-memory assumptions for MV3 background state.
- Blind copying of third-party prompts, hooks or install scripts.

## Security and maintenance rule for third-party material

Never run an external install script or copy a third-party skill into this project without reading its complete contents, license and tool permissions first. Convert useful ideas into small OviPets-specific instructions and keep them under version control.

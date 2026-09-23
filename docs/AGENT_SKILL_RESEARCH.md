# Agent & Skill Research Notes

Date: 2026-09-19

Public patterns reviewed: anthropics/skills, anthropics/claude-code code-review workflow, shanraisshan/claude-code-best-practice, erkcet/awesome-claude-code, shakacode/claude-code-commands-skills-agents, rlespinasse/agent-skills, ever-just/agentskills, JayRHa/AgentSkills.

Adopted principles: small self-contained skills; descriptions as triggers; progressive disclosure; specialized agents with isolated context; multiple independent high-signal reviewers; Gotchas/edge cases; procedures rather than generic advice; explicit evaluation scenarios for critical workflows.

Selected agents: MV3 lifecycle, DOM contract, regression test, refactor architect, performance audit, plus final regression reviewer.

Selected skills: safe-module-extraction, worker-state-machine, dom-contract-audit, regression-proof, release-gate.

Not adopted: huge generic packs, self-updating third-party skills, agents that redesign and self-merge without review, low-signal style nit reviewers, or external install scripts that have not been audited.

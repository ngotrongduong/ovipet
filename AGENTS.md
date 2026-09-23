# Agent Routing

Use specialized agents to reduce context mixing. The main agent owns the plan and final integration decision.

| Task | Primary agent | Secondary review |
| --- | --- | --- |
| Worker claim/start/stop/recovery | ovi-mv3-lifecycle-reviewer | oweh-regression-reviewer |
| DOM selectors/live OviPets behavior | ovi-dom-contract-auditor | ovi-regression-test-engineer |
| Bug reproduction/tests | ovi-regression-test-engineer | oweh-regression-reviewer |
| content.js/background.js extraction | ovi-refactor-architect | ovi-regression-test-engineer |
| Observer/DB/concurrency efficiency | ovi-performance-auditor | ovi-mv3-lifecycle-reviewer |
| Any PR before merge | oweh-regression-reviewer | relevant specialist |

Specialists report evidence, risks and recommended changes. They do not silently expand scope. Large runtime changes require implementation followed by independent review.

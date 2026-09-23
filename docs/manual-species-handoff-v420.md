# Manual species handoff (v4.20)

When a Hatchery worker receives a `Name the Species` dialog, it must not wait for human
input and must not abandon the remaining queue.

1. Record the challenge and the exact egg ID.
2. Open one active profile tab for that egg with `oweh_species_manual=1`.
3. Cancel the worker's blocking dialog.
4. Exclude that egg ID while its manual tab exists.
5. Continue the worker's current list and subsequent friend Hatcheries.
6. In the manual tab, invoke Turn Egg once, alert the user, and never auto-select a learned
   answer.
7. The user answers and closes the tab manually. Closing only clears the exclusion; it
   never sends a resume/navigation command to the worker.

The service worker persists manual-tab sessions so suspension does not lose duplicate-tab
protection. Chrome's tab-removal event clears a session even if the tab is closed before
verification completes.

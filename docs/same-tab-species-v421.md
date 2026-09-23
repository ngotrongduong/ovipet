# Same-tab species verification (v4.21)

The `Name the Species` dialog is session-bound to the tab and Turn Egg command that
created it. Therefore the extension keeps that original dialog alive.

1. The page-wide watcher and command waiter detect the visible dialog.
2. The service worker activates the exact tab and focuses its window.
3. The offscreen audio document plays the configured three-note alert.
4. The user selects an answer and presses **OK** in that tab.
5. Correct and rejected selections update the existing local image/species history.
6. When the Turn Egg callback completes and the dialog disappears, the same queue
   advances to the next egg without restarting.

The worker containing the prompt necessarily waits because the game command itself is
pending. Independent automation in other tabs is unaffected. The helper never opens a
replacement tab and never auto-selects an answer in this workflow.

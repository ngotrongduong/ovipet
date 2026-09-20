# v5.3.12 — Ninja + Ads Friend Discovery

Date: 2026-09-20

Source baseline: user-supplied `ovipet-v5.3.11-fast-sweep-lightweight(1).zip`.

## Behavior

- Scan both `Ninja please` and `Ads post` on `#!/OviPets`.
- Do not depend on vertical order.
- Expand each post independently through the rolling last 24 hours.
- Merge candidates by stable OviPets User ID.
- Keep only one queue entry per ID, using the newest qualifying comment.
- Reuse existing `owehFriendRequestHistory` globally across both sources.
- Preserve self filtering and explicit no-friend-request filtering.
- If one post is missing/disappears, continue with the other.
- Scan writes `owehChatQueue` only; sending remains a separate job.

## Runtime files changed

- `dom/chat.js`
- `content.js`
- `jobs/ninja.js`
- `jobs/requests.js`
- `ui/panel.js`
- `manifest.json`
- `tests/friends-chat-dom.test.js`
- `tests/jobs-behavior.test.js`
- release/docs metadata

## Verification

- JavaScript syntax: PASS
- Release consistency: PASS
- Full Node suite: 59/59 PASS
- Focused Ninja/chat soak: 20 rounds × 2 files = 40/40 PASS
- Clean-extracted final ZIP: 59/59 PASS
- Final ZIP SHA-256: `69e474dc38260991df3d833ca2c41d6d25046b18e8fc356c128e73762ed252d7`

## Remaining live gate

Load v5.3.12 in Edge and confirm the real current `Ads post` DOM is matched and that expected IDs from both source posts appear in the combined queue. Do not close Issue #8 until that live check passes.

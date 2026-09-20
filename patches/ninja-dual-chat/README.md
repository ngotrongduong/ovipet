# Ninja Please dual-conversation patch

Issue: #8

This patch freezes the candidate-selection behavior requested for the existing **Ninja Please** task while the validated v5.3.11 runtime/test tree is still local and has not yet been imported into GitHub.

## Required runtime behavior

The scan job must inspect both named conversations on the existing OviPets chat route:

- `Ninja please`
- `Ads post`

Conversation order is irrelevant. Locate conversations by normalized title, not by "top"/"bottom" position.

For each source, collect stable user IDs from messages in the rolling last 24 hours. Merge both sources by user ID, then subtract the existing persistent friend-request sent/dispatched history.

The resulting queue is:

```text
(unique recent IDs from Ninja please
 UNION
 unique recent IDs from Ads post)
 MINUS
 IDs already present in persistent friend-request history
```

The existing separation between **Scan** and **Send requests** remains unchanged. Scan is read-only with respect to OviPets mutations.

## Module

`ninja-dual-chat-policy.js` is deliberately adapter-driven so the current runtime can retain its existing DOM selectors, route handling, storage key/schema and friend-request sender.

Call `scanDualConversationCandidates(...)` with the current runtime's existing adapters:

- `listConversations()`: returns the visible/available conversations.
- `conversationTitleOf(conversation)`: optional, if title is not `title/name/label`.
- `openConversation(conversation, canonicalTitle)`: uses the current UI navigation.
- `readMessages(conversation, canonicalTitle)`: returns the current conversation messages.
- `userIdOf(message)`: optional; must return the stable OviPets user ID.
- `timestampOf(message)`: optional; must return the message timestamp.
- `getSentIds()`: returns the existing persistent sent/dispatched friend-request history.
- `onSourceError(...)`: optional diagnostic hook.

Do **not** create a second sent-history key for Ads post. Both source conversations must use the same existing global history.

Do **not** replace current DOM selectors with guessed selectors. The runtime integration should reuse the validated `dom/chat` contract already used by Ninja Please.

## Tests

Run:

```powershell
node --test patches/ninja-dual-chat/ninja-dual-chat-policy.test.js
```

Covered cases:

- Ninja-only recent user;
- Ads-post-only recent user;
- duplicate user across both conversations;
- repeat posts by the same user;
- persistent sent-history exclusion;
- older-than-24h exclusion;
- either target missing;
- swapped vertical order;
- per-source fail-soft behavior;
- rerun after dispatch excludes IDs newly recorded in history.

## Runtime integration gate

This branch is **not** the final Edge release because GitHub still does not contain the v5.3.11 runtime source. Before calling Issue #8 implemented in the live extension:

1. import/publish the current validated v5.3.11 runtime tree;
2. wire this policy into the existing Ninja Scan job using existing chat/storage adapters;
3. add the regression cases to the runtime's normal test suite;
4. run syntax, release-consistency and full tests;
5. live-check both conversations in Edge;
6. confirm Send requests still records into the same persistent history and never dispatches the same user ID twice.

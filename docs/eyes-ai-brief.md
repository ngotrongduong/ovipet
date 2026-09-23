**Status (2026-09-17): items 1–5 and 6a/6b/6c below were answered** — see
`docs/dom-audit-2026-09-17.md` and `docs/dom-audit-2026-09-17.md`'s companion raw HTML
capture for the full findings, now applied in `content.js`. Still open: the Unofficial
pure-color list (needs joining forum group 8966) and 6c's post-success behavior (the test
breed was cancelled, not confirmed). The rest of this file is kept as a record of what was
asked and how, and as a template for any future DOM-confirmation request.

# Brief for the site-operating AI ("mắt" trên OviPets)

Purpose: this extension automates OviPets purely through the game's own visible UI (no
API calls). Several features are implemented against **guessed** DOM selectors because
the pages in question require a logged-in session I (Claude, working from source code
only) cannot reach. I need you to log in, navigate to each page below, and report back
the exact live HTML/values so I can replace guesses with confirmed selectors. Please
record, for each item: the exact page URL/hash, a saved copy of the relevant HTML
(view-source or "Inspect Element" copy, not a screenshot transcription), and any
selectors (`class`, `id`, `onclick` pattern) you can see in dev tools.

## 1. Official / Unofficial pure-color tables (highest priority)

Visit these two forum threads and list **every** color name with its Hex and RGB code
exactly as posted:

- `ovipets.com/#!/?src=group&sub=forum&grp=8966&topic=568773f3fccfd93f267b82aa` (Official)
- `ovipets.com/#!/?src=group&sub=forum&grp=8966&topic=568774edfccfd9bc507b4af8` (Unofficial)

This fills in `PURE_COLORS` in `content.js` (currently only ~14 colors guessed from a
tutorial doc, explicitly marked unverified).

## 2. Pedigree section DOM (for the inbreeding warning)

Open any pet profile that has a visible Pedigree/family tree (a pet with known parents,
several generations if possible). Report:

- The exact container element for the pedigree block (tag, class/id, any heading text
  used, e.g. "Pedigree").
- The exact link markup for each ancestor shown (is it `<a class="pet" href="...pet=123">`
  like elsewhere in the game, or different?).
- How far back the visible pedigree actually goes (how many generations are shown before
  the game stops rendering ancestors) — this defines what "shares a visible ancestor"
  should mean.
- Whether there's any visible indicator when two specific pets are checked for
  breeding-eligibility and the game itself blocks/warns about relation (e.g. does the
  breed confirmation dialog say anything when they're related?).

Current code (`pedigreeAncestorIds` in `content.js`) guesses the container by searching
for a heading matching `/Pedigree/i`. If that's wrong, tell me what the real container
looks like.

## 3. Pet rename control (for "apply suggested name" automation)

Open a pet profile you own and find wherever the name can be edited. Report:

- The exact button/link that opens the rename control (text, tag, any `onclick`).
- The exact input field's `name`/`id` attribute once the rename form is open.
- The exact submit/save control (text, tag, `onclick`).

Right now the extension only *suggests* a name and lets you copy it to the clipboard —
it does not fill/submit the rename form because I don't know this DOM. With this info I
can add a one-click "Apply suggested name" button.

## 4. Breeding-tab partner cards — confirm current selectors still hold

Current code assumes: candidates are `<a onclick="...pet_breed(...)...">` and the onclick
attribute contains `MotherID=<id>` and `FatherID=<id>` substrings. Open a Breeding tab
with several visible candidates and confirm (or correct) this by pasting the raw
`onclick` attribute value of two or three candidate cards.

## 5. Colors table — confirm current selectors still hold

Current code reads a `<table>` inside `<main>` where each row's first `<td>` is a label
(`Body`, `Scales`, `Extra`) and the following `<td>`s contain hex codes like `#C0C0C0`.
Open a pet profile's Colors view and paste the raw HTML of that table so I can confirm
row/column structure, and confirm whether the visible "Eyes" color (mentioned in the
breeding guide) is shown anywhere in this table or elsewhere on the page — it's currently
not read at all.

## 6. Full auto-breed campaign — Overview list → Breeding tab → confirm

Goal (per Game Owner): scan the pet Overview list, skip pets that can't currently breed,
open each breedable pet, open its Breeding tab, and have the extension pick and click the
best partner (using the existing pure-breeding ranking) to actually start a breeding pair
— repeated across many pets and many generations. None of this is built yet because every
step below touches DOM I've never seen. Please capture all of it in one pass, since the
steps are sequential (you'll naturally go through them in order while testing).

### 6a. Overview list — `https://ovipets.com/#!/?src=pets&sub=overview`

- Paste the raw HTML for one pet card that shows the blue heart icon, and one pet card
  that does **not** show it (the Game Owner says: no blue heart = can currently breed;
  blue heart = can't right now — likely a cooldown state). I need the exact tag/class/
  `src`/`title`/`alt` of that heart icon so the extension can tell them apart.
- Paste the raw HTML of the pet card's link/container (how do I get the pet's numeric ID
  and a link to open it from this list — same `a.pet[href*="pet="]` pattern used
  elsewhere, or different on this page?).
- Does this list paginate or infinite-scroll? If there are more pets than fit on screen,
  how do I load the rest (a "Load more" button, page number links, or does everything
  render at once)?

### 6b. Opening the Breeding tab from a pet page

Image 3 the Game Owner shared shows tabs: Overview / Pedigree / Breeding / Lab / Edit.
Open a pet you own and paste the raw HTML of that whole tab bar, and specifically:

- What element is the "Breeding" tab (tag, text, `onclick`/`href`, any class that marks
  it active/inactive)?
- After clicking it, does the URL/hash change (e.g. adds `&tab=breeding`), or does the
  page swap content in place with no hash change? I need to know because the extension
  currently decides what to do based on reading `location.hash`.
- How long after clicking does the candidate list actually render (is there a loading
  spinner, or is it instant)?

### 6c. The breeding confirmation flow — this step takes a real action, see note below

Once the Breeding tab is open and showing candidates:

- Click one candidate card. Paste the raw HTML of whatever appears next — is it a
  confirmation dialog/modal? If so, its exact container, its text, and its confirm/cancel
  buttons' tag+text+`onclick`.
- If you confirm it: what does the page show afterward (success message text, does it
  redirect anywhere, does anything change immediately on the pet's own page)?
- After a successful breed, does the just-bred pet immediately show the blue heart icon
  back on the Overview list, or does that take time to update?
- Where does the resulting egg actually appear — the player's own Hatchery, both parents'
  Hatcheries, or somewhere else? Does it appear instantly or only after some delay?

**This step is a real, non-undoable game action** (it consumes whatever cooldown/resource
breeding costs) — unlike the read-only checks in sections 1–5. Please only do it
intentionally, on a pair the Game Owner is fine with actually breeding, and say so plainly
when reporting back (e.g. "bred pet X with pet Y to observe this, resulting egg id Z").
Don't do this multiple times just to compare cases — one real pass through the flow, fully
recorded, is enough for me to build against.

### 7. "Name the Species" dialog — what happens after a WRONG answer

The extension (v4.2.0) now guesses an answer when it isn't sure, and needs to tell right
from wrong to learn. Next time this dialog comes up naturally during normal play (don't
force it), deliberately click a species option you know is wrong, then click Ok, and
report exactly what happens:

- Does the same dialog stay open (same image, same options), just not close?
- Does an error message appear anywhere?
- Does a completely different challenge (different image and/or options) replace it?
- Does the whole action just fail silently with no dialog at all?

Current code assumes the first case (same dialog stays open) to decide "that guess was
wrong, try another." If it's actually one of the other cases, that detection logic
(`waitForProfileTurnChange` in `content.js`, see `CLAUDE.md`'s "Species-verification
guessing" section) needs to change.

### 8. A friend's egg opened in its own tab (Start full sweep, v5.3.0)

"Start full sweep" now opens one browser tab per egg and turns it there. It builds this URL
from the egg's Hatchery card (`usr=` and `pet=` from the card's `a.pet` href, falling back
to the friend being swept):

`https://ovipets.com/#!/?src=pets&sub=profile&usr=<friend id>&pet=<egg id>`

Please check with a real friend's Hatchery that has at least one green "Turn Egg" egg
(open it in a NEW tab and read only — do not press Turn Egg unless the Game Owner asked):

- Does that URL open the egg's own page, and does the page show a `button[onclick*="pet_turn_egg"]`
  (the "Turn Egg" button) for a friend's egg, the same as for your own?
- Does the Hatchery card's `a.pet` href for a friend's egg actually contain `usr=<friend id>`
  and `pet=<egg id>`? Paste one real href.
- After an egg is turned, does that button disappear from the egg page (this is what the
  extension treats as "confirmed turned")? If something else changes instead (text, disabled
  state), say what.
- If a Name the Species dialog appears on the egg page, is it the same dialog as on the
  Hatchery page?

Until this is confirmed the tab flow is unverified against a live friend's egg: if the page
has no Turn Egg button the tab reports "already (no-turn-button)" and the sweep re-reads the
Hatchery, so a wrong assumption shows up as "could not be confirmed after 2 tries" rather
than a false success.

## What NOT to do

Don't click any destructive action (Remove Friend, Turn Egg, breeding confirmation,
rename submit) unless you're specifically testing item 3 (rename) on a throwaway pet, item
6c (breeding) on a pair the Game Owner has actually approved breeding, or item 7 (clicking
a known-wrong species answer, which the game already prompted you for — not something you
sought out). Everything else in this brief is a read/record pass, not an automation run.

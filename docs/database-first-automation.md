# Database-first automation

## Data sources

The Overview card catalog is the cheap source for Pet ID, displayed name, enclosure name
and ID, image `modified` marker, and blue-heart cooldown state. Every enclosure tab is
opened once per fresh campaign so the snapshot includes the whole collection.

A pet profile is the only visible-UI source for gender, species, Body 1, Body 2, Scales,
Extra 1, Extra 2, Food, and the visible three-generation pedigree. These values are read
once and retained by Pet ID. A profile is reopened only when the record is incomplete or
the card's `modified` marker changes.

UI commands are mutation commands, not read queries. They can rename, move, feed, turn,
remove/request friendship, and breed, but they do not return the missing color or pedigree
table. The extension therefore never invents those fields and never treats a mutation
command as a database API.

## Breeding pipeline

1. Scan all enclosure card panels once.
2. Merge card state into the Pet-ID database and mark absent IDs as not present.
3. Refresh only new, changed, or incomplete profiles.
4. Select females with no blue heart from pure-line enclosures and `Breeding Stock`.
5. Select complete, cooldown-free males from `Males` for the same species.
6. Exclude the same pet, parent/child pairs, and shared visible ancestors.
7. Rank Body 1 reachability and complementary FF positions before whole-target metrics.
8. Send one observed `pet_breed` UI command per planned female and wait for its callback.
9. Record the pair and mark the female cooldown locally; the next card snapshot remains
   authoritative and can correct stale state.

## Refresh policy

- Card catalog: once at the beginning of a campaign or Daily Maintenance.
- Profile metadata: new ID, missing required field, changed `modified` marker, or wrong
  generated name.
- Enclosure move: only when current and desired enclosure differ.
- Feed: skip a known 100% pet or a pet fed within the recent-full window.
- Hatchling: capture the complete record during `Unnamed` processing, avoiding a later
  profile scan.

## Safety and limitations

Pedigree safety is limited to the ancestors visible in OviPets. A missing warning cannot
prove two pets are unrelated beyond the rendered generations. Direct breeding records a
command-confirmed pairing; it does not fabricate an egg ID when the callback does not
provide one. Server-side rejection is recorded as an error and is not blindly retried.

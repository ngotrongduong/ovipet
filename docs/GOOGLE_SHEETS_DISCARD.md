# Export all OviPets pet/egg colors and discard by explicit ID

This feature is in Full OviPets Hatchery Helper **v5.13.0 candidate**. It is independent from heuristic **Discard surplus**; an ID the owner marks is an explicit instruction, regardless of the pet's genetic value.

## Export owned pets and eggs

1. Open OviPets with the **Full** extension, expand **Pet / Egg Spreadsheet**.
2. Click **Export all pets + eggs CSV**. This reads live owned enclosures and the Hatchery; it fetches missing color profiles in small batches.
3. A downloaded `ovipets-inventory-YYYY-MM-DD.csv` contains **ID, Kind, Species, Name, Gender, Enclosure, Body1, Body2, Scales, Extra1, Extra2, Generated, PedigreeVerified, ParentIDs, DataStatus, Discard**.
4. Upload or import the CSV into a *private* Google Sheet. Import `ID` as **plain text** to avoid converting large numeric IDs to scientific notation.
5. Filter by any five-color combination, kind or species. Mark **YES** in the **Discard** column for only the rows you intend to remove.

The exporter aborts rather than producing a misleading complete list if the Overview or Hatchery cannot be read completely. If a profile remains unreadable, its ID stays in the CSV with `DataStatus=missing-colors`.

## Read the Discard list

Choose **exactly one** input in the extension panel:
- **Private/local CSV**: download the marked Google Sheet as CSV and choose the file under **Or private CSV file**.
- **Published Google Sheets CSV URL**: use **File → Share → Publish to web**, select only a dedicated **ID discard-list tab**, format **CSV**; paste the `https://docs.google.com/spreadsheets/d/e/.../pub?output=csv` link. Read-only public exports using `/d/{id}/export?format=csv&gid={tab}` are also supported if actually accessible.
- **Pasted IDs**: one numeric ID per line. This is shorthand for marking each pasted ID as YES. Clear the URL and file input first.

For multi-column CSV files, the header must contain `ID` (or `PetID`/`EggID`) and `Discard`. Values **YES / Y / TRUE / 1 / DISCARD / DELETE / X** select an ID. Empty, NO, FALSE, 0 and KEEP do not. Duplicates are collapsed. A plain one-column file can contain only IDs, optionally with an ID header.

**Do not publish your full pet inventory just to use a URL.** Published Sheets CSV may be accessible by anybody with the link. Prefer private CSV download/import; if the published option is necessary, publish a separate minimal sheet with only the ID and Discard columns.

## Execute

1. Click **1 · Load & review IDs**. The extension checks the selected IDs against your **live owned Overview and Hatchery**; missing/non-owned IDs are not queued. This is read-only.
2. Check the preview for the number and examples of IDs and whether they are pets or eggs. For a large list, begin with 1–5 known disposable IDs.
3. Choose **Max IDs per run**, default 25, maximum 200. Click **2 · Confirm & discard IDs**.
4. The extension sends OviPets' existing UI-backed Discard command for each queued ID, using the shared-worker lease, confirms removals against live lists, and records any unknown/unverified outcome without automatically retrying it.
5. Use **Stop** to stop further sends. To continue with remaining queued IDs on the same reviewed plan, press Confirm again while the plan is fresh (15-minute limit). If expired, reload and review the source again.

**Discard is permanent.** The first live run must be supervised. An incomplete live read stops the job. A pet that changed from egg to hatched is skipped. The action is never driven by a guessed ID or an invented game endpoint.

## Important limits

- The extension does **not** create or edit your Google Sheet, nor automatically monitor it every few minutes. It reads a CSV URL **when you press Load & review** and then performs the selected batch after confirmation.
- Google OAuth/private Sheet URLs are **not** supported directly; use local CSV for private spreadsheets.
- Browser/extension sessions are not guaranteed to survive long multi-hour jobs. The max-per-run limit is intentional.
- No data is uploaded to GitHub or Google by this extension; downloaded CSV is stored on your computer unless you upload it yourself.
- Saved lists contain only the reviewed IDs and limited metadata in extension storage. An interrupted/ambiguous command is not automatically repeated.

## QA before enabling on valuable stock

- [x] Automated CSV parsing, malformed/corrupted file and Sheets origin checks.
- [x] Automated explicit-ID preview / confirmed dispatch / no-duplicate test.
- [ ] Live Edge: export includes the correct counts of own pets and eggs.
- [ ] Live Edge: color fields are correct on representative eggs and pet profiles.
- [ ] Live Edge: one disposable egg and one disposable hatched pet are removed and verified.
- [ ] Live Edge: invalid IDs, missing enclosures, Stop and timeout paths are confirmed.
- [ ] Live Edge: published Sheets CSV URL works with the actual Google response.

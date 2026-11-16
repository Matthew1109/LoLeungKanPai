# Phase 2 plan (v5): Drink Entry Management + Backup/Restore

Status: **checkpoint 2c delivered for review.** Decisions E1 to E8 are approved, including **E3 (restore), approved as v3**. Checkpoints **2a** (data layer) and **2b** (add, view, edit and delete a drink, with photo and draft recovery) are **approved**. Checkpoint **2c** (backup export and restore) is **delivered for review**; final Phase 2 sign-off follows your typecheck, tests, build and iPhone checks.

What changed from v4: the 2b approval is recorded; E1 is implemented with my own small ZIP writer/reader instead of fflate (the fallback that section 8 already named); section 8 describes what was built; section 9 notes that the commit also deletes the entry draft; sections 10 to 13 are brought up to date; section 15 is new (what 2c contains and the small decisions in it). The restore design (section 9, E3 v3 with the binding pre-commit check) is unchanged.

## 1. Scope
1. Add / view / edit / delete drink entries; several entries per day; change an entry's date; favourite toggle.
2. Photographs: Take Photo, Choose from Photos, preview, replace, remove, optimisation, local IndexedDB storage, orphan clean-up.
3. Working backup export and restore (moved forward from Phase 5): ZIP export, validated replace-all restore, backup reminder.
4. Automatic calendar cover only: the earliest photographed drink of the day. Manual-cover code is removed.
5. Tags: the form does not select tags yet (Phase 3), but editing an entry **preserves** its tag ids and the detail view shows its tag chips.

Out of scope: tag pickers and management (Phase 3); gallery, search, collections (Phase 4); merge restore, storage meter and quota warnings, polish (Phase 5).

## 2. Decisions
| # | Decision | Status |
|---|---|---|
| E1 | ZIP backup, plain and bounded in memory. Approved as fflate; **implemented with the fallback v4 named: my own small ZIP writer/reader, no new dependency** (reasons in section 8). | approved; implementation changed, see section 8 |
| E2 | Thumbnails are not exported; they are regenerated on restore. | approved |
| E3 | Restore architecture: always new photo ids, staging under a maintenance lock, atomic metadata commit, diary intact on any failure. Liveness is decided by the Web Lock alone, never by age. Section 9. | approved (v3) |
| E4 | Default time of a new entry: now if the date is today, otherwise 20:00 (editable). | approved |
| E5 | Draft protection for the form's text fields, with the safeguards in section 6. | approved |
| E6 | Backup reminder after 10 distinct entries created/edited since the last backup, or 30 days. Rules in section 7. | approved |
| E7 | Plain `.zip`, named `LoLeungKanPai-backup-YYYY-MM-DD.zip`. | approved |
| E8 | Checkpoints 2a, 2b, 2c with your typecheck/test/build after each; final sign-off after 2c. | approved |

## 3. Data model: no schema change, no migration
- The database stays at **version 1**. `DrinkEntry`, `Tag`, `photos`, `thumbs` are exactly as in Phase 1.
- Three small records are added to the existing `meta` key/value store (plain data, not schema): `restoreSession`, `backupState`, `entryDraft`.
- `dayCovers` stays in the schema as a reserved, unused store. Nothing reads or writes it.
- One photograph per entry; each `photoId` belongs to exactly one entry.

## 4. Entry write rules (implemented in 2a and 2b: `src/db/entryRepo.ts`, `tx.ts`, `maintenance.ts`)
1. **One transaction** over `entries`, `photos`, `thumbs`, `meta`. A save writes the entry, a new photo + thumbnail, deletes a replaced/removed photo + thumbnail (unless another entry still references it), records the backup bookkeeping (section 7) and removes the matching form draft (section 6). All or nothing.
2. **Explicit abort.** IndexedDB does not roll back when our own code throws, it would commit what was already written. `runWriteTx` aborts the transaction on any error. Inside a transaction only IndexedDB requests are awaited.
3. **Validate first** (nothing written on failure; the error lists every faulty field): `dateTime` required, parseable, year 1900 to 2100; ABV 0 to 100; volume above 0 and at most 5000 ml; category from the list or none; name, bar, notes are text. The same validator will check entries read from a backup.
4. **The repository owns the derived fields:** `dayKey` (local calendar day of `dateTime`), `createdAt` (kept on edits), `updatedAt` (now), `photoId` (from the photo change). A form cannot get them wrong.
5. **No duplicates.** The form reserves the entry id when it opens; Save is a `put` by id and is disabled while saving, so a double tap or an edit cannot create a second entry.
6. **Photo change is explicit:** `keep` (default), `remove`, `replace`. Editing never touches the photo unless told to.
7. Image processing happens **before** the transaction opens.
8. **Delete** (confirmation in the UI) removes the entry and its photo + thumbnail in one transaction. The favourite heart toggles in place.
9. **Restore guard:** while a restore-session record exists, saves, favourite toggles and deletes are refused (`RestoreInProgressError`), checked inside the write transaction. The record's age is never consulted. If it is a leftover from a restore whose page died, the refused tab makes **one** orphan-sweep attempt with `ifAvailable` (item 11) and, if the sweep ran, **retries the write once**; if the lock is held, the message stays "A restore is in progress".
10. **Storage errors:** quota errors become `StorageFullError` ("Not enough storage. Export a backup, then free space"); nothing is half-saved.
11. **Orphan sweep** (photos/thumbnails no entry references): runs in the background at every start and after a restore. **Every sweep holds the exclusive Web Lock `lkp-maintenance` from before its first read until after its last delete**; in code a sweep cannot start without a lock-hold token (`LockHold`), issued only by the lock helper. It requests the lock with `ifAvailable` and **skips entirely** if it is held (a live or merely suspended restore). If it gets the lock, no restore is alive, so it also deletes a leftover session record together with the staged photos. Without Web Locks it runs only when no session record exists and never deletes one (section 9, step 6). One transaction. It never blocks or fails app start. No age or elapsed time is consulted.
12. **Calendar refresh:** repositories call `notifyDataChanged()` after commit. The cover is derived, never stored: earliest photographed entry of the day by `dateTime` (ties: `createdAt`, then `id`). It moves by itself when the cover entry is deleted, re-dated or loses its photo, or when an earlier photographed drink is added or back-dated. Unit-tested for each case.

## 5. Photo capture and storage
- Two hidden file inputs behind two buttons: **Take Photo** (`accept="image/*" capture="environment"`) and **Choose from Photos** (`accept="image/*"`). No `getUserMedia`.
- Pipeline (Phase 1, `processPhoto`): decode with EXIF orientation, downscale to 1600 px, JPEG q0.82, 480 px thumbnail. One image at a time; canvases released.
- HEIC: Safari's native conversion only; if decoding fails, a clear error and the form stays as it was. A broken image is never stored.
- The file input is reset after each pick so the same photo can be chosen again.

## 6. Draft protection (E5)
iOS can suspend or reload a Home Screen app while the camera is open, losing a half-filled form.
- One draft in `meta.entryDraft`: `{ entryId, mode: 'new' | 'edit', baseUpdatedAt, savedAt, fields }`. Text fields as typed; photos are not drafted.
- Saved (debounced) while typing. **Cleared** on Save and on delete of that entry (same transaction as the write), and on Cancel/Discard.
- **A stale draft never overwrites a new entry unexpectedly:** opening `/add` does not silently apply an old draft; if one exists the screen offers *Resume draft* or *Start fresh*.
- Edit drafts remember the entry's `updatedAt` when the form opened; if the entry changed since, the draft is ignored and discarded.
- A malformed draft counts as no draft.
- Limitation: HashRouter cannot block tab-bar navigation, so the "discard changes?" prompt covers Cancel/Back inside the form; the draft covers accidental exits.

## 7. Backup reminder (E6)
- `meta.backupState = { lastBackupAt, changed: { entryId: time } }`, updated **inside the save transaction**, so it cannot disagree with the data.
- Due when **10 or more distinct entries** were created or edited since the last backup, or **30 days** have passed since the last backup and something is unprotected. A journal never backed up counts every entry, and its 30 days run from the first entry.
- A favourite toggle counts as an edit; deleting an entry removes it from the count. Entries edited again while a backup was being built stay "changed".
- Shown as a small non-blocking banner. *Proposed detail (yours to veto): dismissing it snoozes it for 24 hours.*
- "Last backup" means the file was handed to the share sheet or download. The app cannot verify where it ended up, and the wording will say so.
- **Rules retained (implemented and tested in 2a):** a backup marks as protected only the changes made at or before its snapshot time; an entry edited while the file is being built stays unprotected; repeated edits to one entry count once toward the 10-entry threshold. 2c adds an end-to-end "export while editing" test for this (section 11).

## 8. Backup format (E1, E7)
```
LoLeungKanPai-backup-YYYY-MM-DD.zip
  photos/<photoId>.jpg   full-size optimised JPEGs, not re-compressed
  data.json              { entries: DrinkEntry[], tags: Tag[], photos: [{ id, mime, size, width, height, createdAt }] }
  manifest.json          { app, formatVersion: 1, dbSchemaVersion: 1, appVersion, createdAt, counts, dateRange }
```
- The order of files inside the archive does not matter: readers use the ZIP directory. The writer puts the photos first and `data.json` and `manifest.json` last, because they describe the photos.
- Thumbnails and `dayCovers` are not exported. The file name uses the device's local date.
- **Own ZIP code instead of fflate (E1's named fallback), `src/backup/zip.ts`.** I cannot install packages or run Vitest here, so fflate's streaming reader could not be tried before delivery, and v4 said the fallback was my own writer/reader checked against Python's `zipfile`. That is what is delivered. **`package.json` is unchanged**: there is no `npm install` step for 2c and no new dependency.
- Writer: photos stored (method 0), sizes and CRC-32 known up front, so there are no data descriptors; UTF-8 names; each file is wrapped in its own `Blob`, so the browser and not the JS heap holds the bytes and only one photo is in memory at a time. No ZIP64: a backup beyond 4 GB or 65,535 files is refused with a message.
- Reader: reads the ZIP directory and then single entries from `Blob.slice()`, so only one entry is in memory at a time. It accepts stored and deflated entries, so a backup you re-zipped on a Mac is accepted (Finder's `__MACOSX` and `.DS_Store` files and one wrapping folder are ignored). Every entry's CRC-32 and size are verified. Encrypted, ZIP64 and multi-part archives are rejected with a clear message. Reading *deflated* entries uses `DecompressionStream('deflate-raw')` (Safari 16.4 or later); backups made by the app are stored and do not need it.
- Verified here in both directions against Python's `zipfile` (see section 11).
- No `fetch()` of `blob:` URLs anywhere: the production CSP (`connect-src 'self'`) blocks it.

**Export flow:** Create backup (progress) -> a **second tap** on *Save backup* (iOS needs a fresh tap for the share sheet) -> `navigator.share({ files })` so you can "Save to Files", with a download-link fallback. Entries and tags are snapshotted first and photos are read one at a time; if a photo has vanished mid-export (journal changed), the export aborts with "journal changed, try again" instead of writing an incomplete file.

## 9. Restore architecture (E3, approved as v3)
This section is the single authoritative design for restore, and for the orphan sweep and write guard that interact with it. It is implemented in 2c; the sweep, the lock helper and the write guard already exist (2a/2b).

**Why it is built this way.**
- Photos are always staged under **new ids**. Staging them under their original ids and treating "an id already exists" as "identical photo" is not safe: a backup from another install, or an older backup of this one, can contain the same id for a different picture.
- Staged photos are unreferenced until the commit, so an orphan sweep must never run while a restore could be alive.
- **Liveness is never judged by age or elapsed time.** A background iOS tab can be suspended for minutes without dying, so no amount of silence proves a restore is dead. Only the Web Lock can: the browser keeps it while a page is merely suspended and releases it exactly when the page is destroyed. There is no timeout anywhere.

**Design**
1. **Always new photo ids.** A full old-id -> new-id map is generated up front; entries' `photoId` are remapped in memory; staged photos are written with `add` (never `put`), so nothing existing can be overwritten. Entry and tag ids are replaced wholesale (replace-all), so they need no mapping. (Merge in Phase 5 will need the same.)
2. **Session record and staging.** Before staging, the restore writes `meta.restoreSession = { sessionId, startedAt, phase }` (`phase` is `staging` or `committing`). Nothing is judged by its age. Photos and regenerated thumbnails are then written one at a time into the normal `photos`/`thumbs` stores under the new ids; each photo is decoded, which validates the JPEG and produces the thumbnail. Photo ids are not listed in the record: staged photos are ordinary unreferenced photos.
3. **Maintenance lock.** The restore takes the exclusive Web Lock `lkp-maintenance` (waiting acquire) and holds it from before its baseline sweep until after its post-commit sweep. Every orphan sweep, from any source, needs this lock (section 4.11), requests it with `ifAvailable`, and **skips entirely** when it is held.
4. **Sweep ordering inside a restore.** The restore runs its own sweeps (with its own hold) only **before** it writes the session record (clean baseline) and **after** the commit. A sweep **must not run between writing the session record and the commit**: it would treat the staged photos as orphans and delete them, together with the session record.
5. **Write guard (other tabs' saves, favourite toggles, deletes).** Refused whenever a session record exists, regardless of its age; any record under that key counts, even an unreadable one. The refused tab makes one `ifAvailable` sweep: if the lock is free, no restore is alive, the sweep clears the leftover record and staged photos, and the write is retried **once**. If the lock is held, the message stays: "A restore is in progress."
6. **Browsers without Web Locks: restore is disabled.** Settings explains why; backup export still works. Orphans cannot arise from normal saves (they are atomic), so the sweep there runs only when no session record exists, and never deletes a session record. Nothing is decided by time.
7. **Commit = one transaction, with a mandatory pre-commit check (binding requirement for 2c).** The commit transaction opens `entries`, `tags` and `meta` read-write and `photos` and `thumbs` **read-only**. Inside that transaction, before anything is cleared or written, it verifies that
   - `meta.restoreSession` still exists and its `sessionId` equals this restore's own id, and
   - every staged photo and every staged thumbnail (by new id) is present.

   If any check fails, the transaction is aborted before the first write and the restore reports that it could not complete and that the diary is unchanged. Because check and writes share one transaction, nothing can change between them. Under normal operation the lock makes this situation impossible; the check is defence in depth against a bug, a partial storage eviction or a future code path that forgets the lock. If all checks pass: clear `entries` and `tags`, write the backup's entries (remapped) and tags, delete `restoreSession` and `entryDraft` (a saved form draft belongs to an entry of the old diary), set `backupState = { lastBackupAt: manifest.createdAt, changed: {} }`, record `lastRestore`. Atomic. `dayCovers` and the `defaultTagsSeeded` flag are untouched.
8. **After the commit** the old photos/thumbnails are orphans and are swept while the restore still holds the lock. The sweep also runs at every start, so an interruption right after the commit heals itself.
9. **Before the commit nothing existing changes.** Entries, tags and old photos stay exactly as they were, so a failed or interrupted restore leaves the diary intact.

**Order of work:** pick file -> pass 1 over the ZIP validates everything with **no writes** (manifest, `data.json` field by field with `validateEntry`, unique ids, every `photoId`/tag id resolves, no duplicate (category, name) tags, counts match, file names) -> summary next to what is on the device -> offer a safety backup -> strong confirmation -> take the lock -> baseline sweep (own hold) -> write the session record -> generate the id map -> pass 2 stages photos -> **commit with pre-commit check** -> post-commit sweep (own hold) -> release the lock, refresh the screens, report. The UI shows a progress screen and blocks other actions; a storage estimate is checked first (restore temporarily holds old and new photos together, so very low free space makes it fail safely rather than half-apply).

**What happens when something goes wrong**
| Interruption | Entries, tags, old photos | Staged photos / session record | Recovery |
|---|---|---|---|
| Backup file invalid (pass 1) | untouched | none written | message only |
| Storage full while staging | untouched | partial | removed immediately; if that fails, at next start |
| App killed or page reloaded while staging | untouched | partial orphans, leftover session record | the lock is released with the page: the next sweep gets it, deletes staged photos and record |
| Restore tab suspended for minutes, another tab opens | untouched | protected (lock still held) | sweep skipped, edits refused with a message; the restore carries on when its tab resumes |
| Restore tab killed, another tab then saves | untouched | leftover | the save is refused once; that tab's one `ifAvailable` sweep gets the lock, clears record and staged photos; the save is retried and succeeds |
| Commit pre-check fails (own session record gone, or a staged photo/thumbnail missing) | untouched (aborted inside the commit transaction, before any write) | whatever remains is swept later | message; the user can start the restore again |
| Commit transaction fails (quota, ...) | untouched (transaction aborted) | complete | as above |
| Crash or power loss inside the commit | either entirely old or entirely new (IndexedDB is atomic) | new: nothing left but old orphans; old: as above | sweep at next start |
| After commit, before cleanup | new diary live | old photos are orphans; session record already deleted | sweep at next start |
| Another tab edits during restore | edit refused with a message | | none needed; a suspended restore that resumes finds nothing lost |
| Another tab's sweep during restore | not run (lock held) | protected | none needed |
| Browser without Web Locks | restore disabled; nothing to clean up | none | none needed |

Not provided: resuming an interrupted restore (you simply start it again). Phase 5 adds merge and finer validation messages.

## 10. Screens and routes (HashRouter) - checkpoints 2b and 2c (delivered)
- `/add?date=YYYY-MM-DD`: new entry form (default time: E4).
- `/entry/:id`: detail view: large photo, name, time, bar, category, ABV, volume, tag chips, notes, favourite toggle, Edit, Delete.
- `/entry/:id/edit`: same form, pre-filled.
- Daily Journal cards open the detail view; the heart toggles in place; the Phase 1 "arrives in Phase 2" note is gone.
- New components: `EntryForm`, `PhotoPicker`, `ConfirmDialog`, `Toast`. 2c adds Backup and Restore sections in Settings (no new route) and a reminder banner on the Calendar; section 15.
- Details of what 2b actually does, and the small decisions behind it: section 14.

## 11. Tests and what I can verify
- **Vitest** (you run `npm test`): validation, entry save/edit/delete (no duplicates, photo keep/replace/remove, shared-photo safety, atomic rollback, restore guard, bookkeeping, draft clearing), orphan sweep under the maintenance lock (lock-hold token required, skipped when the lock is held, leftover session record and staged photos cleaned up when the lock is free, no-Web-Locks behaviour), the retry-once write guard, backup reminder rules, draft parsing, cover rules, date helpers. 2b adds tests for the form model, draft decisions, photo state, route state and error mapping. Repository tests use `fake-indexeddb`.
- **2c adds:**
  - ZIP round-trip tests (section 8): many photos, one large photo, Unicode names and text, empty values, CRC and truncation damage, and archives made by **Python's `zipfile`** (deflated with data descriptors; flat and Finder-style wrapped) as fixtures. Backup builder/validator tests (valid, corrupt, newer version, dangling tag/photo, duplicate ids, non-JPEG photo).
  - Restore ordering and failure tests (interrupt at each point of section 9), including the **pre-commit check tests (binding)**: the commit aborts, with entries, tags, photos and thumbnails unchanged, when the session record is missing, when it carries a different `sessionId`, when a staged photo is missing, and when a staged thumbnail is missing; and a test that the check and the writes happen in one transaction that opens `photos` and `thumbs` read-only.
  - A test that the restore runs no sweep between writing its session record and committing.
  - A restore-versus-second-tab test: while the restore holds the lock, other tabs' sweeps are skipped and their saves are refused.
  - **Export while editing:** an entry saved while the backup file is being built stays unprotected ("changed") after `lastBackupAt` is recorded, end to end on top of the 2a bookkeeping tests.
- **My limits in this environment:** no npm registry, so no TypeScript compiler, Vitest, `idb` or `fake-indexeddb`; no iPhone. I run the pure logic, and the repository logic against a small in-memory stand-in for the database that mimics transactions. I cannot compile or run the React components (TSX) or the CSS. None of this is real IndexedDB or Safari, so **typecheck, `npm test` and `npm run build` on your machine are the real gate**. Camera, share sheet, memory with hundreds of photos and persistence after force-quit need your iPhone; the 2c checklist is in the delivery note.

## 12. Work order
- **2a: approved.** Data layer: cover clean-up (manual-cover code removed), validation, transactional entry repository, orphan sweep and maintenance lock, restore guard, backup-reminder bookkeeping, draft storage, tests. (Your typecheck, tests and build passed.)
- **2b: approved.** Photo picker, entry form, detail view, delete flow, draft protection UI, journal wiring; the orphan sweep and write guard aligned with section 9 (every sweep under the exclusive lock, retry-once guard, no age-based logic).
- **2c: delivered for review.** Own ZIP writer/reader (E1 fallback), backup export and restore (E3 v3, including the binding pre-commit check in section 9, step 7), Settings > Backup and Restore, reminder banner, the 2c tests listed in section 11. Section 15.
You run typecheck, tests and build after each checkpoint; final Phase 2 sign-off after 2c.

## 13. Small details I decided (tell me if you disagree)
- Year range 1900 to 2100 for entry dates.
- The repository, not the form, derives `dayKey`, `createdAt`, `updatedAt`.
- A favourite toggle counts as an edit for the reminder and bumps `updatedAt`.
- Reminder's 30-day rule only fires when something is unprotected; never-backed-up journals count from the first entry.
- 24-hour snooze when the reminder banner is dismissed (built in 2c).
- Restore refuses edits from other tabs while it runs, instead of queueing them.
- More decisions made in 2b: section 14.

## 14. Checkpoint 2b: what was built, and small decisions (veto any of them)
**Built**
- **Routes:** `/add?date=YYYY-MM-DD`, `/entry/:id`, `/entry/:id/edit`. Add and Edit share one `EntryForm`.
- **Form:** the entry id is reserved when the form opens; Save is disabled while saving; validation errors are listed per field; "storage full" and "a restore is in progress" have their own messages (the write guard retries once, section 9, step 5).
- **PhotoPicker:** Take Photo / Choose from Photos, preview, replace, remove; the image is processed before the transaction; a photo that cannot be decoded leaves the form as it was.
- **Detail view:** large photo (or a placeholder), date and time, name, bar, category, ABV, volume, tag chips, notes, favourite heart, Edit, Delete with a confirmation dialog.
- **Daily Journal:** each card is a link to the detail view with a separate heart button beside it.
- **Draft protection (E5):** the debounced save is 600 ms; the draft is also written when the page is hidden, on `pagehide`, when the form unmounts, and just before the camera or photo library opens. One draft slot only. Photos are not drafted.
- **Draft prompts:** opening `/add` with a stored draft shows *Resume draft* / *Start fresh*; opening an edit screen with a draft for that entry shows *Resume draft* / *Discard draft*. A draft for an entry that has since changed, or was deleted, is discarded. A draft for an entry being edited, found on `/add`, resumes on that entry's edit screen. A draft that cannot be read never stops you adding a drink.

**Small decisions you can veto**
1. The name is optional; an unnamed entry shows as "Untitled drink".
2. After saving a new drink you land on its detail view (it replaces the form in the history). After saving or cancelling an edit you go back to the detail view. After deleting you go back one step, or to that day if there is no history.
3. Pressing Return in a text field does not submit the form (there is no `<form>` element); only the Save button saves.
4. Decimal commas are accepted ("12,5" for ABV or volume).
5. An installed Home Screen app restarts at its `start_url`, so after an iOS reload a draft is offered the next time you open Add or Edit, not automatically at launch.
6. The Back button on the detail view and Cancel on the Add form go one step back when there is browser history, otherwise to the entry's day or the calendar. The form asks before discarding changes.
7. The header Save button uses the primary text colour (not the accent colour) for contrast.
8. The bottom navigation stays visible on the form screens.
9. A drink with no photo shows a coupe-glass icon placeholder on the detail view. The heart on a journal card is a separate tap target from the card link.

## 15. Checkpoint 2c: what was built, and small decisions (veto any of them)
**Built**
- **Settings > Back up your journal:** shows the last backup (or that there has never been one) and what is on the device. *Create backup* shows photo-by-photo progress; then a second button, *Save backup*, opens the share sheet (Save to Files, AirDrop, iCloud Drive...) or, without share support, downloads the file. Only a file that was handed over counts as a backup (`recordBackupMade` with the snapshot instant); closing the share sheet records nothing. The text says plainly that the app cannot see where the file went.
- **Settings > Restore from a backup:** choose a file -> *Checking the backup...* with progress (pass 1, no writes) -> a summary (the backup's date and counts next to what is on this iPhone) -> advice to make a safety backup first, plus a red warning when the current journal has entries that are in no backup -> *Replace my journal...* -> a red confirmation dialog (focus on *Keep my journal*) -> a blocking progress screen ("keep this screen open") -> a result message. Any failure says why and that the journal was not changed. Without Web Locks the section is replaced by an explanation (Safari 15.4 or later is needed).
- **Calendar:** a small banner when a backup is due (section 7) with *Back up now* (opens Settings) and *Later* (24 hours).
- **Settings:** the "Backup & restore: Phase 2" placeholder row is gone; the warning text now points to the backup below.
- **Code:** `src/backup/` (`zip`, `backupFormat`, `exportBackup`, `restore`, `deliver`), `src/db/backupRepo.ts`, `src/db/tx.ts` (`runCommitTx`), `src/features/backup/` (the two sections, the banner, error messages), `thumbnailFromJpeg` in `src/services/imageProcessing.ts`.

**How the code follows section 9** (each point has a test, except where marked as screen code): restore refuses to start without Web Locks; it holds `lkp-maintenance` from before the baseline sweep until after the post-commit sweep; the baseline sweep runs before the session record is written and no sweep runs between the record and the commit; photos get new ids and are staged with `add`; each photo is decoded (validating it) to rebuild its thumbnail; the commit runs in one transaction with the pre-commit check (own session id, every staged photo and thumbnail); on any failure the staged photos and the session record are removed at once (or at next start); a storage estimate is checked first (free space below photo bytes x 1.5 + 5 MB fails safely as "storage full"; skipped when the browser cannot estimate).

**Small decisions you can veto**
1. The safety backup is advice, not a forced step.
2. A journal with entries that are in no backup gets a red warning on the restore summary.
3. Tapping outside the confirmation dialog cancels it, until the restore has started.
4. After a successful restore you stay in Settings with a message; other screens refresh themselves.
5. After a failed restore, or *Cancel* on the summary, the opened file is released and you choose it again to retry.
6. A closed share sheet leaves the prepared backup on screen for another try; leaving Settings discards it. If the share sheet refuses for another reason (for example an expired tap), the app downloads the file instead.
7. The reminder banner appears on the Calendar only.
8. The manifest's `appVersion` is `0.2.0` (`src/appVersion.ts`; keep in step with `package.json`).
9. A backup made by a newer app version is refused with "update the app".

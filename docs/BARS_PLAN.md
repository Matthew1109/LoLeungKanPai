# Update: New App Icon and Bar Library (v1, delivered for review)

Two requested changes, nothing else. No redesign, no new phase, no new dependency. Existing drinks, photos and tags are not rewritten by the update itself.

## 1. New app icon
- `public/icon-512.png`, `icon-192.png`, `apple-touch-icon.png` (180), `icon-maskable-512.png` and `favicon.png` (64) were regenerated from the new artwork under the **same file names**, so `index.html` and the manifest in `vite.config.ts` needed no change.
- The maskable icon keeps the artwork inside the safe zone (about 88% of the canvas), so Android masks do not cut it.
- Theme and background colours are unchanged.
- **iPhone keeps the old Home Screen icon** until the app is removed and added again. Removing a Home Screen web app also removes its local data. So: make a backup (Settings, "Create backup"), remove the app, add it again from Safari, then restore the backup.

## 2. Bar library

### What you see
- **Add / Edit drink, Bar field:** on focus and while typing, up to 6 matching bars from the library appear under the field. Bars whose name starts with what you typed come first. Tapping one fills in the library spelling. If what you typed is not in the library, a hint says: "New bar “{name}”. It is added to your bars when you save."
- **Settings > Bar management** (screen "Bars", route `/settings/bars`): an "New bar or place" field with Add. Tap a bar to Rename it or Archive / Restore it. Each bar shows its number of drinks. Archived bars are listed below the active ones. The rename box says "Also changes the bar name on {drinks}." There is no delete.

### Rules
- A name is trimmed, inner whitespace is collapsed, capitalisation is kept. Maximum 60 characters (counted as characters, not UTF-16 units).
- Names are unique **ignoring case, spacing and character width**, archived bars included. The same rule gives the link between a drink and its bar.
- A drink still stores its bar as text (`barName`). It belongs to the bar whose normalised name (`nameKey`) equals the normalised `barName`. Nothing about how drinks are shown, searched or grouped changed.
- **Saving a drink** adds the bar to the library if it is missing, and restores an archived bar only when the drink newly chooses it. A bar name problem (for example too long) never blocks saving the drink.
- **Rename** rewrites the bar and every drink of that bar in one transaction: all or nothing. It sets the drinks' `updatedAt`, marks them changed for the backup reminder, unifies spelling variants (for example "the bar" and "The Bar" become the new name), and allows a change of capitalisation only. Drinks already spelled exactly as the new name are left alone.
- **Archive** only hides a bar from the suggestions. Its drinks keep the name and it stays in Bar management under Archived. Restore brings it back.
- **No delete.** A bar can only be archived.

### Data and migration
- IndexedDB version 1 to 2 adds only one new store, `bars` (`id`, `name`, `nameKey`, `isArchived`, `createdAt`, `updatedAt`; key `id`, unique index `nameKey`). No existing store, index or record is changed by the upgrade.
- At start-up `syncBarsFromEntries()` adds a bar for every bar name already used by a drink (earliest spelling wins). It only adds. When nothing is new it does nothing and shows nothing. If it fails, it is logged and tried again at the next start. The result: after the update, Bar management lists each previously typed bar once.
- Every bar write is one transaction over `bars`, `entries` and `meta`. Like entry and tag writes, bar writes are refused while a restore is running.

### Backups
- Backup format version stays **1**. `data.json` gets a `bars` list. The manifest counts are unchanged.
- **Old backups (without `bars`) still restore.** The bars are rebuilt from the restored drinks.
- A backup with a malformed or duplicate bar (same normalised name) is rejected as invalid, before anything is changed.
- Restore replaces the bars with the backup's bars, plus any bar a restored drink needs that is missing.
- An earlier build ignores the unknown `data.bars` field, so it can still restore a backup made by this one.

## Code map
- `src/db/schema.ts`, `migrations.ts`: version 2 and the `bars` store. `src/db/tx.ts`, `errors.ts`: bar store in the write helpers and the bar error type.
- `src/db/barRepo.ts`: list, add, rename, archive / restore, `syncBarsFromEntries()`. `src/db/entryRepo.ts`: registers the bar when a drink is saved. `src/db/bootstrap.ts`: runs the start-up sync.
- `src/utils/bars.ts`: bar name helpers (clean, key, limit) shared by the repositories and the form.
- `src/features/bars/`: `BarField` (form field with suggestions), `ManageBars` (Settings screen), `barPickerModel.ts` (pure matching logic), `barErrors.ts` (error to message).
- Backup: `src/db/backupRepo.ts` (reads and replaces the stores), `src/backup/backupFormat.ts` (`data.bars`, validation), `exportBackup.ts` and `restore.ts` carry `bars`.
- UI wiring: `src/features/add/EntryForm.tsx` (uses `BarField`), `src/App.tsx` (route), `src/features/settings/Settings.tsx` (entry row), `src/i18n/locales/en.ts` (`bars.*`, `settings.section.bars`), `src/appVersion.ts` (label).

## Tests
- New: `tests/barRepo.test.ts` (add, rename incl. atomicity and variants, archive, sync, restore-session guard), `tests/barPickerModel.test.ts`, `tests/bars.test.ts` (name helpers).
- Updated: `backupHelpers.ts`, `helpers.ts`, `backupFormat.test.ts`, `backupExport.test.ts`, `restore.test.ts` (bars in export, validation, restore, old backups), `i18nKeys.test.ts` (`bars.` keys).

## Checks for the owner (iPhone, installed from the Home Screen)
1. **Before updating:** in Settings, tap "Create backup" and keep the file.
2. After the update, Settings > Bar management lists each bar you typed before, once, with the right drink counts. Existing drinks are all still there.
3. Add a drink: typing in Bar shows suggestions, tapping fills the name, a new name shows the "added when you save" hint and appears in Bar management after saving. The keyboard does not hide the suggestions badly.
4. Rename a bar: its drinks (Daily journal, detail, search) show the new name. Rename to a different capitalisation only. Try a name that already exists: it is refused.
5. Archive a bar: it disappears from the suggestions, its drinks keep the name. Restore it.
6. Create a backup, restore it: bars and counts match. If you have an older backup, restore it too: drinks come back and the bars are rebuilt.
7. Airplane mode: all of the above works offline.
8. Icon: after remove / add again / restore, the new icon shows on the Home Screen.

## Known limits
- Rename updates `updatedAt` of its drinks. An unsaved form draft of such a drink is then treated as out of date and discarded.
- Renaming unifies spelling variants of the same bar on all its drinks. This is intended.
- A drink typed with a different capitalisation of an existing bar ("the bar") keeps that spelling on the drink, although it belongs to the same bar.
- An archived bar that you type again on a new drink is restored when the drink is saved.
- No delete for bars.
- **Do not go back to the previous build on a device that already ran this one.** The database is now version 2 and older code cannot open it. If a rollback is ever needed, restore a backup into a fresh install.
- The Home Screen icon only changes after the app is removed and added again (see section 1).
- Not tested on a device here: the 1 to 2 upgrade on a real iPhone, and the suggestions layout with the on-screen keyboard.

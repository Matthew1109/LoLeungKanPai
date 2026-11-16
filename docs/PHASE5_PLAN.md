# Phase 5: Final Polish and Reliability (v1, delivered for review)

Only essential changes. No new features, no redesign, no database migration, no new dependency. Existing diary data is untouched.

## Changes
- **Storage meter and warnings (D6)** in Settings > Storage (replaces the "Phase 5" placeholder row): space used of the browser quota, total size of stored photographs, and whether the browser granted persistent storage. A warning shows at 80% of the quota (with a prompt to back up and free space) and a softer one above 500 MB of photographs. If persistence is not granted, a note repeats that backups are the safety net. Rules are in `storageModel.ts`; `getPhotoBytes()` sums stored photo sizes.
- **Crash screen:** `ErrorBoundary` around the app shows "Something went wrong" with a Reload button instead of a blank page. It never touches stored data.
- Version label updated.

## Reviewed, no change needed
- **Backup/restore:** validation (manifest, counts, ids, tags, dates, photos present and real JPEGs), staged restore under a Web Lock, atomic commit with pre-checks, free-space check, abort on any failure, orphan sweep. Unchanged from the approved Phase 2.
- **Data loss:** deletes and replace-all restore ask for confirmation; leaving a changed form asks to discard; drafts are protected; quota errors abort the transaction and show a clear message.
- **Offline:** service worker precaches all built JS, CSS, HTML, fonts and icons (`globPatterns`), `navigateFallback` serves `index.html` (HashRouter needs only that), fonts are bundled, CSP allows only the app's own origin, updates never reload the app on their own.

## Tests (new)
`tests/storageModel.test.ts`: thresholds (79% vs 80%, 500 MB), priority, size formatting, `getPhotoBytes` with fake-indexeddb. `tests/i18nKeys.test.ts` also checks `storage.` and `crash.` keys.

## Checks for the owner (iPhone, installed from the Home Screen)
1. Settings > Storage shows sensible numbers; after adding a photo the Photographs size grows.
2. Airplane mode, fully close and reopen the app: calendar, gallery, collections, search, adding a drink and a backup all work.
3. Create a backup, restore it on the same phone: counts match, photos show.
4. Push an update: the "update ready" prompt appears and Reload applies it.

## Known limits
- Storage figures are browser estimates (iOS rounds them). Offline behaviour and the warnings were not tested on a device here.
- Restore needs Safari 15.4 or later (Web Locks).

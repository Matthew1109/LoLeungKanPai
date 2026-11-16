# LoLeungKanPai

A private drinks and cocktail journal (PWA). Local-first: entries and photographs live in IndexedDB on the device. No backend, no accounts, no analytics.

**Status: Phase 5 of 5 (final polish and reliability) delivered for review.** Phases 1 to 4 are approved. See `docs/DEVELOPMENT_PLAN.md` and `docs/PHASE5_PLAN.md`.

## Setup (one time, on your MacBook / AI0011 workspace terminal)

Requires Node.js 20 or newer (`node -v`).

```bash
cd loleungkanpai
npm install
npm run typecheck   # TypeScript check
npm test            # unit tests (Vitest, fake-indexeddb)
npm run dev         # dev server, prints a Local and a Network URL
```

Open the Local URL on the Mac. It ends in `/LoLeungKanPai/`, the same path as the deployed site. To try it on your iPhone during development, put the phone on the same Wi-Fi and open the Network URL in Safari (the service worker is not active over plain HTTP; that is expected).

In Settings > Developer tools tap **Load demo data** to fill the calendar with sample drinks and generated photos. Developer tools exist only in `npm run dev` (or when `VITE_ENABLE_DEV_TOOLS=true`) and must be off for the real release.

## Tags

Each drink can have several **Base spirit** tags and several **Ingredient** tags. In the Add / Edit form tap **+ Add**, tick tags, search, or type a new name and tap *Create*. Settings > **Tag management** adds, renames, archives (and restores) and deletes tags; it also shows how many drinks use each one. An archived tag is no longer offered for new drinks but stays on the drinks that already have it. A tag can be deleted only while no drink uses it. Tags are included in backups.

## Gallery, Collections and search

**Gallery** (tab *Gallery*): every drink that has a photo, newest first, three to a row. Tap a photo to open the drink. **Filters** narrows by year, month, favourites, base spirits and ingredients. Different filters combine with AND (for example 2026 AND favourites AND Gin). Inside base spirits, and inside ingredients, choose **Any** (a drink with at least one of the ticked tags) or **All** (a drink with every ticked tag). The filters live in the address, so Back from a drink returns to the same filtered view.

**Collections** (tab *Collections*): **Search** at the top finds drinks by name, bar, notes or tag name (every word you type must match). Below it are four lists: **Base Spirits** and **Ingredients** (each tag with its drink count; tap one to see its drinks), **Favourite Drinks**, and **Recently Added** (the 30 drinks most recently recorded).

## Storage

Settings > **Storage** shows how much space the app uses, the size of your photographs, and whether the browser has promised not to clear your data. It warns when the device quota is 80% full and when photographs exceed 500 MB.

## Backup and restore

Settings > *Back up your journal* > **Create backup**, then **Save backup** (choose Save to Files) and keep the file somewhere other than the iPhone. Settings > *Restore from a backup* > choose that file: it replaces the whole journal after a confirmation. Restore needs Safari 15.4 or later. The backup is a plain ZIP of JSON and JPEG files.

## Production build and preview

```bash
npm run build     # type-check, then build into dist/
npm run preview   # serves dist/ at http://localhost:4173/LoLeungKanPai/
```

## Deploy to GitHub Pages

The site is served from `https://<your-github-username>.github.io/LoLeungKanPai/`. The base path `/LoLeungKanPai/` is set once, in `vite.config.ts`.

1. On GitHub create a **public** repository named `LoLeungKanPai`, empty (no README, `.gitignore` or licence). Pages is free only for public repositories. The repository holds source code only, never your journal.
2. In that repository: Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Check what will be committed, then push from the project folder (`package-lock.json` must be included; it is created by `npm install`):

   ```bash
   git init
   git add -A
   git ls-files | grep -Ei '\.(zip|jpe?g|heic|heif|png)$|\.env'   # expect only public/*.png icons and .env.example
   git commit -m "LoLeungKanPai"
   git branch -M main
   git remote add origin https://github.com/<your-github-username>/LoLeungKanPai.git
   git push -u origin main
   ```

4. Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm test`, `npm run build`, then publishes `dist/`. Follow it under the repository's Actions tab. When it is green, the URL is shown on the *deploy* job.
5. iPhone: open the URL in Safari > Share > Add to Home Screen. Use the installed app, not the Safari tab (they have separate storage). Make a first backup in Settings once you have a few entries.

Later pushes publish a new version. The installed app shows its "update ready" prompt; GitHub Pages can take a few minutes to serve new files. Do not rename the repository or your GitHub username without making a backup first: the Home Screen icon would point at the old address, and a re-added icon starts empty.

## Structure

```
src/db/          IndexedDB schema, migrations, repositories (UI never touches IndexedDB directly):
                 entryRepo (validated, transactional saves), tx (write transaction + abort), maintenance
                 (orphan photo sweep), locks (maintenance lock), backupReminder, draftRepo, metaRecords,
                 tagRepo (tag create/rename/archive/delete rules, counts)
src/backup/      backup file format, own ZIP writer/reader, export, restore, share/download hand-over
src/utils/       dates, ids, entry validation, calendar cover rule, entry sort orders
src/hooks/       data hooks (month data, day entries, one entry, whole library, object-URL management, toast)
src/features/    calendar, journal (day list + cards), entry (detail), add (entry form, photo picker,
                 draft/route logic; also used for editing), settings, backup (Settings sections, reminder banner),
                 tags (tag picker in the form, Tag management screen), gallery (photo grid, filters),
                 collections (hub, tag and favourite lists, search)
src/components/  navigation, empty state, install/update prompts, icons, confirm dialog, toast
src/i18n/        message catalogue (English now; Traditional Chinese slot ready)
src/services/    image processing (1600 px JPEG q0.82 + 480 px thumbnail; thumbnail rebuild on restore)
src/dev/         demo-data tools (development only)
tests/           Vitest unit tests
docs/            development plan and per-phase plans
```

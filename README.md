# LoLeungKanPai

A private drinks and cocktail journal (PWA). Local-first: entries and photographs live in IndexedDB on the device. No backend, no accounts, no analytics.

**Status: Phase 2 of 5, checkpoint 2c (backup export and restore), delivered for review.** Phase 1 (calendar) and checkpoints 2a and 2b are approved; final Phase 2 sign-off is pending. See `docs/DEVELOPMENT_PLAN.md` and `docs/PHASE2_PLAN.md`.

## Setup (one time, on your MacBook / AI0011 workspace terminal)

Requires Node.js 20 or newer (`node -v`).

```bash
cd loleungkanpai
npm install
npm run typecheck   # TypeScript check
npm test            # unit tests (Vitest, fake-indexeddb)
npm run dev         # dev server, prints a Local and a Network URL
```

Open the Local URL on the Mac. To try it on your iPhone during development, put the phone on the same Wi-Fi and open the Network URL in Safari (the service worker is not active over plain HTTP; that is expected).

In Settings > Developer tools tap **Load demo data** to fill the calendar with sample drinks and generated photos. Developer tools exist only in `npm run dev` (or when `VITE_ENABLE_DEV_TOOLS=true`) and must be off for the real release.

## Backup and restore

Settings > *Back up your journal* > **Create backup**, then **Save backup** (choose Save to Files) and keep the file somewhere other than the iPhone. Settings > *Restore from a backup* > choose that file: it replaces the whole journal after a confirmation. Restore needs Safari 15.4 or later. The backup is a plain ZIP of JSON and JPEG files.

## Production build and preview

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. Repository Settings > Pages > Source: **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds with the correct base path and publishes. The site will be at `https://<user>.github.io/<repo>/`.
4. On the iPhone: open that URL in Safari > Share > Add to Home Screen. Use the installed app, not the Safari tab (they have separate storage).

## Structure

```
src/db/          IndexedDB schema, migrations, repositories (UI never touches IndexedDB directly):
                 entryRepo (validated, transactional saves), tx (write transaction + abort), maintenance
                 (orphan photo sweep), locks (maintenance lock), backupReminder, draftRepo, metaRecords
src/backup/      backup file format, own ZIP writer/reader, export, restore, share/download hand-over
src/utils/       dates, ids, entry validation, calendar cover rule
src/hooks/       data hooks (month data, day entries, one entry, object-URL management, toast)
src/features/    calendar, journal (day list + cards), entry (detail), add (entry form, photo picker,
                 draft/route logic; also used for editing), settings, backup (Settings sections, reminder banner)
src/components/  navigation, empty state, install/update prompts, icons, confirm dialog, toast
src/i18n/        message catalogue (English now; Traditional Chinese slot ready)
src/services/    image processing (1600 px JPEG q0.82 + 480 px thumbnail; thumbnail rebuild on restore)
src/dev/         demo-data tools (development only)
tests/           Vitest unit tests
docs/            development plan and per-phase plans
```

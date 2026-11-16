# LoLeungKanPai: Development Plan (v6, Phase 2 in progress)

## Approved decisions
| # | Decision |
|---|---|
| D1 | GitHub Pages |
| D2 | HashRouter |
| D3 | Archive tags that are in use; permanent delete only for unused tags, with confirmation |
| D4 | AND between filter types; within tags a toggle between match ALL and match ANY |
| D5 | ZIP backup: JSON + JPEG photos. **Backup/restore moved from Phase 5 to Phase 2** (export + validated replace-all restore). Merge, deeper validation and UI polish stay in Phase 5. |
| D6 | Warn at ~80% of estimated quota; soft warning when stored photos exceed 500 MB |
| D7 | Native Safari HEIC conversion only; clear error if decoding fails, never store a broken image |
| D8 | Alcohol volume in ml |
| D9 | Photos: long edge 1600 px, JPEG 0.82 |
| D10 | Playfair Display headings (bundled via @fontsource), system font body |
| D11 | Week start follows device locale; fallback Monday for Hong Kong, else Sunday; no setting |
| D12 | ~~Manual daily cover~~ **Superseded:** manual cover selection is deferred to a future version. The cover is always the earliest photographed drink of the day, by recorded date/time (ties: created time, then id). It is derived, never stored, so a backdated drink, edited time or newly added photo on an earlier drink may change it. The unused `dayCovers` store stays in the schema; no migration. |
| D13 | English only, structured for later Traditional Chinese (all strings via `t()`, typed catalogue) |
| D14 | App icon created by me, replaceable (`public/*.png`) |
| D15 | GitHub Pages; repo name and URL decided before deployment |
| D16 | Work inside the AI0011 workspace; files organised under `loleungkanpai/` |

## Phase 2 decisions (details in `PHASE2_PLAN.md`)
| # | Decision | Status |
|---|---|---|
| E1 | ZIP backup, bounded in memory. Approved as fflate; implemented with the fallback v4 named (own small ZIP writer/reader, no new dependency) | approved; implementation changed (`PHASE2_PLAN.md` section 8) |
| E2 | Thumbnails regenerated on restore, not exported | approved |
| E3 | Restore: always new photo ids, staging under a maintenance lock, atomic metadata commit, diary intact on any failure; lock-based liveness, no timeouts | approved (v3) |
| E4 | New entry default time: now if the date is today, otherwise 20:00 | approved |
| E5 | Draft protection for the form's text fields (never silently overwrites a new entry) | approved (retained) |
| E6 | Backup reminder: 10 distinct entries created/edited since last backup, or 30 days | approved (retained) |
| E7 | Plain `.zip`, `LoLeungKanPai-backup-YYYY-MM-DD.zip` | approved |
| E8 | Checkpoints 2a, 2b, 2c; your typecheck/test/build after each; sign-off after 2c | approved |

## Amendments from the owner
1. Persistence is never assumed. Backup/restore is a critical feature. Phase 1 already shows the "your journal lives only on this iPhone" warning in Settings and requests `navigator.storage.persist()` without relying on the answer.
2. "No network" means no diary data leaves the device. The app may fetch its own files and check for updates. Enforced technically by a production Content-Security-Policy (`connect-src 'self'`, no third-party origins) and no third-party scripts, fonts or images.
3. Visual quality, especially the calendar, is a top priority.
4. No PRD requirement is removed or simplified without discussion.

## Architecture refinements made during Phase 1 (for transparency)
- Separate `thumbs` store next to `photos`, so the calendar/gallery never read full-size photos.
- No IndexedDB index on `isFavourite` (booleans are not valid keys); favourites are filtered in memory, which is fine at personal-journal scale.
- `newId()` falls back when `crypto.randomUUID` is unavailable (plain-HTTP LAN testing).
- CSS Modules (scoped) instead of global CSS.
- Calendar month is kept in the URL (`#/?m=2026-05`), so returning from a day restores the month.

## Phases
1. **Foundation and Calendar** (approved)
2. **Drink Entry Management and Backup/Restore** (in progress; 2a and 2b approved, 2c delivered for review): form, Take Photo / Choose from Photos, preview/replace/remove, create/edit/delete (with confirmation), change date, favourite, multiple per day, draft protection, orphan photo clean-up, storage-error handling, automatic earliest-photographed-drink cover (no manual cover), ZIP backup export and validated replace-all restore, backup reminder.
3. **Tagging System**: libraries, searchable multi-select sheet, create-and-associate, case-insensitive uniqueness, rename, archive/restore, delete unused, drinks-per-tag, tag filtering.
4. **Gallery and Collections**: 3-column gallery, year/month/favourite/tag filters (D4 logic), Collections hub, global search.
5. **Polish and Reliability**: merge restore, finer restore validation messages, storage meter and quota warnings (D6), loading/empty states, animation polish, offline verification, error boundary, update flow, iPhone Safari test pass.

## Changes after Phase 1 approval
- Phase 1 approved after fixes: `@types/node` typecheck fix (fix1), five-item bottom navigation with Settings as the fifth tab (fix2), Settings back link removed (fix3). Typecheck, tests and build pass on the owner's machine.
- Backup/restore is brought forward to Phase 2 (owner decision).
- Manual calendar cover removed from scope (owner decision); automatic earliest-photographed-entry cover is retained.
- v4: Phases section corrected to match the two decisions above (it still listed "manual day cover" under Phase 2 and backup/restore under Phase 5); Phase 2 decisions E1 to E8 recorded; restore design revised (E3).
- Phase 2 checkpoint **2a (data layer) approved** (typecheck, 76 tests and build passed on the owner's machine).
- **E3 (restore) revised twice after review, then approved as v3:** staged photos always get new ids; liveness is decided only by the Web Lock `lkp-maintenance`, never by age or a timeout; every orphan sweep runs under that lock; browsers without Web Locks cannot restore. E5 (draft protection) and E6 (backup reminder) are retained as approved.
- **Binding requirement recorded for 2c:** the restore commit transaction verifies its own session record and every staged photo and thumbnail before writing, and aborts safely otherwise.
- Phase 2 checkpoint **2b (add, view, edit and delete a drink, with photo and draft recovery) approved.**
- Phase 2 checkpoint **2c (backup export and restore) delivered for review.** E1 is implemented with my own ZIP writer/reader instead of fflate (the fallback named in v4; verified against Python's `zipfile`; no new dependency). Final Phase 2 sign-off follows your typecheck, tests, build and iPhone checks.
- v5: this plan and `PHASE2_PLAN.md` (v4) aligned with the 2a/2b state; the restore design is a single section 9.
- v6: this plan and `PHASE2_PLAN.md` (now v5) record the 2b approval and the 2c delivery.

Phase 2 detail: see `PHASE2_PLAN.md`.

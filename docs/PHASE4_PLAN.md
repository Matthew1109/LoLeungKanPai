# Phase 4: Gallery and Collections (v1, delivered for review)

Scope kept to what was asked: a three-column photo gallery with filters (decision D4), the four Collections, and global search. No new dependency, no database migration, no change to how drinks, tags, photos or backups are stored.

## What the user sees
- **Gallery** (`#/gallery`, the second tab): every drink that has a photograph, newest first (by when it was drunk), three to a row. A small heart marks favourites. Tap a photo to open the drink (`#/entry/:id`). The count of drinks shown sits above the grid.
- **Filters:** a *Favourites* chip toggles favourites only. *Filters* opens a bottom sheet with: favourites only, year, month, base spirits, ingredients. Changes apply at once behind the sheet; *Done* only closes it. Active year, month and tags also show as removable chips under the bar, and *Clear all* resets everything. A filter with no matches shows a message and *Clear filters*.
- **Collections** (`#/collections`, the third tab): **Search** on top, then four lists:
  - **Base Spirits** and **Ingredients**: each tag that at least one drink uses, with its drink count, A to Z. Tap a tag to see its drinks.
  - **Favourite Drinks**: every drink with a heart, newest first.
  - **Recently Added**: the 30 drinks most recently recorded.
  Each drink in a list shows a small photo (or a glass if it has none), name, date and bar, with a heart if it is a favourite; tap to open it.
- **Search:** type in the field at the top of Collections. Results replace the four lists and update as you type; the clear button (x) brings the lists back.

## Rules
| Topic | Behaviour |
|---|---|
| Filters between kinds (D4) | AND: year AND month AND favourites AND base spirits AND ingredients must all match. |
| Within base spirits, and within ingredients (D4) | A toggle, **Any** or **All**. *Any*: the drink has at least one ticked tag. *All*: it has every ticked tag. Nothing ticked means no constraint. The two toggles are independent. Default is *Any* (one constant, `DEFAULT_TAG_MODE` in `galleryFilter.ts`, if you prefer *All*). |
| Year and month | Taken from the drink's local day (`dayKey`), the same day the calendar shows. The month can be used without a year (every March). |
| Tags offered in the filter sheet | Tags used by at least one photographed drink, with counts. A tag that is ticked always stays listed so it can be unticked. Archived tags are included and marked *Archived*. |
| Gallery content | Only drinks that have a photograph. Drinks without one appear in the calendar, Collections and search. |
| Filters in the address | `#/gallery?year=2026&month=3&fav=1&spirit=<id>&spiritMode=all&ingredient=<id>`. Back from a drink therefore returns to the same filtered view; the scroll position is restored as well. Unreadable values are ignored. |
| Search | Every word typed must appear (anywhere, in any order) in the drink name, bar, notes or the names of its tags (archived tags too). Ignores case and full/half-width characters. A blank query finds nothing. Newest first. The text is kept in the address (`#/collections?q=...`), so Back from a result returns to the same search. |
| Collection lists | Tags: counted once per drink, archived tags included, unused tags not listed. Favourites: newest drink first. Recently Added: by `createdAt` (when the entry was recorded), not by the date of the drink, so a backdated drink appears at the top. |
| After a change | Screens refetch when stored data changes (add, edit, delete, tag change, restore), as the other screens do. |

## Routes
`/gallery`, `/collections`, `/collections/:kind` (`spirits`, `ingredients`, `favourites`, `recent`), `/collections/:kind/:tagId`. An unknown `:kind` goes back to `/collections`. The Phase 1 placeholder screens and their text were removed.

## Code map
- `src/db/entryRepo.ts`: `getAllEntries()` (new). The journal is read once and filtered in memory, which is fine at personal-journal scale (as noted for favourites in the plan).
- `src/hooks/useLibrary.ts` (new): all drinks (newest first), all tags including archived, and thumbnail object URLs (never full-size photos). Refetches on data change, keeps the previous data while refreshing.
- `src/utils/entrySort.ts` (new): `newestFirst`, `recentlyAddedFirst`.
- `src/features/gallery/`: `galleryFilter.ts` (pure filter rules and address encoding), `GalleryScreen`, `FilterSheet` (reuses the tag-sheet styles), `Gallery.module.css`.
- `src/features/collections/`: `collectionsModel.ts` and `searchModel.ts` (pure), `CollectionsScreen` (lists and search), `CollectionScreen` (one collection or one tag), `EntryRow`, `Collections.module.css`.
- `src/App.tsx`: routes. `src/appVersion.ts`: label. `src/i18n/locales/en.ts`: `gallery.*` and `collections.*` keys.

## Tests (new)
`tests/galleryFilter.test.ts` (D4 rules: ANY and ALL, AND between kinds, year/month from the local day, photo-only, years list, chip removal, address round trip and bad input), `tests/collectionsModel.test.ts` (sort orders, favourites, recent limit and order, tag lists with counts, archived and unused tags), `tests/searchModel.test.ts` (words, name/bar/notes/tags, archived tags, case and width, blank query), `tests/libraryRepo.test.ts` (`getAllEntries` with fake-indexeddb). `tests/i18nKeys.test.ts` now also checks the `gallery.` and `collections.` keys.

## iPhone checks for the owner
1. Add several drinks with photos (Settings > Developer tools > Load demo data also works in `npm run dev`). **Gallery** shows three columns, newest first, no gaps, photos sharp. Drinks without a photo are not in the grid.
2. Tap a photo: the drink opens. Tap Back: you land on the same place in the grid, with the same filters.
3. **Filters:** pick a year, then a month; tick two base spirits and flip *Any* / *All* and watch the grid change; add an ingredient; tap *Favourites*. Remove a chip; *Clear all*. Reload the page: the filters are still in the address.
4. **Collections:** the four rows show sensible counts. Open Base Spirits, tap a tag, open a drink, Back. Check Favourite Drinks and Recently Added.
5. **Search:** search for part of a drink name, a bar, a word from the notes, and a tag name. Open a result, Back: the search is still there. A word that matches nothing shows the message.
6. Edit a drink (tags, favourite) and return to the Gallery and Collections: they show the change. Check the bottom bar and the notch/home-bar areas are not covered by the lists.

## Known limits
- Everything is loaded into memory and filtered there; thumbnails only, so this stays quick for a personal journal. There is no pagination.
- Scroll restoration after Back and the layout were written without a device here; item 2 above is the check.
- The gallery lists only photographed drinks (a drink without a photo has no picture to show). Say so if you want them included as placeholders.
- Search matches words as substrings of the text (typing "gin" also finds "ginger"). No fuzzy matching or ranking; results are newest first.

# Phase 3: Tagging (v1, delivered for review)

Scope kept to what was asked: reusable Base Spirit and Ingredient tags, several per drink, create / rename / archive / manage, existing drinks and tag references preserved. Tag filtering is not part of this phase (it belongs with the Phase 4 filters, decision D4).

## What the user sees
- **Add / Edit drink:** two fields, *Base spirits* and *Ingredients*, after *Bar*. Chosen tags show as chips (tap one to remove it). **+ Add** opens a bottom sheet: search box, tick any number of tags, **Done**. Typing a name that does not exist shows *Create "name"*, which creates the tag and ticks it. Typing the name of an archived tag brings that tag back instead of failing as a duplicate. The drink's own archived tags stay in the sheet, marked *Archived*, so they can be unticked.
- **Settings > Tag management** (`#/settings/tags`): two lists. Tap a tag for **Rename**, **Archive / Restore**, and **Delete** (only shown when no drink uses it, with a confirmation). Each row shows how many drinks use the tag. Archived tags are listed below the active ones.
- Tags are not part of the text draft (like the photo): leaving the form asks to discard, as for any other change.

## Rules (all enforced in `src/db/tagRepo.ts`, inside one IndexedDB transaction)
| Rule | Behaviour |
|---|---|
| Name | trimmed, inner spaces collapsed, capitalisation kept, 1 to 40 characters (`EMPTY`, `TOO_LONG`) |
| Uniqueness | per category, ignoring case, spacing and width; archived tags count (`DUPLICATE`). The same name may exist in both categories. The database unique index `categoryNameKey` backs this up. |
| Rename | changes the name only; the id stays, so every drink shows the new name. Changing only the capitalisation of a tag's own name is allowed. |
| Archive / restore | flag only. Archived tags are hidden from the picker and from `listTags` by default, stay on drinks, and still show on them (`getTagsByIds` includes archived tags). |
| Delete (D3) | permanent, only when no drink references the tag in either tag field (`IN_USE` otherwise). The default tags are seeded once, so a deleted default never returns. |
| While a restore runs | every tag change is refused (`RestoreInProgressError`), like entry edits. |
| After a change | `notifyDataChanged()`, so open screens refetch. |

No schema change and no migration: `tags` and the `baseSpiritTagIds` / `ingredientTagIds` multi-entry indexes existed since Phase 1. Backup and restore already carried tags.

## Code map
- `src/db/tagRepo.ts`: `createTag`, `ensureTag`, `renameTag`, `setTagArchived`, `deleteTag`, `listTagsWithCounts` (new); `listTags`, `getTagsByIds`, `seedDefaultTags` (unchanged). `src/db/errors.ts` `TagError`; `src/db/tx.ts` `runTagTx`.
- `src/features/tags/`: `TagField` (form field), `TagSheet` (picker), `ManageTags` + `TagSection` (Settings screen), `tagPickerModel` (pure helpers), `tagErrors` (error to message).
- `src/features/add/entryFormModel.ts`: `TagSelection`, `buildEntryInput` takes the chosen tags (an edit without a selection still keeps the stored ones).
- Strings: `tags.*` keys in `src/i18n/locales/en.ts`.

## Tests (new)
`tests/tagRepo.test.ts` (create, duplicates, ensure, rename keeps references, archive keeps references, delete rules, counts, change signal, restore guard), `tests/tagPickerModel.test.ts`, `tests/tagSelection.test.ts`. `tests/i18nKeys.test.ts` now also checks the `tags.` keys.

## iPhone checks for the owner
1. Add a drink with two base spirits and three ingredients, one of them created in the sheet; save; open it: the chips show on the card and the detail.
2. Edit it, remove one tag and add another; Cancel asks to discard; Save keeps the change.
3. Tag management: rename a tag in use, then open the drink: it shows the new name.
4. Archive a tag in use: it disappears from the sheet of a new drink but stays on the old one (and shows *Archived* in that drink's sheet). Restore it.
5. Delete: only unused tags offer it. Try to add a duplicate (different capitalisation): the message appears.
6. Make a backup, restore it: tags and their use on drinks are unchanged.
7. The search field and keyboard inside the sheet do not hide the list or the Done button.

## Known limits
- The tag sheet and Tag management screens have not been exercised on a device by me; the pure logic and the data rules are covered by unit tests.
- Tag-only changes do not trigger the backup reminder (it counts changed drinks).
- Tag filtering and tag search are Phase 4.

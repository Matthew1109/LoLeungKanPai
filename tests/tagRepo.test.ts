import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataVersion } from '../src/db/changeSignal';
import { getEntry, saveEntry } from '../src/db/entryRepo';
import { RestoreInProgressError, TagError } from '../src/db/errors';
import {
  TAG_NAME_MAX, cleanTagName, createTag, deleteTag, ensureTag, getTagsByIds, listTags, listTagsWithCounts, renameTag,
  seedDefaultTags, setTagArchived,
} from '../src/db/tagRepo';
import { clearAll, makeEntry, putRestoreSession, stubWebLocks } from './helpers';

const DAY = '2026-05-07';
beforeEach(clearAll);
afterEach(() => vi.unstubAllGlobals());

/** The TagError code a change was refused with ('NOT_REFUSED' when it went through). Other errors are rethrown. */
async function refusedWith(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (err) {
    if (err instanceof TagError) return err.code;
    throw err;
  }
  return 'NOT_REFUSED';
}

const names = (tags: Array<{ name: string }>) => tags.map((tag) => tag.name);

describe('creating tags', () => {
  it('cleans the name (trim, collapse spaces) and keeps the capitalisation', async () => {
    const tag = await createTag('  Pink   Gin ', 'BASE_SPIRIT');
    expect(tag).toMatchObject({ name: 'Pink Gin', nameKey: 'pink gin', category: 'BASE_SPIRIT', isArchived: false });
    expect(await listTags('BASE_SPIRIT')).toEqual([tag]);
    expect(cleanTagName('  a \t  b ')).toBe('a b');
  });

  it('refuses blank and over-long names and stores nothing', async () => {
    expect(await refusedWith(createTag('   ', 'BASE_SPIRIT'))).toBe('EMPTY');
    expect(await refusedWith(createTag('x'.repeat(TAG_NAME_MAX + 1), 'BASE_SPIRIT'))).toBe('TOO_LONG');
    expect(await listTags('BASE_SPIRIT', { includeArchived: true })).toEqual([]);
    await expect(createTag('x'.repeat(TAG_NAME_MAX), 'BASE_SPIRIT')).resolves.toBeDefined();
  });

  it('refuses a duplicate in the same category (any capitalisation or spacing, archived or not) but allows the other category', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    expect(await refusedWith(createTag(' gIN ', 'BASE_SPIRIT'))).toBe('DUPLICATE');
    await setTagArchived(gin.id, true);
    expect(await refusedWith(createTag('Gin', 'BASE_SPIRIT'))).toBe('DUPLICATE');
    await expect(createTag('Gin', 'INGREDIENT')).resolves.toMatchObject({ category: 'INGREDIENT' });
  });

  it('a seeded default counts as existing', async () => {
    await seedDefaultTags();
    expect(await refusedWith(createTag('gin', 'BASE_SPIRIT'))).toBe('DUPLICATE');
  });
});

describe('ensureTag (the picker\'s "create")', () => {
  it('creates a missing tag, returns an existing one, and brings an archived one back', async () => {
    const created = await ensureTag('Lychee', 'INGREDIENT');
    expect(await ensureTag(' lychee ', 'INGREDIENT')).toEqual(created);
    expect(await listTags('INGREDIENT')).toHaveLength(1);

    await setTagArchived(created.id, true);
    const back = await ensureTag('LYCHEE', 'INGREDIENT');
    expect(back.id).toBe(created.id);
    expect(back.isArchived).toBe(false);
    expect(await listTags('INGREDIENT')).toHaveLength(1);
  });

  it('refuses a blank name', async () => {
    expect(await refusedWith(ensureTag('  ', 'INGREDIENT'))).toBe('EMPTY');
  });
});

describe('renaming', () => {
  it('keeps the id, so every drink that has the tag shows the new name, and does not touch the drinks', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    const stored = await saveEntry(makeEntry('a', DAY, 20, { baseSpiritTagIds: [gin.id] }));

    const renamed = await renameTag(gin.id, ' London  Dry Gin ');

    expect(renamed).toMatchObject({ id: gin.id, name: 'London Dry Gin', nameKey: 'london dry gin' });
    expect(await getEntry('a')).toEqual(stored);
    expect(names(await getTagsByIds((await getEntry('a'))!.baseSpiritTagIds))).toEqual(['London Dry Gin']);
  });

  it('allows changing only the capitalisation of its own name', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    await expect(renameTag(gin.id, 'GIN')).resolves.toMatchObject({ name: 'GIN' });
  });

  it('refuses a name another tag of the category has, a blank name and an unknown tag', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    const vodka = await createTag('Vodka', 'BASE_SPIRIT');
    await createTag('Vodka', 'INGREDIENT'); // other category: irrelevant
    expect(await refusedWith(renameTag(vodka.id, 'gin'))).toBe('DUPLICATE');
    expect(await refusedWith(renameTag(vodka.id, ' '))).toBe('EMPTY');
    expect(await refusedWith(renameTag('missing', 'Rum'))).toBe('NOT_FOUND');
    expect(names(await listTags('BASE_SPIRIT'))).toEqual([gin.name, vodka.name]);
    await expect(renameTag(gin.id, 'Vodka')).rejects.toBeInstanceOf(TagError);
  });

  it('lets a renamed tag\'s old name be used again', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    await renameTag(gin.id, 'Old Tom');
    await expect(createTag('Gin', 'BASE_SPIRIT')).resolves.toMatchObject({ name: 'Gin' });
  });
});

describe('archiving', () => {
  it('hides the tag from the default list but keeps it on the drinks that have it; restoring brings it back', async () => {
    const lime = await createTag('Lime', 'INGREDIENT');
    await saveEntry(makeEntry('a', DAY, 20, { ingredientTagIds: [lime.id] }));

    await setTagArchived(lime.id, true);
    expect(await listTags('INGREDIENT')).toEqual([]);
    expect((await listTags('INGREDIENT', { includeArchived: true })).map((tag) => tag.id)).toEqual([lime.id]);
    expect(await getTagsByIds([lime.id])).toMatchObject([{ id: lime.id, name: 'Lime', isArchived: true }]);
    expect((await getEntry('a'))!.ingredientTagIds).toEqual([lime.id]);

    await setTagArchived(lime.id, false);
    expect((await listTags('INGREDIENT')).map((tag) => tag.id)).toEqual([lime.id]);
  });

  it('refuses an unknown tag', async () => {
    expect(await refusedWith(setTagArchived('missing', true))).toBe('NOT_FOUND');
  });
});

describe('deleting', () => {
  it('deletes an unused tag for good and leaves the drinks alone', async () => {
    const used = await createTag('Gin', 'BASE_SPIRIT');
    const unused = await createTag('Sake', 'BASE_SPIRIT');
    const stored = await saveEntry(makeEntry('a', DAY, 20, { baseSpiritTagIds: [used.id] }));

    await deleteTag(unused.id);

    expect(names(await listTags('BASE_SPIRIT', { includeArchived: true }))).toEqual(['Gin']);
    expect(await getEntry('a')).toEqual(stored);
  });

  it('refuses to delete a tag a drink uses (either category, archived or not); the tag and the drink stay', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    const lime = await createTag('Lime', 'INGREDIENT');
    const stored = await saveEntry(makeEntry('a', DAY, 20, { baseSpiritTagIds: [gin.id], ingredientTagIds: [lime.id] }));
    await setTagArchived(lime.id, true);

    expect(await refusedWith(deleteTag(gin.id))).toBe('IN_USE');
    expect(await refusedWith(deleteTag(lime.id))).toBe('IN_USE');
    expect(names(await getTagsByIds([gin.id, lime.id]))).toEqual(['Gin', 'Lime']);
    expect(await getEntry('a')).toEqual(stored);

    // once no drink has it any more, it can go
    await saveEntry({ ...stored, baseSpiritTagIds: [] });
    await deleteTag(gin.id);
    expect(await getTagsByIds([gin.id])).toEqual([]);
  });

  it('refuses an unknown tag, and a deleted default tag does not come back at the next start', async () => {
    expect(await refusedWith(deleteTag('missing'))).toBe('NOT_FOUND');

    await seedDefaultTags();
    const gin = (await listTags('BASE_SPIRIT')).find((tag) => tag.name === 'Gin')!;
    await deleteTag(gin.id);
    await seedDefaultTags();
    expect(names(await listTags('BASE_SPIRIT'))).not.toContain('Gin');
  });
});

describe('listTagsWithCounts', () => {
  it('counts the drinks per tag, per category, archived tags included, sorted by name', async () => {
    const rum = await createTag('Rum', 'BASE_SPIRIT');
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    const lime = await createTag('Lime', 'INGREDIENT');
    await saveEntry(makeEntry('a', DAY, 10, { baseSpiritTagIds: [gin.id, rum.id] }));
    await saveEntry(makeEntry('b', DAY, 11, { baseSpiritTagIds: [gin.id], ingredientTagIds: [lime.id] }));
    await createTag('Sake', 'BASE_SPIRIT');
    await setTagArchived(rum.id, true);

    const spirits = await listTagsWithCounts('BASE_SPIRIT');
    expect(spirits.map((tag) => [tag.name, tag.entryCount, tag.isArchived])).toEqual([
      ['Gin', 2, false], ['Rum', 1, true], ['Sake', 0, false],
    ]);
    expect((await listTagsWithCounts('INGREDIENT')).map((tag) => [tag.name, tag.entryCount])).toEqual([['Lime', 1]]);
  });
});

describe('open screens are told', () => {
  it('after each committed change, and not after a refused one', async () => {
    const start = getDataVersion();
    await createTag('Gin', 'BASE_SPIRIT');
    expect(getDataVersion()).toBe(start + 1);
    await refusedWith(createTag('gin', 'BASE_SPIRIT'));
    expect(getDataVersion()).toBe(start + 1);
  });
});

describe('restore guard', () => {
  it('while a restore is alive every tag change is refused and nothing is written', async () => {
    const gin = await createTag('Gin', 'BASE_SPIRIT');
    stubWebLocks({ heldElsewhere: true });
    await putRestoreSession();

    await expect(createTag('Rum', 'BASE_SPIRIT')).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(ensureTag('Rum', 'BASE_SPIRIT')).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(renameTag(gin.id, 'Old Tom')).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(setTagArchived(gin.id, true)).rejects.toBeInstanceOf(RestoreInProgressError);
    await expect(deleteTag(gin.id)).rejects.toBeInstanceOf(RestoreInProgressError);

    expect(await listTags('BASE_SPIRIT', { includeArchived: true })).toEqual([gin]);
  });
});

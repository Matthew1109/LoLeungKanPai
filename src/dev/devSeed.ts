import { getDb } from '../db';
import { saveEntry } from '../db/entryRepo';
import { seedDefaultTags } from '../db/tagRepo';
import type { DrinkCategory, DrinkEntry } from '../db/schema';
import { processPhoto } from '../services/imageProcessing';
import { makeDemoPhoto } from './demoPhoto';
import { newId } from '../utils/id';
import { nameKey } from '../utils/normalise';
import { toDayKey } from '../utils/dates';
import { notifyDataChanged } from '../hooks/useDataVersion';

export const DEV_TOOLS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true';

interface Demo {
  monthOffset: number;
  day: number;
  hour: number;
  name: string;
  category: DrinkCategory;
  bar: string;
  spirits: string[];
  ingredients: string[];
  notes: string;
  photo: boolean;
  fav?: boolean;
}

const DEMOS: Demo[] = [
  { monthOffset: 0, day: 2, hour: 19, name: 'Negroni', category: 'COCKTAIL', bar: 'The Aviary', spirits: ['Gin'], ingredients: ['Vermouth'], notes: 'Bitter, orange peel, perfect first drink.', photo: true, fav: true },
  { monthOffset: 0, day: 4, hour: 21, name: 'Espresso Martini', category: 'COCKTAIL', bar: 'Bar Leone', spirits: ['Vodka'], ingredients: ['Espresso', 'Sugar'], notes: '', photo: true },
  { monthOffset: 0, day: 7, hour: 18, name: 'Gin & Tonic', category: 'COCKTAIL', bar: 'Home', spirits: ['Gin'], ingredients: ['Tonic Water', 'Lime'], notes: 'Lots of ice.', photo: true },
  { monthOffset: 0, day: 7, hour: 22, name: 'Old Fashioned', category: 'COCKTAIL', bar: 'Zuma Lounge', spirits: ['Bourbon'], ingredients: ['Angostura Bitters', 'Sugar'], notes: 'A nightcap after dinner. Smoked orange.', photo: true, fav: true },
  { monthOffset: 0, day: 9, hour: 20, name: 'Pinot Noir', category: 'WINE', bar: 'Cave & Co', spirits: [], ingredients: [], notes: 'Cherry, earth. Would order again.', photo: false },
  { monthOffset: 0, day: 11, hour: 17, name: 'Margarita', category: 'COCKTAIL', bar: 'Casa Azul', spirits: ['Tequila'], ingredients: ['Lime'], notes: '', photo: true },
  { monthOffset: 0, day: 14, hour: 16, name: 'Moscow Mule', category: 'COCKTAIL', bar: 'Rooftop 28', spirits: ['Vodka'], ingredients: ['Ginger Beer', 'Lime', 'Mint'], notes: '', photo: true },
  { monthOffset: 0, day: 14, hour: 20, name: 'Long Island Iced Tea', category: 'COCKTAIL', bar: 'Rooftop 28', spirits: ['Vodka', 'Gin', 'White Rum', 'Tequila'], ingredients: ['Lemon', 'Soda Water'], notes: 'Dangerous.', photo: true },
  { monthOffset: 0, day: 14, hour: 23, name: 'Lagavulin 16', category: 'WHISKY', bar: 'Rooftop 28', spirits: ['Whisky'], ingredients: [], notes: 'Peat and smoke.', photo: false },
  { monthOffset: 0, day: 18, hour: 19, name: 'Daiquiri', category: 'COCKTAIL', bar: 'La Floridita', spirits: ['White Rum'], ingredients: ['Lime', 'Simple Syrup'], notes: '', photo: true },
  { monthOffset: 0, day: 21, hour: 21, name: 'Mezcal Paloma', category: 'COCKTAIL', bar: 'Casa Azul', spirits: ['Mezcal'], ingredients: ['Lime', 'Soda Water'], notes: 'Smoky and fresh.', photo: true },
  { monthOffset: 0, day: 24, hour: 20, name: 'Junmai Daiginjo', category: 'OTHER_SPIRITS', bar: 'Izakaya Mura', spirits: ['Sake'], ingredients: [], notes: 'Chilled, delicate.', photo: true },
  { monthOffset: 0, day: 27, hour: 19, name: 'Mojito', category: 'COCKTAIL', bar: 'Havana Club', spirits: ['White Rum'], ingredients: ['Mint', 'Lime', 'Soda Water', 'Sugar'], notes: '', photo: true },
  { monthOffset: -1, day: 5, hour: 20, name: 'Sazerac', category: 'COCKTAIL', bar: 'The Aviary', spirits: ['Rye', 'Cognac'], ingredients: ['Angostura Bitters'], notes: '', photo: true },
  { monthOffset: -1, day: 12, hour: 19, name: 'Aperol Spritz', category: 'COCKTAIL', bar: 'Terrazza', spirits: [], ingredients: ['Soda Water'], notes: '', photo: true },
  { monthOffset: -1, day: 19, hour: 21, name: 'Penicillin', category: 'COCKTAIL', bar: 'Bar Leone', spirits: ['Whisky'], ingredients: ['Lemon', 'Ginger Beer'], notes: 'Honey-ginger, smoky float.', photo: true, fav: true },
];

/** Loads sample entries around the current month so the calendar and journal can be judged with realistic data. */
export async function seedDemoData(): Promise<void> {
  await seedDefaultTags();
  const db = await getDb();
  const tags = await db.getAll('tags');
  const idOf = (cat: 'BASE_SPIRIT' | 'INGREDIENT', name: string) =>
    tags.find((t) => t.category === cat && t.nameKey === nameKey(name))?.id;
  const now = new Date();
  let i = 0;
  for (const d of DEMOS) {
    const when = new Date(now.getFullYear(), now.getMonth() + d.monthOffset, d.day, d.hour, (i * 13) % 60);
    let photo: { record: import('../db/schema').PhotoRecord; thumb: Blob } | undefined;
    if (d.photo) {
      const p = await processPhoto(await makeDemoPhoto(i));
      const id = newId();
      photo = {
        record: { id, blob: p.full, mime: 'image/jpeg', size: p.full.size, width: p.width, height: p.height, createdAt: new Date().toISOString() },
        thumb: p.thumb,
      };
    }
    const stamp = new Date().toISOString();
    const entry: DrinkEntry = {
      id: newId(),
      drinkName: d.name,
      category: d.category,
      dateTime: when.toISOString(),
      dayKey: toDayKey(when),
      barName: d.bar,
      photoId: photo?.record.id ?? null,
      baseSpiritTagIds: d.spirits.map((n) => idOf('BASE_SPIRIT', n)).filter((x): x is string => !!x),
      ingredientTagIds: d.ingredients.map((n) => idOf('INGREDIENT', n)).filter((x): x is string => !!x),
      alcoholPercentage: null,
      alcoholVolumeMl: null,
      notes: d.notes,
      isFavourite: !!d.fav,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await saveEntry(entry, photo ? { kind: 'replace', record: photo.record, thumb: photo.thumb } : undefined, { notify: false });
    i++;
  }
  notifyDataChanged();
}

/** Wipes every store, then restores the default tag libraries. Dev tools only. */
export async function eraseEverything(): Promise<void> {
  const db = await getDb();
  const names = ['entries', 'tags', 'bars', 'photos', 'thumbs', 'dayCovers', 'meta'] as const;
  const tx = db.transaction([...names], 'readwrite');
  await Promise.all(names.map((n) => tx.objectStore(n).clear()));
  await tx.done;
  await seedDefaultTags();
  notifyDataChanged();
}

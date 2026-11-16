/** Case-insensitive, whitespace-collapsed key used for tag-name uniqueness within a category. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

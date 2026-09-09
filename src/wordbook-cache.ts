export interface WordbookCacheEntry<T> { version: 1; savedAt: number; value: T }
const PREFIX = 'ft:wordbook-detail:v1:';
export function cachedWordData<T>(source: string, word: string, valid: (value: unknown) => value is T): WordbookCacheEntry<T> | undefined {
  try {
    const data: unknown = GM_getValue(`${PREFIX}${source}:${word.toLowerCase()}`, null);
    if (!data || typeof data !== 'object') return;
    const entry = data as Partial<WordbookCacheEntry<unknown>>;
    if (entry.version === 1 && typeof entry.savedAt === 'number' && valid(entry.value)) return { version: 1, savedAt: entry.savedAt, value: entry.value };
  } catch { /* A storage read failure must not prevent a network lookup. */ }
}
export function persistWordData(source: string, word: string, value: unknown): boolean {
  try { GM_setValue(`${PREFIX}${source}:${word.toLowerCase()}`, { version: 1, savedAt: Date.now(), value }); return true; }
  catch { return false; }
}

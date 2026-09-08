import { normalizeVocabulary, type VocabularyWord } from '../vocabulary';

const CACHE = 'ft:combined-vocabulary:v1';
interface Part { words: VocabularyWord[]; complete: boolean }
interface Post { expires: number; parts: Map<string, Part>; order: string[] }
/** Vocabulary shares the translation request and survives cached text and DOM remounts. */
export class CombinedVocabulary {
  private posts = new Map<string, Post>();
  private listeners = new Map<string, Set<(words: VocabularyWord[]) => void>>();
  constructor(private readonly namespace: string) {
    const stored: unknown = GM_getValue(CACHE, []);
    if (Array.isArray(stored)) for (const entry of stored) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'number' || entry[1] <= Date.now() || !Array.isArray(entry[2])) continue;
      const parts = new Map<string, Part>();
      for (const part of entry[2]) if (Array.isArray(part) && typeof part[0] === 'string' && Array.isArray(part[1])) {
        parts.set(part[0], { words: (part[1] as unknown[]).filter((word): word is VocabularyWord => !!word && typeof word === 'object' && 'word' in word && typeof word.word === 'string'), complete: true });
      }
      this.posts.set(entry[0], { expires: entry[1], parts, order: [...parts.values()].flatMap(part => part.words.map(word => word.word.toLowerCase())) });
    }
  }
  private key(source: string): string { return JSON.stringify([this.namespace, source]); }
  hasPost(source: string): boolean {
    const post = this.posts.get(this.key(source));
    return !!post && post.expires > Date.now() && [...post.parts.values()].some(part => part.complete);
  }
  has(source: string, section: string): boolean {
    const post = this.posts.get(this.key(source));
    return !!post && post.expires > Date.now() && post.parts.get(section)?.complete === true;
  }
  watch(source: string, callback: (words: VocabularyWord[]) => void): () => void {
    const key = this.key(source);
    const listeners = this.listeners.get(key) ?? new Set(); listeners.add(callback); this.listeners.set(key, listeners);
    callback(this.values(source));
    return () => { listeners.delete(callback); if (!listeners.size) this.listeners.delete(key); };
  }
  private values(source: string): VocabularyWord[] {
    const post = this.posts.get(this.key(source));
    return post && post.expires > Date.now() ? normalizeVocabulary(source, [...post.parts.values()].flatMap(part => part.words).sort((a, b) => post.order.indexOf(a.word.toLowerCase()) - post.order.indexOf(b.word.toLowerCase()))) : [];
  }
  publish(source: string, section: string, raw: unknown[], complete: boolean): void {
    const key = this.key(source);
    const before = JSON.stringify(this.values(source));
    const post = this.posts.get(key) ?? { expires: Date.now() + 30 * 86400000, parts: new Map<string, Part>(), order: [] };
    const words = normalizeVocabulary(source, raw);
    for (const word of words) if (!post.order.includes(word.word.toLowerCase())) post.order.push(word.word.toLowerCase());
    post.parts.set(section, { words, complete }); this.posts.set(key, post);
    const result = this.values(source);
    if (JSON.stringify(result) !== before) for (const callback of this.listeners.get(key) ?? []) callback(result);
    if (complete) {
      const saved = [...this.posts].map(([id, value]) => [id, value.expires, [...value.parts].filter(([, part]) => part.complete).map(([id, part]) => [id, part.words])]);
      while (saved.length > 100 || saved.length > 1 && JSON.stringify(saved).length > 500000) saved.shift();
      const retained = new Set(saved.map(entry => entry[0]));
      for (const id of this.posts.keys()) if (!retained.has(id) && !this.listeners.has(id)) this.posts.delete(id);
      try { GM_setValue(CACHE, saved); } catch { /* Optional cache must not fail translation. */ }
    }
  }
  clearListeners(): void { this.listeners.clear(); }
}

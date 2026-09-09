import { ecdictData } from './wordbook-ecdict-data';
export interface LocalWord { word: string; ipa: string; meaning: string; tags: string[]; exchange: string; pos: string }
let database: Promise<Map<string, LocalWord>> | undefined;
export async function localWord(word: string): Promise<LocalWord | undefined> {
  database ??= (async () => {
    const bytes = Uint8Array.from(atob(ecdictData), character => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const rows = JSON.parse(await new Response(stream).text()) as string[][];
    return new Map(rows.map(row => {
      const [word = '', ipa = '', meaning = '', tags = '', exchange = '', pos = ''] = row;
      return [word.toLowerCase(), { word, ipa, meaning, tags: tags.split(' ').filter(Boolean), exchange, pos }];
    }));
  })();
  return (await database).get(word.toLowerCase());
}

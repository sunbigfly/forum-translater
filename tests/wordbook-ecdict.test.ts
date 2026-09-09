import { expect, it } from 'vitest';
import { localWord } from '../src/wordbook-ecdict';
it('reads an offline English-Chinese entry with exam tags and inflections', async () => {
  const word = await localWord('enterprise'); expect(word?.meaning).toContain('企业'); expect(word?.tags.length).toBeGreaterThan(0); expect(word?.exchange).toContain('enterprises');
  expect(await localWord('Enterprise')).toEqual(word); expect(await localWord('this-is-not-a-dictionary-word')).toBeUndefined();
});

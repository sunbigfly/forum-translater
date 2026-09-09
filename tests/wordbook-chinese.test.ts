import { expect, it } from 'vitest';
import { chineseExampleParts, simplifiedChinese } from '../src/wordbook-chinese';
it('converts traditional example text while keeping proper English names', () => {
  expect(simplifiedChinese('七個月前，一家社會企業的廚師開始教這些婦女新的烹飪技能。Souk el Tayeb'))
    .toBe('七个月前，一家社会企业的厨师开始教这些妇女新的烹饪技能。Souk el Tayeb');
});
it('marks the Chinese dictionary equivalent after simplification including cached traditional text', () => {
  const parts = chineseExampleParts('學校與企業見面。這家社會企業正在成長。', ['n. 企业, 事业心, 进取心, 干事业', '企业版']);
  expect(parts.filter(part => part.marked).map(part => part.text)).toEqual(['企业', '企业']);
  expect(parts.map(part => part.text).join('')).toBe('学校与企业见面。这家社会企业正在成长。');
});
it('prefers complete terms and does not mark single-character or parenthetical guesses', () => {
  expect(chineseExampleParts('这家企业经营业务。', ['n. 企业, 企业经营', '事（这家）']).filter(part => part.marked).map(part => part.text)).toEqual(['企业经营']);
  expect(chineseExampleParts('事业兴旺。', ['事']).every(part => !part.marked)).toBe(true);
});

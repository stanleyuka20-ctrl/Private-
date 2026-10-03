import { describe, expect, it } from 'vitest';
import { containsAmericanOdds, findPriceTokens, normalizeSpaces, parsePercentInput } from '../../src/core/parse';

const raws = (text: string) => findPriceTokens(normalizeSpaces(text)).map((t) => t.raw);
const one = (text: string) => {
  const tokens = findPriceTokens(normalizeSpaces(text));
  expect(tokens).toHaveLength(1);
  return tokens[0]!;
};

describe('findPriceTokens', () => {
  it('recognises percentages, including decimals and a space before %', () => {
    expect(one('62%')).toMatchObject({ unit: 'percent', digits: '62', decimals: 0, signed: false, qualifier: null });
    expect(one('52.38%')).toMatchObject({ unit: 'percent', digits: '52.38', decimals: 2 });
    expect(one('52.38 %').raw).toBe('52.38 %');
    expect(one('Trump62%chance').digits).toBe('62');
  });

  it('recognises cents and sub-cent prices', () => {
    expect(one('Yes 62¢')).toMatchObject({ unit: 'cents', digits: '62' });
    expect(one('62.5¢')).toMatchObject({ unit: 'cents', digits: '62.5', decimals: 1 });
  });

  it('recognises dollar prices only in the $0\u2013$1 contract range with a decimal point', () => {
    expect(one('$0.62')).toMatchObject({ unit: 'dollars', digits: '0.62' });
    expect(one('$.62').digits).toBe('.62');
    expect(one('$1.00').probability).toEqual({ num: 1n, den: 1n });
    expect(raws('$1')).toEqual([]);
    expect(raws('$12.40')).toEqual([]);
    expect(raws('$1,234.56')).toEqual([]);
    expect(raws('$0.5M Vol.')).toEqual([]);
    expect(raws('$0.5K')).toEqual([]);
    expect(raws('$1.50')).toHaveLength(1); // a token, but out of range
    expect(one('$1.50').probability).toBeNull();
  });

  it('never treats bare numbers as prices', () => {
    expect(raws('62')).toEqual([]);
    expect(raws('0.62')).toEqual([]);
    expect(raws('-110 +150')).toEqual([]);
    expect(raws('Total 47.5')).toEqual([]);
    expect(raws('Vol 1,234,567')).toEqual([]);
  });

  it('marks out-of-range values instead of clamping them', () => {
    expect(one('150%').probability).toBeNull();
    expect(one('101¢').probability).toBeNull();
    expect(one('100%').probability).toEqual({ num: 1n, den: 1n });
    expect(one('0%').probability).toEqual({ num: 0n, den: 1n });
  });

  it('ignores digits that continue a larger number', () => {
    expect(raws('1,234%')).toEqual([]);
  });

  it('flags signed values (price changes) and qualifiers', () => {
    expect(one('+5%').signed).toBe(true);
    expect(one('-3.2%').signed).toBe(true);
    expect(one('\u22123%').signed).toBe(true);
    expect(one('▲ 4%').signed).toBe(true);
    expect(one('↓ 2¢').signed).toBe(true);
    expect(one('(+5.2%)').signed).toBe(true);
    expect(one('<1%').qualifier).toBe('<');
    expect(one('>99%').qualifier).toBe('>');
    expect(one('≥ 99%').qualifier).toBe('≥');
    expect(one('~62%').qualifier).toBe('~');
  });

  it('does not mistake a spread or separator for a sign', () => {
    const tokens = findPriceTokens('PHI -1.5 52¢');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ raw: '52¢', signed: false });
    expect(one('Lakers - 62%').signed).toBe(false);
  });

  it('finds several tokens with offsets', () => {
    const text = 'Yes 62¢ No 39¢';
    const tokens = findPriceTokens(text);
    expect(tokens.map((t) => [t.raw, t.start, t.end])).toEqual([
      ['62¢', 4, 7],
      ['39¢', 11, 14],
    ]);
  });

  it('normalises exotic whitespace', () => {
    expect(normalizeSpaces('62\u00a0%')).toBe('62 %');
    expect(normalizeSpaces('62\u202f¢')).toBe('62 ¢');
    expect(normalizeSpaces('6\u200b2%')).toBe('62%');
  });
});

describe('containsAmericanOdds', () => {
  it('detects existing American odds', () => {
    expect(containsAmericanOdds('PHI \u2212122')).toBe(true);
    expect(containsAmericanOdds('KC +150')).toBe(true);
    expect(containsAmericanOdds('55¢ (-122)')).toBe(true);
    expect(containsAmericanOdds('+100')).toBe(true);
  });

  it('ignores spreads, totals, scores, money and percentages', () => {
    expect(containsAmericanOdds('PHI -1.5')).toBe(false);
    expect(containsAmericanOdds('+7')).toBe(false);
    expect(containsAmericanOdds('O 220.5')).toBe(false);
    expect(containsAmericanOdds('112-108')).toBe(false);
    expect(containsAmericanOdds('+$150')).toBe(false);
    expect(containsAmericanOdds('-$1,234')).toBe(false);
    expect(containsAmericanOdds('+125%')).toBe(false);
    expect(containsAmericanOdds('-99')).toBe(false);
    expect(containsAmericanOdds('+1,250')).toBe(false);
  });
});

describe('parsePercentInput (calculator)', () => {
  it('accepts plain and %-suffixed percentages', () => {
    expect(parsePercentInput('52.38')).toMatchObject({ ok: true, digits: '52.38' });
    expect(parsePercentInput(' 52.38 % ')).toMatchObject({ ok: true, digits: '52.38' });
    expect(parsePercentInput('60')).toMatchObject({ ok: true });
    expect(parsePercentInput('.5')).toMatchObject({ ok: true });
    expect(parsePercentInput('52,38')).toMatchObject({ ok: true, digits: '52.38' });
  });

  it('reports empty, invalid and out-of-range input', () => {
    expect(parsePercentInput('')).toEqual({ ok: false, error: 'empty' });
    expect(parsePercentInput('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parsePercentInput('abc')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePercentInput('1e3')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePercentInput('5.5.5')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePercentInput('-5')).toEqual({ ok: false, error: 'out-of-range' });
    expect(parsePercentInput('100.5')).toEqual({ ok: false, error: 'out-of-range' });
  });

  it('accepts the 0% and 100% boundaries (the caller explains they have no odds)', () => {
    expect(parsePercentInput('0')).toMatchObject({ ok: true });
    expect(parsePercentInput('100')).toMatchObject({ ok: true });
  });
});

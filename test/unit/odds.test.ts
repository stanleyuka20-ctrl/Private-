import { describe, expect, it } from 'vitest';
import {
  MINUS,
  convertDecimal,
  formatAmericanOdds,
  oddsToNumber,
  parseDecimal,
  probabilityFromDecimal,
  roundingRange,
  toAmericanOdds,
  type Probability,
} from '../../src/core/odds';

const pct = (text: string): Probability => {
  const p = probabilityFromDecimal(text, 'percent');
  if (!p) throw new Error(`bad percent ${text}`);
  return p;
};
const fmt = (text: string, mode: 'whole' | 'tenth' | 'five' = 'whole') =>
  formatAmericanOdds(toAmericanOdds(pct(text)), mode);

describe('required conversion examples (rounded to nearest whole number)', () => {
  const table: Array<[string, string]> = [
    ['10', '+900'],
    ['20', '+400'],
    ['25', '+300'],
    ['40', '+150'],
    ['50', '+100'],
    ['52.38', `${MINUS}110`],
    ['60', `${MINUS}150`],
    ['75', `${MINUS}300`],
    ['80', `${MINUS}400`],
    ['90', `${MINUS}900`],
  ];
  it.each(table)('%s%% → %s', (input, expected) => {
    expect(fmt(input)).toBe(expected);
  });
});

describe('formulas', () => {
  it('uses +100 × (1 \u2212 p) / p below 50%', () => {
    expect(oddsToNumber(toAmericanOdds(pct('37')))).toBeCloseTo((100 * 0.63) / 0.37, 10);
  });

  it('uses \u2212100 × p / (1 \u2212 p) above 50%', () => {
    expect(oddsToNumber(toAmericanOdds(pct('63')))).toBeCloseTo((-100 * 0.63) / 0.37, 10);
  });

  it('shows exactly 50% as +100', () => {
    expect(toAmericanOdds(pct('50'))).toEqual({ kind: 'finite', sign: 1, num: 1n, den: 1n });
    expect(fmt('50.000')).toBe('+100');
  });

  it('is symmetric: p and 1 \u2212 p give opposite odds', () => {
    for (const [a, b] of [['30', '70'], ['12.5', '87.5'], ['1', '99'], ['49.9', '50.1']] as const) {
      expect(oddsToNumber(toAmericanOdds(pct(a)))).toBeCloseTo(-oddsToNumber(toAmericanOdds(pct(b))), 9);
    }
  });

  it('never produces a magnitude below 100', () => {
    for (let tenths = 1; tenths < 1000; tenths++) {
      const text = `${Math.floor(tenths / 10)}.${tenths % 10}`;
      const formatted = fmt(text);
      expect(formatted).not.toBeNull();
      expect(Math.abs(Number(formatted!.replace(MINUS, '-')))).toBeGreaterThanOrEqual(100);
    }
  });
});

describe('precision', () => {
  it('keeps decimal percentages exact', () => {
    expect(pct('52.38')).toEqual({ num: 2619n, den: 5000n });
    // \u2212100 × 0.5238 / 0.4762 = \u2212109.9958…, which must round to \u2212110, not \u2212109.
    expect(oddsToNumber(toAmericanOdds(pct('52.38')))).toBeCloseTo(-109.99580008399832, 10);
  });

  it('does not suffer binary floating-point drift (0.57 × 100 ≠ 57 in floats)', () => {
    const fromDollars = probabilityFromDecimal('0.57', 'unit');
    expect(fromDollars).toEqual(pct('57'));
    expect(formatAmericanOdds(toAmericanOdds(fromDollars!))).toBe(`${MINUS}133`);
  });

  it('supports sub-cent precision such as 62.5¢', () => {
    expect(fmt('62.5')).toBe(`${MINUS}167`);
    expect(fmt('62.5', 'tenth')).toBe(`${MINUS}166.7`);
  });

  it('rounds only for display', () => {
    // 40.16% → +149.003… ; 39.84% → +151.004… ; 33.3% → +200.300… ; 33.4% → +199.401…
    expect(fmt('40.16')).toBe('+149');
    expect(fmt('39.84')).toBe('+151');
    expect(fmt('33.3')).toBe('+200');
    expect(fmt('33.4')).toBe('+199');
    expect(fmt('60', 'tenth')).toBe(`${MINUS}150.0`);
  });

  it('rounds exact .5 ties away from zero', () => {
    // 32% → +100 × 0.68 / 0.32 = +212.5 exactly; 68% → \u2212212.5 exactly.
    expect(oddsToNumber(toAmericanOdds(pct('32')))).toBe(212.5);
    expect(fmt('32')).toBe('+213');
    expect(fmt('68')).toBe(`${MINUS}213`);
    // Nearest 5: 212.5 / 5 = 42.5 → 43 → 215.
    expect(fmt('32', 'five')).toBe('+215');
    // 12.8% → +681.25 exactly → one decimal: +681.3.
    expect(oddsToNumber(toAmericanOdds(pct('12.8')))).toBe(681.25);
    expect(fmt('12.8', 'tenth')).toBe('+681.3');
    expect(fmt('12.8')).toBe('+681');
  });
});

describe('rounding modes', () => {
  it('whole, tenth and nearest-5', () => {
    expect(fmt('52.38', 'whole')).toBe(`${MINUS}110`);
    expect(fmt('52.38', 'tenth')).toBe(`${MINUS}110.0`);
    expect(fmt('52.38', 'five')).toBe(`${MINUS}110`);
    expect(fmt('53', 'whole')).toBe(`${MINUS}113`);
    expect(fmt('53', 'tenth')).toBe(`${MINUS}112.8`);
    expect(fmt('53', 'five')).toBe(`${MINUS}115`);
    expect(fmt('41', 'five')).toBe('+145');
  });

  it('keeps values next to even money at ±100', () => {
    expect(fmt('50.01')).toBe(`${MINUS}100`);
    expect(fmt('49.99')).toBe('+100');
  });
});

describe('boundaries and invalid input', () => {
  it('0% and 100% have no finite American odds', () => {
    expect(toAmericanOdds(pct('0'))).toEqual({ kind: 'none', reason: 'zero' });
    expect(toAmericanOdds(pct('100'))).toEqual({ kind: 'none', reason: 'one' });
    expect(fmt('0')).toBeNull();
    expect(fmt('100.00')).toBeNull();
  });

  it('extreme but valid prices convert', () => {
    expect(fmt('1')).toBe('+9900');
    expect(fmt('99')).toBe(`${MINUS}9900`);
    expect(fmt('0.5')).toBe('+19900');
  });

  it('rejects values outside 0\u2013100% and malformed numbers', () => {
    for (const bad of ['100.01', '101', '-5', '', '.', 'abc', '1e2', '5,5', '12.3.4', ' 5', 'NaN', 'Infinity']) {
      expect(probabilityFromDecimal(bad, 'percent'), bad).toBeNull();
    }
    expect(probabilityFromDecimal('1.01', 'unit')).toBeNull();
    expect(convertDecimal('150', 'percent')).toBeNull();
  });

  it('throws on impossible probabilities instead of returning misleading odds', () => {
    expect(() => toAmericanOdds({ num: 3n, den: 2n })).toThrow(RangeError);
    expect(() => toAmericanOdds({ num: -1n, den: 2n })).toThrow(RangeError);
    expect(() => toAmericanOdds({ num: 1n, den: 0n })).toThrow(RangeError);
  });

  it('parseDecimal limits absurd precision', () => {
    expect(parseDecimal('1.123456789')).toBeNull();
    expect(parseDecimal('1234567')).toBeNull();
    expect(parseDecimal('.5')).toEqual({ num: 5n, den: 10n, decimals: 1 });
  });
});

describe('rounding range for possibly rounded source prices', () => {
  it('reports the odds at ± half of the last shown digit', () => {
    const r = roundingRange('62', 'percent');
    expect(r).toEqual({
      lowPercent: '61.5%',
      highPercent: '62.5%',
      lowValue: '61.5',
      highValue: '62.5',
      oddsAtLow: `${MINUS}160`,
      oddsAtHigh: `${MINUS}167`,
    });
  });

  it('handles dollar prices and clamps at the boundaries', () => {
    expect(roundingRange('0.62', 'unit')).toMatchObject({ lowPercent: '61.5%', lowValue: '0.615', highValue: '0.625' });
    expect(roundingRange('62.5', 'percent')).toMatchObject({ lowValue: '62.45', highValue: '62.55' });
    const zero = roundingRange('0', 'percent');
    expect(zero?.lowPercent).toBe('0%');
    expect(zero?.oddsAtLow).toBeNull();
    const hundred = roundingRange('100', 'percent');
    expect(hundred?.highPercent).toBe('100%');
    expect(hundred?.highValue).toBe('100');
    expect(roundingRange('1.00', 'unit')?.highValue).toBe('1');
    expect(zero?.lowValue).toBe('0');
    expect(hundred?.oddsAtHigh).toBeNull();
    expect(roundingRange('100.5', 'percent')).toBeNull();
  });
});

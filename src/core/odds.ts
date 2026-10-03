/**
 * Shared conversion module: exact probabilities and American odds.
 *
 * A probability is kept as a ratio of integers taken straight from the
 * displayed digits ("52.38%" → 5238 / 10000), and every step up to the final
 * display rounding uses exact BigInt arithmetic, so no precision is lost.
 *
 *   p < 50%  →  +100 × (1 \u2212 p) / p
 *   p > 50%  →  \u2212100 × p / (1 \u2212 p)
 *   p = 50%  →  +100
 *   p = 0% or 100%  →  no finite American odds
 */

/** An exact probability p = num / den with 0 ≤ num ≤ den and den > 0. */
export interface Probability {
  readonly num: bigint;
  readonly den: bigint;
}

export type RoundingMode = 'whole' | 'tenth' | 'five';

export const ROUNDING_MODES: readonly RoundingMode[] = ['whole', 'tenth', 'five'];

/** Why a probability has no finite American odds. */
export type NoOddsReason = 'zero' | 'one';

export type AmericanOdds =
  /** |odds| = 100 × num / den, which is always ≥ 100. */
  | { readonly kind: 'finite'; readonly sign: 1 | -1; readonly num: bigint; readonly den: bigint }
  | { readonly kind: 'none'; readonly reason: NoOddsReason };

/** True minus sign (U+2212), used for display. */
export const MINUS = '\u2212';

const MAX_INTEGER_DIGITS = 6;
const MAX_FRACTION_DIGITS = 8;

export interface ParsedDecimal {
  /** Value = num / den. */
  readonly num: bigint;
  readonly den: bigint;
  /** Number of digits shown after the decimal point. */
  readonly decimals: number;
}

/**
 * Parses an unsigned decimal string such as "52.38", ".5" or "60" exactly.
 * Signs, exponents, separators and anything else are rejected (null).
 */
export function parseDecimal(text: string): ParsedDecimal | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  if (intPart === '' && fracPart === '') return null;
  if (intPart.length > MAX_INTEGER_DIGITS || fracPart.length > MAX_FRACTION_DIGITS) return null;
  return {
    num: BigInt((intPart || '0') + fracPart),
    den: 10n ** BigInt(fracPart.length),
    decimals: fracPart.length,
  };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduce(num: bigint, den: bigint): Probability {
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/**
 * Builds an exact probability from a displayed decimal number.
 * `scale` says what the number is out of: 'percent' (0–100, also used for
 * cents of a $1 contract) or 'unit' (0–1, used for dollars of a $1 contract).
 * Returns null for malformed input or values outside 0–100%.
 */
export function probabilityFromDecimal(text: string, scale: 'percent' | 'unit'): Probability | null {
  const parsed = parseDecimal(text);
  if (!parsed) return null;
  const den = scale === 'percent' ? parsed.den * 100n : parsed.den;
  if (parsed.num > den) return null;
  return reduce(parsed.num, den);
}

export function isValidProbability(p: Probability): boolean {
  return p.den > 0n && p.num >= 0n && p.num <= p.den;
}

/** Converts an exact probability to exact American odds. */
export function toAmericanOdds(p: Probability): AmericanOdds {
  if (!isValidProbability(p)) throw new RangeError('Probability must be between 0 and 1');
  const { num, den } = p;
  if (num === 0n) return { kind: 'none', reason: 'zero' };
  if (num === den) return { kind: 'none', reason: 'one' };
  const twice = 2n * num;
  if (twice === den) return { kind: 'finite', sign: 1, num: 1n, den: 1n };
  if (twice < den) return { kind: 'finite', sign: 1, num: den - num, den: num };
  return { kind: 'finite', sign: -1, num, den: den - num };
}

/** Odds as a floating-point number (for tests and secondary displays only). */
export function oddsToNumber(odds: AmericanOdds): number {
  if (odds.kind === 'none') return odds.reason === 'zero' ? Infinity : -Infinity;
  return (odds.sign * 100 * Number(odds.num)) / Number(odds.den);
}

/**
 * Rounds |odds| for display, half away from zero, returning the magnitude in
 * tenths. Exact integer arithmetic: |odds| = 100·num/den.
 */
function roundedMagnitudeTenths(odds: { num: bigint; den: bigint }, mode: RoundingMode): bigint {
  const { num, den } = odds;
  switch (mode) {
    case 'whole':
      return ((200n * num + den) / (2n * den)) * 10n;
    case 'tenth':
      return (2000n * num + den) / (2n * den);
    case 'five':
      // |odds| / 5 = 20·num/den, rounded, then scaled back.
      return ((40n * num + den) / (2n * den)) * 50n;
  }
}

/**
 * Formats American odds for display, e.g. "+150", "\u2212110", "+100".
 * Returns null when there are no finite odds (0% or 100%).
 */
export function formatAmericanOdds(odds: AmericanOdds, mode: RoundingMode = 'whole'): string | null {
  if (odds.kind === 'none') return null;
  const tenths = roundedMagnitudeTenths(odds, mode);
  const sign = odds.sign === 1 ? '+' : MINUS;
  const body = mode === 'tenth' ? `${tenths / 10n}.${tenths % 10n}` : `${tenths / 10n}`;
  return sign + body;
}

/** Spoken form for assistive technology, e.g. "minus 110". */
export function spokenAmericanOdds(formatted: string): string {
  return formatted.replace(MINUS, 'minus ').replace('+', 'plus ');
}

export function describeNoOdds(reason: NoOddsReason): string {
  return reason === 'zero'
    ? 'No finite American odds: a 0% price implies the outcome never happens.'
    : 'No finite American odds: a 100% price leaves no profit to quote.';
}

/** Convenience: displayed decimal string → formatted American odds (or null). */
export function convertDecimal(
  text: string,
  scale: 'percent' | 'unit',
  mode: RoundingMode = 'whole',
): { odds: AmericanOdds; formatted: string | null } | null {
  const p = probabilityFromDecimal(text, scale);
  if (!p) return null;
  const odds = toAmericanOdds(p);
  return { odds, formatted: formatAmericanOdds(odds, mode) };
}

export interface RoundingRange {
  /** Lowest probability the rounded display could stand for, as a percent string. */
  readonly lowPercent: string;
  readonly highPercent: string;
  /** The same bounds in the source's own scale, e.g. "61.5" (percent/cents) or "0.615" (dollars). */
  readonly lowValue: string;
  readonly highValue: string;
  /** Formatted odds at the low/high probability bounds (null = no finite odds there). */
  readonly oddsAtLow: string | null;
  readonly oddsAtHigh: string | null;
}

/** Formats `scaled / 10^decimals` as a decimal string without trailing zeros. */
function formatScaled(scaled: bigint, decimals: number): string {
  const digits = scaled.toString().padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

function formatPercentOf(p: Probability): string {
  // Percent with up to 4 decimals, trailing zeros trimmed.
  const scaled = (p.num * 1000000n + p.den / 2n) / p.den; // percent × 10^4
  const intPart = scaled / 10000n;
  const frac = (scaled % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${intPart}.${frac}%` : `${intPart}%`;
}

/**
 * When a displayed price may itself be rounded to its last shown digit, the
 * true value lies within ± half a unit of that digit. Returns the odds at both
 * ends of that interval (clamped to 0–100%), or null if the input is invalid.
 */
export function roundingRange(text: string, scale: 'percent' | 'unit', mode: RoundingMode = 'whole'): RoundingRange | null {
  const parsed = parseDecimal(text);
  if (!parsed) return null;
  const unitDen = scale === 'percent' ? 100n : 1n;
  // Work in halves of the last shown digit: value = 2·num / den.
  const den = parsed.den * unitDen * 2n;
  if (parsed.num * 2n > den) return null;
  const lowNum = parsed.num === 0n ? 0n : parsed.num * 2n - 1n;
  const highNumRaw = parsed.num * 2n + 1n;
  const highNum = highNumRaw > den ? den : highNumRaw;
  const low = reduce(lowNum, den);
  const high = reduce(highNum, den);
  // In the source scale: bound = (2·num ± 1) / (2·10^decimals) = (2·num ± 1)·5 / 10^(decimals+1).
  const maxScaled = (scale === 'percent' ? 100n : 1n) * 10n ** BigInt(parsed.decimals + 1);
  const lowScaled = parsed.num === 0n ? 0n : (parsed.num * 2n - 1n) * 5n;
  const highScaled = (parsed.num * 2n + 1n) * 5n > maxScaled ? maxScaled : (parsed.num * 2n + 1n) * 5n;
  return {
    lowPercent: formatPercentOf(low),
    highPercent: formatPercentOf(high),
    lowValue: formatScaled(lowScaled, parsed.decimals + 1),
    highValue: formatScaled(highScaled, parsed.decimals + 1),
    oddsAtLow: formatAmericanOdds(toAmericanOdds(low), mode),
    oddsAtHigh: formatAmericanOdds(toAmericanOdds(high), mode),
  };
}

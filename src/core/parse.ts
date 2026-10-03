/**
 * Price-token parsing shared by the content scripts and the popup.
 *
 * Only explicitly marked prices are recognised:
 *   - percentages: "62%", "52.38 %"
 *   - cents:       "62¢", "62.5¢"   (only meaningful for $1-payout contracts)
 *   - dollars:     "$0.62", "$.62"  (only meaningful for $1-payout contracts)
 * Bare numbers are never treated as prices. Whether a token is actually a
 * contract price is decided later from its page context.
 */
import { parseDecimal, probabilityFromDecimal, type Probability } from './odds';

export type PriceUnit = 'percent' | 'cents' | 'dollars';

export interface PriceToken {
  readonly unit: PriceUnit;
  /** The matched text, e.g. "52.38%", "62¢", "$0.62". */
  readonly raw: string;
  /** The numeric part exactly as displayed, e.g. "52.38". */
  readonly digits: string;
  /** Digits shown after the decimal point. */
  readonly decimals: number;
  /** Offsets of `raw` in the text that was scanned. */
  readonly start: number;
  readonly end: number;
  /** Exact probability, or null when the value is outside 0–100% / $0–$1. */
  readonly probability: Probability | null;
  /** A comparison/approximation prefix such as "<", ">", "~" ("<1%"). */
  readonly qualifier: string | null;
  /** Preceded by +, \u2212, ▲, ▼, ↑, ↓…: a change, not a price level. */
  readonly signed: boolean;
}

const SPACE_CHARS = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;

/** Maps exotic spaces to ' ', drops zero-width characters and collapses runs of whitespace. */
export function normalizeSpaces(text: string): string {
  return text.replace(ZERO_WIDTH, '').replace(SPACE_CHARS, ' ').replace(/\s+/g, ' ');
}

const TOKEN_RE = /\$ ?(\d+(?:\.\d+)?|\.\d+)|(\d+(?:\.\d+)?|\.\d+) ?(%|¢)/g;
const SIGN_CHARS = '+-\u2212\u2013\u2014';
const ARROW_CHARS = '▲▼△▽↑↓⬆⬇⏶⏷▴▾';
const QUALIFIER_CHARS = '<>≤≥~≈±';

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

/** Looks left of `index`, optionally skipping one space. */
function charBefore(text: string, index: number, skipSpace: boolean): string | undefined {
  let i = index - 1;
  if (skipSpace && text[i] === ' ') i -= 1;
  return i >= 0 ? text[i] : undefined;
}

/**
 * Finds every explicitly marked price-like token in already-normalised text.
 * Tokens with values out of range are still returned (probability = null) so
 * callers can tell that a number with a unit was present.
 */
export function findPriceTokens(text: string): PriceToken[] {
  const tokens: PriceToken[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    const next = text[end];
    const prev = text[start - 1];
    const isDollar = m[1] !== undefined;
    const digits = (isDollar ? m[1] : m[2]) ?? '';

    if (isDollar) {
      // "$1,234.56", "$0.5M", "$12.40", "$1" are amounts, not $1-contract prices.
      if (isDigit(next) || ((next === ',' || next === '.') && isDigit(text[end + 1]))) continue;
      if (next !== undefined && /[kmbt]/i.test(next) && !isLetter(text[end + 1])) continue;
      if (!digits.includes('.')) continue;
      const intPart = digits.split('.')[0] ?? '';
      if (intPart.replace(/^0+/, '').length > 1) continue;
    } else {
      // Part of a larger number such as "1,234%" or "1.2.3%".
      if (isDigit(prev) || prev === '.' || (prev === ',' && isDigit(text[start - 2]))) continue;
    }

    const parsed = parseDecimal(digits);
    if (!parsed) continue;
    const unit: PriceUnit = isDollar ? 'dollars' : m[3] === '%' ? 'percent' : 'cents';
    const probability = probabilityFromDecimal(digits, unit === 'dollars' ? 'unit' : 'percent');

    const before = charBefore(text, start, false);
    const beforeSpaced = charBefore(text, start, true);
    const signed =
      (before !== undefined && SIGN_CHARS.includes(before)) ||
      (beforeSpaced !== undefined && ARROW_CHARS.includes(beforeSpaced)) ||
      (before !== undefined && ARROW_CHARS.includes(before));
    let qualifier: string | null = null;
    if (beforeSpaced !== undefined && QUALIFIER_CHARS.includes(beforeSpaced)) qualifier = beforeSpaced;
    else if (beforeSpaced === '=' && QUALIFIER_CHARS.includes(charBefore(text, start - 1, true) ?? '')) {
      qualifier = charBefore(text, start - 1, true) ?? null;
    }

    tokens.push({
      unit,
      raw: m[0],
      digits,
      decimals: parsed.decimals,
      start,
      end,
      probability,
      qualifier,
      signed,
    });
  }
  return tokens;
}

const AMERICAN_RE = /(?<![\w.,$¢%\u2212+\-\u2013])[+\-\u2212\u2013] ?(\d{3,5})(?![\d.,%¢])/g;

/**
 * True when the text already shows American odds such as "\u2212110", "+150" or
 * "(+250)". Signed values below 100 (spreads like "-3.5", "+7") don't count.
 */
export function containsAmericanOdds(text: string): boolean {
  AMERICAN_RE.lastIndex = 0;
  for (let m = AMERICAN_RE.exec(text); m !== null; m = AMERICAN_RE.exec(text)) {
    if (Number(m[1]) >= 100) return true;
  }
  return false;
}

export type PercentInputError = 'empty' | 'invalid' | 'out-of-range';

export type PercentInputResult =
  | { readonly ok: true; readonly probability: Probability; readonly digits: string }
  | { readonly ok: false; readonly error: PercentInputError };

/**
 * Parses the popup calculator's percentage field. Accepts "52.38", "52.38%",
 * and a single decimal comma ("52,38").
 */
export function parsePercentInput(input: string): PercentInputResult {
  let text = normalizeSpaces(input).trim();
  if (text.endsWith('%')) text = text.slice(0, -1).trim();
  if (text === '') return { ok: false, error: 'empty' };
  if (/^[-\u2212]\s*(\d|\.\d)/.test(text)) return { ok: false, error: 'out-of-range' };
  if (/^\d*,\d+$/.test(text)) text = text.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return { ok: false, error: 'invalid' };
  if (!parseDecimal(text)) return { ok: false, error: 'invalid' };
  const probability = probabilityFromDecimal(text, 'percent');
  if (!probability) return { ok: false, error: 'out-of-range' };
  return { ok: true, probability, digits: text };
}

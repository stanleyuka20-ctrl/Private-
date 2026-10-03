import type { PriceToken, PriceUnit } from '../core/parse';
import type { PlatformId } from '../core/platforms';
import type { VisualText } from './dom';

/**
 * What a converted number represents. Kept distinct so that, for example, a
 * last-traded price is never presented as an offer you can trade at.
 *  - buy:      price to buy that outcome (ask / offer)
 *  - sell:     price to sell that outcome (bid)
 *  - last:     last traded price (not executable)
 *  - estimate: the site's estimated probability / "chance" (not executable)
 *  - price:    a price shown on an outcome button that the site does not label as bid or ask
 */
export type QuoteKind = 'buy' | 'sell' | 'last' | 'estimate' | 'price';

export type Side = 'yes' | 'no';

export type SkipReason =
  | 'out-of-range'
  | 'threshold-value'
  | 'signed-change'
  | 'qualified-value'
  | 'unit-not-used'
  | 'multiple-prices'
  | 'existing-american-odds'
  | 'unrelated-label'
  | 'ambiguous-label'
  | 'no-price-context'
  | 'order-entry'
  | 'table-column';

export type Decision =
  | { readonly ok: true; readonly kind: QuoteKind; readonly side: Side | null; readonly outcome: string | null }
  | { readonly ok: false; readonly reason: SkipReason };

export type OkDecision = Extract<Decision, { ok: true }>;

/** The smallest element that contains one price token. */
export interface TokenHit {
  readonly el: Element;
  readonly vt: VisualText;
  readonly token: PriceToken;
  /** How many price-like tokens the element contains (must be 1 to convert). */
  readonly tokenCount: number;
  /** Text nodes holding the token's first and last characters. */
  readonly firstNode: Text;
  readonly lastNode: Text;
}

export interface Analysis {
  readonly hit: TokenHit;
  /** The clickable element that is this quote (single price, short text), if any. */
  readonly interactive: Element | null;
  /** Text accompanying the price inside that element (price removed), e.g. "Yes", "PHI -1.5". */
  readonly label: string;
  /** Lower-cased words describing the price: own text plus adjacent captions. */
  readonly words: readonly string[];
  readonly side: Side | 'both' | null;
  /** Column header when the price sits in a table/grid cell; '' if unknown; null if not in a cell. */
  readonly cellHeader: string | null;
  /** Nearest enclosing row-like element that names the outcome, and that name. */
  readonly rowEl: Element | null;
  readonly rowLabel: string | null;
  /** Element whose subtree defines this quote (changes inside it trigger re-checks). */
  readonly scopeEl: Element;
}

export interface Adapter {
  readonly id: PlatformId;
  /** Price formats the platform displays. Bare numbers are never converted. */
  readonly units: Readonly<Record<PriceUnit, boolean>>;
  /**
   * Every contract on the platform pays this many dollars to the winning side
   * (from the platform's documentation). Required for converting ¢ and $ prices.
   */
  readonly payoutPerContractUSD: 1 | null;
  /** Paths (matched against location.pathname) where nothing is converted. */
  readonly excludedPaths: readonly RegExp[];
  /** Kind assigned to an outcome button that shows a price without saying bid/ask/last. */
  readonly buttonQuoteKind: QuoteKind;
  /** Convert price-only buttons whose outcome name sits outside the button (sports grids). */
  readonly unlabeledButtonQuotes: boolean;
  /** A bare percentage beside an outcome's Yes/No/Buy controls is that outcome's "chance". */
  readonly rowPercentIsEstimate: boolean;
  /** Extra words that mark unrelated numbers on this platform. */
  readonly extraExcludedWords?: readonly string[];
  /** Platform-specific final say on a decision. */
  refine?(analysis: Analysis, decision: Decision): Decision;
}

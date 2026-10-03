/**
 * Price detection shared by every platform adapter.
 *
 * A number is converted only with positive evidence that it is the price or
 * probability of a specific outcome on a $1-payout contract:
 *   - an explicit caption ("62% chance", "Last 62¢", "Best ask 62¢"),
 *   - an outcome button that shows exactly one price ("Yes 62¢", "PHI 55¢"),
 *   - a whitelisted table column (Bid / Ask / Last / Chance / Yes / No),
 *   - or a platform rule (e.g. a bare % beside an outcome's Yes/No buttons).
 * Anything unrelated or ambiguous is left unchanged.
 */
import { containsAmericanOdds, findPriceTokens, type PriceToken } from '../core/parse';
import {
  ExclusionCache,
  INTERACTIVE_SELECTOR,
  ORDER_ENTRY_SELECTOR,
  closestWithin,
  createLayoutProbe,
  isDocumentRoot,
  isElement,
  isExcludedElement,
  isLabelHost,
  isText,
  segmentAt,
  toWords,
  visualText,
  type LayoutProbe,
  type VisualText,
} from './dom';
import type { Adapter, Analysis, Decision, QuoteKind, Side, SkipReason, TokenHit } from './types';

const TOKEN_ELEMENT_LIMIT = 64;
const INTERACTIVE_TEXT_LIMIT = 120;
const ROW_TEXT_LIMIT = 240;
const CAPTION_LIMIT = 40;
const UNIT_CHARS = /[%¢$]/;

export interface ScanContext {
  readonly doc: Document;
  readonly layout: LayoutProbe;
  readonly exclusion: ExclusionCache;
  readonly tradeModes: Map<Element, 'buy' | 'sell' | null>;
}

export function createScanContext(doc: Document): ScanContext {
  return { doc, layout: createLayoutProbe(doc), exclusion: new ExclusionCache(), tradeModes: new Map() };
}

/** Text nodes under `root` that contain a unit character (%, ¢ or $). */
export function unitTextNodes(root: Node, sc: ScanContext): Text[] {
  if (isText(root)) {
    const parent = root.parentElement;
    return UNIT_CHARS.test(root.data) && parent && !sc.exclusion.isExcludedDeep(parent) ? [root] : [];
  }
  if (!isElement(root) || sc.exclusion.isExcludedDeep(root)) return [];
  const found: Text[] = [];
  const walker = sc.doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (isElement(node)) return isExcludedElement(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return UNIT_CHARS.test((node as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n as Text);
  return found;
}

function unitIndex(token: PriceToken): number {
  return token.unit === 'dollars' ? token.start : token.end - 1;
}

/**
 * Starting from a text node holding a unit character, finds the smallest
 * element (at most 3 levels up) whose text contains a complete price token
 * that uses that unit character.
 */
export function findTokenElement(unitNode: Text, sc: ScanContext): TokenHit | null {
  let el = unitNode.parentElement;
  for (let depth = 0; el && depth <= 3; depth++, el = el.parentElement) {
    if (isDocumentRoot(el) || sc.exclusion.isExcludedDeep(el)) return null;
    const vt = visualText(el, TOKEN_ELEMENT_LIMIT, sc.layout);
    if (!vt) return null;
    const tokens = findPriceTokens(vt.text);
    const token = tokens.find((t) => segmentAt(vt, unitIndex(t))?.node === unitNode);
    if (token) {
      const first = segmentAt(vt, token.start)?.node;
      const last = segmentAt(vt, token.end - 1)?.node;
      if (!first || !last) return null;
      return { el, vt, token, tokenCount: tokens.length, firstNode: first, lastNode: last };
    }
  }
  return null;
}

/** Re-derives the token hit for an element that was annotated before (null if it no longer qualifies). */
export function hitForElement(el: Element, sc: ScanContext): TokenHit | null {
  if (!el.isConnected || sc.exclusion.isExcludedDeep(el)) return null;
  const vt = visualText(el, TOKEN_ELEMENT_LIMIT, sc.layout);
  if (!vt) return null;
  const token = findPriceTokens(vt.text)[0];
  if (!token) return null;
  const unitNode = segmentAt(vt, unitIndex(token))?.node;
  if (!unitNode) return null;
  const hit = findTokenElement(unitNode, sc);
  return hit && hit.el === el ? hit : null;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Never part of an outcome's name: a number next to these is not a price. */
const STRICT_EXCLUDED = new Set([
  'vol', 'volume', 'fee', 'fees', 'cost', 'costs', 'payout', 'payouts', 'pays', 'paid', 'roi', 'profit',
  'profits', 'p&l', 'pnl', 'p/l', 'balance', 'balances', 'cash', 'funds', 'portfolio', 'equity', 'position',
  'positions', 'avg', 'average', 'filled', 'fills', 'spent', 'chg', '24h', '7d', '1d', '1w', '1m', '1y', 'apy',
  'apr', 'yield', 'bonus', 'boost', 'boosted', 'promo', 'promotion', 'discount', 'cashback', 'rebate',
  'deposit', 'deposits', 'withdraw', 'withdrawal', 'credit', 'credits', 'max', 'min', 'slippage', 'tolerance',
  'amount', 'shares', 'contracts', 'qty', 'quantity', 'size', 'liquidity', 'depth', 'holders', 'leverage',
  'margin', 'tax', 'taxes', 'commission', 'rake', 'vig', 'ev', 'kelly', 'off', 'reward', 'rewards', 'referral',
  'utilization',
]);
/** Excluded when captioning a number, but may appear inside an outcome's name ("No change"). */
const CAPTION_EXCLUDED = new Set([
  'change', 'changes', 'return', 'returns', 'gain', 'gains', 'loss', 'losses', 'value', 'interest', 'rate',
  'rates', 'today', 'stop', 'edge', 'score', 'traders', 'accuracy', 'winrate', 'spread', 'limit', 'total',
  'totals', 'range', 'fill',
]);
/** Excluded for ¢/$ amounts, which are often payouts ("To win $0.38"). */
const MONEY_EXCLUDED = new Set(['win', 'wins', 'won', 'potential', 'each', 'per']);

const ESTIMATE_WORDS = new Set(['chance', 'chances', 'probability', 'prob', 'implied', 'likely', 'likelihood', 'forecast', 'mid', 'midpoint']);
const LAST_WORDS = new Set(['last', 'traded', 'ltp']);
const SELL_WORDS = new Set(['sell', 'bid', 'bids', 'selling']);
const BUY_WORDS = new Set(['buy', 'ask', 'asks', 'offer', 'offers', 'buying']);
/** Filler around a side word: "Buy Yes", "Yes at", "Best bid Yes". */
const SIDE_FILLER = new Set([...BUY_WORDS, ...SELL_WORDS, 'at', 'price', 'best', 'for', 'the', 'contract', 'contracts']);
/** Words that describe a quote rather than name an outcome. */
const STRUCTURAL_WORDS = new Set([
  'yes', 'no', 'buy', 'sell', 'bid', 'ask', 'last', 'price', 'prices', 'chance', 'chances', 'odds', 'trade',
  'traded', 'best', 'at', 'for', 'the', 'a', 'to', 'of', 'or', 'and', 'vs', 'v', 'moneyline', 'spread',
  'total', 'totals', 'more', 'less', 'view', 'details', 'show', 'hide', 'all', 'markets', 'market', 'vol',
  'volume', 'new', 'live', 'probability',
]);

function kindFromWords(words: readonly string[]): QuoteKind | 'conflict' | null {
  const kinds = new Set<QuoteKind>();
  for (const w of words) {
    if (ESTIMATE_WORDS.has(w)) kinds.add('estimate');
    else if (LAST_WORDS.has(w)) kinds.add('last');
    else if (SELL_WORDS.has(w)) kinds.add('sell');
    else if (BUY_WORDS.has(w)) kinds.add('buy');
  }
  if (kinds.size > 1) return 'conflict';
  return kinds.values().next().value ?? null;
}

/**
 * The side a label names: "Yes", "Buy No", "DET Lions Yes" → a side; but in
 * "No change" the word "No" is part of an outcome's name, not a side.
 */
function sideOf(words: readonly string[]): Side | 'both' | null {
  const core = words.filter((w) => !SIDE_FILLER.has(w));
  const yes = core.includes('yes');
  const no = core.includes('no');
  if (yes && no) return 'both';
  const last = core[core.length - 1];
  return last === 'yes' || last === 'no' ? last : null;
}

function kindFromHeader(header: string): { kind: QuoteKind; side: Side | null } | null {
  const words = toWords(header);
  const side = sideOf(words);
  const s = side === 'both' ? null : side;
  if (words.some((w) => SELL_WORDS.has(w))) return { kind: 'sell', side: s };
  if (words.some((w) => w === 'ask' || w === 'asks' || w === 'offer' || w === 'buy')) return { kind: 'buy', side: s };
  if (words.includes('last')) return { kind: 'last', side: s };
  if (words.some((w) => w === 'chance' || w === 'probability' || w === 'implied')) return { kind: 'estimate', side: s };
  if (s && words.length === 1) return { kind: 'price', side: s };
  return null;
}

/** Sports columns whose price-only buttons price the row's team/player. */
const OUTCOME_COLUMNS = new Set(['moneyline', 'ml', 'winner', 'match winner', 'to win', '1x2', 'h2h', 'head to head', 'outcome']);

function isOutcomeColumn(header: string): boolean {
  return OUTCOME_COLUMNS.has(toWords(header).join(' '));
}

function removeToken(text: string, token: PriceToken): string {
  return `${text.slice(0, token.start)} ${text.slice(token.end)}`.replace(/\s+/g, ' ').trim();
}

const LINE_RE = /^(?:[ou]\.?\s?)?[+\-\u2212]?\d+(?:\.\d+)?$/i;

/** 'empty' = price-only; 'outcome' = names an outcome or line ("Yes", "PHI", "-1.5", "O 47.5"). */
function classifyLabel(label: string): 'empty' | 'outcome' | 'other' {
  if (label === '') return 'empty';
  if (/\p{L}/u.test(label) && !/[$€£]\s?\d/.test(label)) return 'outcome';
  return LINE_RE.test(label) ? 'outcome' : 'other';
}

function outcomeFromLabel(label: string): string | null {
  const kept = label
    .split(' ')
    .filter((w) => {
      const lw = w.toLowerCase().replace(/[^\p{L}]/gu, '');
      return !BUY_WORDS.has(lw) && !SELL_WORDS.has(lw) && !LAST_WORDS.has(lw) && lw !== 'price' && lw !== 'at';
    })
    .join(' ')
    .trim();
  if (kept === '') return null;
  return kept.length > 40 ? `${kept.slice(0, 40)}…` : kept;
}

// ---------------------------------------------------------------------------
// Context analysis
// ---------------------------------------------------------------------------

/** Static text next to a price; controls (buttons, links…) are not captions and are ignored. */
function captionText(node: ChildNode, sc: ScanContext): string | null {
  if (isText(node)) return node.data.replace(/\s+/g, ' ').trim();
  if (!isElement(node) || isLabelHost(node) || isExcludedElement(node)) return '';
  if (node.matches(INTERACTIVE_SELECTOR) || node.querySelector(INTERACTIVE_SELECTOR)) return '';
  const vt = visualText(node, CAPTION_LIMIT, sc.layout);
  return vt ? vt.text : null;
}

/**
 * Caption texts adjacent to a non-clickable price. Climbs through pure
 * wrapper elements, then reads the nearest digit-free siblings at the first
 * level that has any. A caption followed by its own number ("Vol. $1.2M")
 * belongs to that number, not to this price.
 */
function collectCaptions(start: Element, sc: ScanContext): { before: string[]; after: string[]; scopeEl: Element } {
  const before: string[] = [];
  const after: string[] = [];
  let cur = start;
  let scopeEl = start;
  for (let level = 0; level < 4; level++) {
    const parent = cur.parentElement;
    if (!parent || isDocumentRoot(parent) || sc.exclusion.isExcludedDeep(parent)) break;
    const siblings = Array.from(parent.childNodes);
    const idx = siblings.indexOf(cur);
    const texts = siblings.map((s, i) => (i === idx ? '' : captionText(s, sc)));
    scopeEl = parent;
    if (texts.every((t) => t === '')) {
      cur = parent;
      continue;
    }
    for (let i = idx - 1, taken = 0; i >= 0 && taken < 2; i--) {
      const t = texts[i];
      if (t === '') continue;
      if (t === null || t === undefined || /\d/.test(t)) break;
      before.unshift(t);
      taken++;
    }
    for (let i = idx + 1, taken = 0; i < siblings.length && taken < 2; i++) {
      const t = texts[i];
      if (t === '') continue;
      if (t === null || t === undefined || /\d/.test(t)) break;
      let next: string | null | undefined;
      for (let j = i + 1; j < siblings.length; j++) {
        if (texts[j] !== '') {
          next = texts[j];
          break;
        }
      }
      if (next !== undefined && next !== null && /\d/.test(next)) break;
      after.push(t);
      taken++;
    }
    break;
  }
  return { before, after, scopeEl };
}

function columnIndex(row: Element, cell: Element): number {
  let col = 0;
  for (const c of Array.from(row.children)) {
    if (c === cell) return col;
    col += (c as HTMLTableCellElement).colSpan || 1;
  }
  return -1;
}

function cellAtColumn(row: Element, col: number): Element | null {
  let at = 0;
  for (const c of Array.from(row.children)) {
    const span = (c as HTMLTableCellElement).colSpan || 1;
    if (col >= at && col < at + span) return c;
    at += span;
  }
  return null;
}

/** Column header text for a price inside a table/grid cell; '' if unknown; null if not in a cell. */
function findCellHeader(el: Element, sc: ScanContext): string | null {
  const cell = closestWithin(el, 'td, th, [role="cell"], [role="gridcell"]', 4);
  if (!cell) return null;
  let header: Element | null = null;
  if (cell.localName === 'td' || cell.localName === 'th') {
    const row = cell.parentElement;
    const table = cell.closest('table');
    if (row && row.localName === 'tr' && table) {
      const col = columnIndex(row, cell);
      const headRow = table.tHead?.rows[0] ?? table.rows[0];
      if (headRow && headRow !== row && col >= 0) header = cellAtColumn(headRow, col);
    }
  } else {
    const row = cell.closest('[role="row"]');
    const grid = cell.closest('[role="grid"], [role="table"], [role="treegrid"]');
    if (row && grid) {
      const cells = Array.from(row.children).filter((c) =>
        /^(cell|gridcell|columnheader|rowheader)$/.test(c.getAttribute('role') ?? ''),
      );
      const idx = cells.indexOf(cell);
      header = Array.from(grid.querySelectorAll('[role="columnheader"]'))[idx] ?? null;
    }
  }
  if (!header) return '';
  return visualText(header, CAPTION_LIMIT, sc.layout)?.text.toLowerCase() ?? '';
}

function outcomeLabelIn(vt: VisualText, quoteEl: Element): string | null {
  for (const seg of vt.segments) {
    if (quoteEl.contains(seg.node)) continue;
    const text = vt.text.slice(seg.start, seg.end).trim();
    if (!/\p{L}{2,}/u.test(text) || findPriceTokens(text).length > 0) continue;
    if (toWords(text).every((w) => STRUCTURAL_WORDS.has(w) || /^\d/.test(w))) continue;
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }
  return null;
}

/** Nearest enclosing element (≤ 6 levels) that names an outcome outside the quote itself. */
function findRow(quoteEl: Element, sc: ScanContext): { rowEl: Element | null; rowLabel: string | null; rowText: string | null } {
  let anc = quoteEl.parentElement;
  for (let i = 0; anc && i < 6 && !isDocumentRoot(anc); i++, anc = anc.parentElement) {
    if (sc.exclusion.isExcludedDeep(anc)) break;
    const vt = visualText(anc, ROW_TEXT_LIMIT, sc.layout);
    if (!vt) break;
    const label = outcomeLabelIn(vt, quoteEl);
    if (label) return { rowEl: anc, rowLabel: label, rowText: vt.text };
  }
  return { rowEl: null, rowLabel: null, rowText: null };
}

export interface FullAnalysis extends Analysis {
  /** Text right before / after the price within its button or element. */
  readonly textBefore: string;
  readonly textAfter: string;
  /** Nearest separate caption before / after a non-clickable price ('' if none). */
  readonly captionBefore: string;
  readonly captionAfter: string;
  /** Words of an adjacent caption that is really the outcome's name (checked against strict exclusions only). */
  readonly nameWords: readonly string[];
  /** Text of the row (for spotting American odds already shown nearby). */
  readonly rowText: string | null;
  readonly scopeText: string | null;
}

/** Captions that describe the quote ("Price", "Last", "Best bid") are never outcome names. */
function isQuoteCaption(text: string): boolean {
  return toWords(text).some(
    (w) => w === 'price' || ESTIMATE_WORDS.has(w) || LAST_WORDS.has(w) || BUY_WORDS.has(w) || SELL_WORDS.has(w),
  );
}

function sameLabel(caption: string, rowLabel: string | null): boolean {
  if (!rowLabel || isQuoteCaption(caption)) return false;
  const label = rowLabel.endsWith('…') ? rowLabel.slice(0, -1) : rowLabel;
  return caption === label || (rowLabel.endsWith('…') && caption.startsWith(label));
}

export function analyze(hit: TokenHit, sc: ScanContext): FullAnalysis {
  let interactive: Element | null = null;
  let label = '';
  let textBefore = hit.vt.text.slice(0, hit.token.start);
  let textAfter = hit.vt.text.slice(hit.token.end);
  const candidate = closestWithin(hit.el, INTERACTIVE_SELECTOR, 5);
  if (candidate && !isDocumentRoot(candidate)) {
    const vt = candidate === hit.el ? hit.vt : visualText(candidate, INTERACTIVE_TEXT_LIMIT, sc.layout);
    const tokens = vt ? findPriceTokens(vt.text) : [];
    const only = tokens[0];
    if (vt && tokens.length === 1 && only) {
      interactive = candidate;
      label = removeToken(vt.text, only);
      textBefore = vt.text.slice(0, only.start);
      textAfter = vt.text.slice(only.end);
    }
  }

  const row = findRow(interactive ?? hit.el, sc);
  let words: string[];
  let nameWords: string[] = [];
  let captionBefore = '';
  let captionAfter = '';
  let scopeEl: Element;
  if (interactive) {
    words = toWords(label);
    scopeEl = interactive;
  } else {
    const { token } = hit;
    label = removeToken(hit.vt.text, token);
    const captions = collectCaptions(hit.el, sc);
    const names = captions.before.filter((t) => sameLabel(t, row.rowLabel));
    nameWords = names.flatMap(toWords);
    words = [
      ...captions.before.filter((t) => !names.includes(t)).flatMap(toWords),
      ...toWords(hit.vt.text.slice(0, token.start)),
      ...toWords(hit.vt.text.slice(token.end)),
      ...captions.after.flatMap(toWords),
    ];
    scopeEl = captions.scopeEl;
    captionBefore = captions.before[captions.before.length - 1] ?? '';
    captionAfter = captions.after[0] ?? '';
  }

  const scopeText = scopeEl === hit.el ? hit.vt.text : visualText(scopeEl, INTERACTIVE_TEXT_LIMIT, sc.layout)?.text ?? null;
  return {
    hit,
    interactive,
    label,
    textBefore,
    textAfter,
    captionBefore,
    captionAfter,
    words,
    nameWords,
    side: sideOf(words),
    cellHeader: findCellHeader(hit.el, sc),
    rowEl: row.rowEl,
    rowLabel: row.rowLabel,
    rowText: row.rowText,
    scopeEl,
    scopeText,
  };
}

const SELECTED_SELECTOR = [
  '[aria-selected="true"]', '[aria-pressed="true"]', '[aria-checked="true"]', '[data-state="active"]',
  '[data-state="on"]', '[data-state="checked"]', '[data-selected="true"]', '[data-active="true"]',
].join(',');

/** Order panels with a Buy/Sell toggle: which one is selected around this side button? */
function tradeMode(interactive: Element, sc: ScanContext): 'buy' | 'sell' | null {
  let anc = interactive.parentElement;
  for (let i = 0; anc && i < 5 && !isDocumentRoot(anc); i++, anc = anc.parentElement) {
    let mode = sc.tradeModes.get(anc);
    if (mode === undefined) {
      mode = null;
      for (const sel of Array.from(anc.querySelectorAll(SELECTED_SELECTOR))) {
        if (sel === interactive || sel.contains(interactive) || interactive.contains(sel)) continue;
        const text = visualText(sel, 12, sc.layout)?.text.toLowerCase();
        if (text === 'buy' || text === 'sell') {
          mode = text;
          break;
        }
      }
      sc.tradeModes.set(anc, mode);
    }
    if (mode) return mode;
  }
  return null;
}

/** Percentage presets next to an amount field ("25% 50% Max") are order entry, not prices. */
function looksLikeOrderEntry(interactive: Element, sc: ScanContext): boolean {
  const parent = interactive.parentElement;
  if (!parent) return false;
  const grand = parent.parentElement;
  const scope = grand && !isDocumentRoot(grand) ? grand : parent;
  if (scope.querySelector(ORDER_ENTRY_SELECTOR)) return true;
  for (const sib of Array.from(parent.children)) {
    if (sib === interactive) continue;
    const text = visualText(sib, 16, sc.layout)?.text.toLowerCase() ?? '';
    if (/^(max|all|half|min|clear|reset|custom)$/.test(text)) return true;
  }
  return false;
}

function rowHasTradeControls(rowEl: Element, sc: ScanContext): boolean {
  for (const el of Array.from(rowEl.querySelectorAll(INTERACTIVE_SELECTOR))) {
    const text = visualText(el, 32, sc.layout)?.text;
    if (text && /\b(yes|no|buy|sell)\b/i.test(text)) return true;
  }
  return false;
}

function isExcludedContext(a: FullAnalysis, money: boolean, adapter: Adapter): boolean {
  const extra = adapter.extraExcludedWords ?? [];
  const strict = (w: string) => STRICT_EXCLUDED.has(w) || extra.includes(w);
  if (a.words.some(strict) || a.nameWords.some(strict)) return true;
  if (!a.interactive && a.words.some((w) => CAPTION_EXCLUDED.has(w))) return true;
  if (!money) return false;
  if (a.words.some((w) => MONEY_EXCLUDED.has(w))) return true;
  // "To win $0.39" / "Potential payout": a payout caption, even when it looks like a row name.
  const name = a.nameWords.join(' ');
  return name === 'win' || name === 'to win' || name.startsWith('potential');
}

/** "Above 3.0%", "2.8% or higher", "3.5%+", "win by 5%": the percentage is a threshold in a name, not a price. */
const COMPARISON_WORDS = new Set([
  'above', 'below', 'over', 'under', 'than', 'least', 'most', 'exceed', 'exceeds', 'exceeding', 'beyond', 'by',
  'reach', 'reaches', 'hit', 'hits', 'top', 'tops', 'past', 'cross', 'crosses', 'surpass', 'surpasses', 'between',
  'from', 'to', 'within', 'max', 'min',
]);
const OR_MORE = /^\s*(\+|or (more|less|higher|lower|above|below|greater|fewer|better|worse)\b|and (above|below|up|over|under)\b)/i;

function lastWord(text: string): string | undefined {
  const words = toWords(text);
  return words[words.length - 1];
}

function isThreshold(a: FullAnalysis): boolean {
  const inner = lastWord(a.textBefore);
  if (inner !== undefined && COMPARISON_WORDS.has(inner)) return true;
  // As a separate caption, "Over"/"Under" usually names a total's side ("Over · 52%"), not a threshold.
  const caption = lastWord(a.captionBefore);
  if (caption !== undefined && COMPARISON_WORDS.has(caption) && caption !== 'over' && caption !== 'under') return true;
  return OR_MORE.test(a.textAfter) || OR_MORE.test(a.captionAfter);
}

function skip(reason: SkipReason): Decision {
  return { ok: false, reason };
}

/** Decides whether (and as what) a detected price should be converted. */
export function classify(a: FullAnalysis, adapter: Adapter, sc: ScanContext): Decision {
  const { hit } = a;
  const t = hit.token;
  if (hit.tokenCount !== 1) return skip('multiple-prices');
  if (!adapter.units[t.unit]) return skip('unit-not-used');
  if (t.unit !== 'percent' && adapter.payoutPerContractUSD !== 1) return skip('unit-not-used');
  if (t.signed) return skip('signed-change');
  if (t.qualifier) return skip('qualified-value');
  if (!t.probability) return skip('out-of-range');
  // "10 Yes @ 62¢" is a fill or position price, not a quote.
  if (/@\s*$/.test(a.textBefore)) return skip('unrelated-label');
  if (isThreshold(a)) return skip('threshold-value');
  if ([hit.vt.text, a.label, a.scopeText, a.rowText].some((s) => s && containsAmericanOdds(s))) {
    return skip('existing-american-odds');
  }
  if (isExcludedContext(a, t.unit !== 'percent', adapter)) return skip('unrelated-label');
  if (a.side === 'both') return skip('ambiguous-label');
  let side: Side | null = a.side;
  const wordKind = kindFromWords(a.words);
  if (wordKind === 'conflict') return skip('ambiguous-label');
  let kind: QuoteKind | null = wordKind;
  const outcome = outcomeFromLabel(a.label);

  if (!kind && a.cellHeader !== null) {
    const fromHeader = kindFromHeader(a.cellHeader);
    if (fromHeader) {
      kind = fromHeader.kind;
      side = side ?? fromHeader.side;
    } else if (!a.interactive) {
      return skip('table-column');
    } else if (classifyLabel(a.label) === 'empty' && !isOutcomeColumn(a.cellHeader)) {
      // A price-only button needs a column that names what it prices (e.g. "Moneyline").
      return skip('table-column');
    }
  }

  if (a.interactive) {
    if (!kind) {
      const labelState = classifyLabel(a.label);
      if (labelState === 'other') return skip('no-price-context');
      if (side) kind = tradeMode(a.interactive, sc) ?? adapter.buttonQuoteKind;
      else if (labelState === 'outcome') kind = adapter.buttonQuoteKind;
      else {
        if (!adapter.unlabeledButtonQuotes) return skip('no-price-context');
        if (looksLikeOrderEntry(a.interactive, sc)) return skip('order-entry');
        if (!a.rowLabel) return skip('no-price-context');
        kind = adapter.buttonQuoteKind;
      }
    }
  } else if (!kind) {
    if (side || a.words.includes('price')) kind = 'price';
    else if (
      t.unit === 'percent' &&
      adapter.rowPercentIsEstimate &&
      hit.vt.text === t.raw &&
      a.rowEl !== null &&
      rowHasTradeControls(a.rowEl, sc)
    ) {
      kind = 'estimate';
    } else return skip('no-price-context');
  }

  // "Sell 25%" (sell a quarter of a position) is not a price: a percentage
  // with only an action word needs a side or an outcome name too.
  if ((kind === 'buy' || kind === 'sell') && t.unit === 'percent' && !side && !outcome && a.cellHeader === null) {
    return skip('no-price-context');
  }
  // A ¢/$ value is an estimate only when captioned as a midpoint price.
  if (kind === 'estimate' && t.unit !== 'percent' && !a.words.some((w) => w === 'mid' || w === 'midpoint')) {
    return skip('no-price-context');
  }

  const decision: Decision = { ok: true, kind, side, outcome };
  return adapter.refine ? adapter.refine(a, decision) : decision;
}

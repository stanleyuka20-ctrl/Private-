/**
 * The injected "equivalent odds" label.
 *
 * Each label is an unregistered custom element (<aoc-odds-label>) with its own
 * shadow root. Page styles can't restyle its contents, and because its text
 * lives in the shadow tree it never shows up in the page's textContent — so
 * the site's own code and this extension's scanner never read it as a price.
 */
import {
  describeNoOdds,
  formatAmericanOdds,
  roundingRange,
  spokenAmericanOdds,
  toAmericanOdds,
  type RoundingMode,
} from '../core/odds';
import type { PriceToken } from '../core/parse';
import { LABEL_TAG } from './dom';
import type { QuoteKind, Side } from './types';

export type LabelPlacement = 'odds-first' | 'price-first';

export interface LabelView {
  readonly kind: QuoteKind;
  readonly side: Side | null;
  readonly outcome: string | null;
  readonly token: PriceToken;
  readonly rounding: RoundingMode;
  readonly placement: LabelPlacement;
}

export interface LabelModel {
  /** Formatted odds, or null when there are no finite odds (0% / 100%). */
  readonly odds: string | null;
  readonly tooltip: string;
  readonly spoken: string;
  /** Changes whenever anything visible changes. */
  readonly key: string;
}

const SIDE_TEXT: Record<Side, string> = { yes: 'Yes', no: 'No' };

function describeSource(view: LabelView): string {
  const who = view.side ? SIDE_TEXT[view.side] : view.outcome;
  switch (view.kind) {
    case 'buy':
      return who ? `price to buy ${who} (ask)` : 'price to buy (ask)';
    case 'sell':
      return who ? `price to sell ${who} (bid)` : 'price to sell (bid)';
    case 'last':
      return 'last traded price — not an offer you can trade at';
    case 'estimate':
      return 'estimated chance shown by the site — not a price you can trade at';
    case 'price':
      return who ? `price shown for ${who}` : 'price shown on the page';
  }
}

function formatInUnit(value: string, unit: PriceToken['unit']): string {
  if (unit === 'percent') return `${value}%`;
  if (unit === 'cents') return `${value}¢`;
  return `$${value}`;
}

export function buildLabelModel(view: LabelView): LabelModel {
  const { token } = view;
  const probability = token.probability;
  if (!probability) throw new Error('Label requested for a token without a valid probability');
  const odds = toAmericanOdds(probability);
  const formatted = formatAmericanOdds(odds, view.rounding);
  const lines: string[] = [];
  if (formatted) lines.push(`Equivalent odds before fees: ${formatted}`);
  else lines.push('No equivalent American odds');
  lines.push(`Converted from ${token.raw}: ${describeSource(view)}.`);
  if (odds.kind === 'none') lines.push(describeNoOdds(odds.reason));
  const scale = token.unit === 'dollars' ? 'unit' : 'percent';
  const range = formatted ? roundingRange(token.digits, scale, view.rounding) : null;
  if (range && range.oddsAtLow !== range.oddsAtHigh) {
    const low = formatInUnit(range.lowValue, token.unit);
    const high = formatInUnit(range.highValue, token.unit);
    const from = range.oddsAtLow ?? 'longer odds';
    const to = range.oddsAtHigh ?? 'shorter odds';
    lines.push(`If ${token.raw} is a rounded figure (${low}–${high}), the equivalent is ${from} to ${to}.`);
  }
  lines.push('Rounded source prices make conversions approximate. Actual execution prices may differ, and fees are not included.');
  const spoken = formatted
    ? `equivalent odds before fees, ${spokenAmericanOdds(formatted)}`
    : 'no equivalent American odds';
  const key = [formatted ?? 'n/a', view.kind, view.side ?? '', view.outcome ?? '', token.raw, view.placement].join('|');
  return { odds: formatted, tooltip: lines.join('\n'), spoken, key };
}

const STYLE_TEXT = `
:host {
  display: inline !important; position: static !important; float: none !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; background: none !important;
  width: auto !important; height: auto !important; min-width: 0 !important; max-width: none !important;
  transform: none !important; visibility: visible !important; opacity: 1 !important;
  white-space: nowrap !important; text-indent: 0 !important; text-transform: none !important;
  letter-spacing: normal !important; flex: none !important; order: 0 !important;
  user-select: none !important; -webkit-user-select: none !important; pointer-events: auto !important;
}
.w { white-space: nowrap; font-family: inherit; font-style: normal; color: inherit; }
.w.after { margin-inline-start: 0.3em; }
.w.before { margin-inline-end: 0.3em; }
.sep { opacity: 0.6; font-weight: 400; }
.after .sep { margin-inline-end: 0.3em; }
.before .sep { margin-inline-start: 0.3em; }
.pill {
  display: inline-block; font-size: max(11px, 0.8em); font-weight: 650; line-height: 1.3;
  font-variant-numeric: tabular-nums; padding: 0 0.42em; border-radius: 0.55em;
  border: 1px solid rgba(127, 127, 127, 0.45);
  border-color: color-mix(in srgb, currentColor 30%, transparent);
  background: rgba(127, 127, 127, 0.12);
  background: color-mix(in srgb, currentColor 10%, transparent);
  vertical-align: 0.05em;
}
.k-last .pill, .k-estimate .pill { background: transparent; font-weight: 550; }
.k-last .pill { border-style: dashed; }
.k-estimate .pill { border-style: dotted; }
.tag { font-weight: 500; opacity: 0.8; margin-inline-start: 0.3em; font-size: 0.9em; }
.none .pill { font-weight: 500; }
.sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
@media (forced-colors: active) {
  .pill { border: 1px solid CanvasText; background: Canvas; color: CanvasText; }
}
`;

let sharedSheet: CSSStyleSheet | null | undefined;

function styleSheet(): CSSStyleSheet | null {
  if (sharedSheet !== undefined) return sharedSheet;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE_TEXT);
    sharedSheet = sheet;
  } catch {
    sharedSheet = null;
  }
  return sharedSheet;
}

export interface LabelElements {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly wrap: HTMLElement;
  readonly sr: HTMLElement;
}

export function createLabel(doc: Document): LabelElements {
  const host = doc.createElement(LABEL_TAG);
  const root = host.attachShadow({ mode: 'open' });
  const sheet = styleSheet();
  if (sheet && 'adoptedStyleSheets' in root) {
    try {
      root.adoptedStyleSheets = [sheet];
    } catch {
      appendStyle(doc, root);
    }
  } else {
    appendStyle(doc, root);
  }
  const wrap = doc.createElement('span');
  wrap.setAttribute('aria-hidden', 'true');
  const sr = doc.createElement('span');
  sr.className = 'sr';
  root.append(wrap, sr);
  return { host, root, wrap, sr };
}

function appendStyle(doc: Document, root: ShadowRoot): void {
  const style = doc.createElement('style');
  style.textContent = STYLE_TEXT;
  root.append(style);
}

export function renderLabel(el: LabelElements, model: LabelModel, view: LabelView): void {
  const doc = el.host.ownerDocument;
  const { host, wrap, sr } = el;
  host.title = model.tooltip;
  host.setAttribute('data-aoc-odds', model.odds ?? 'n/a');
  host.setAttribute('data-aoc-kind', view.kind);
  host.setAttribute('data-aoc-source', view.token.raw);
  if (view.side) host.setAttribute('data-aoc-side', view.side);
  else host.removeAttribute('data-aoc-side');

  const placeAfter = view.placement === 'price-first';
  wrap.className = `w ${placeAfter ? 'after' : 'before'} k-${view.kind}${model.odds ? '' : ' none'}`;
  const sep = doc.createElement('span');
  sep.className = 'sep';
  sep.textContent = '·';
  const pill = doc.createElement('span');
  pill.className = 'pill';
  pill.textContent = model.odds ?? 'n/a';
  if (view.kind === 'last') {
    const tag = doc.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'last';
    pill.append(tag);
  }
  wrap.replaceChildren(...(placeAfter ? [sep, pill] : [pill, sep]));
  sr.textContent = model.spoken;
}

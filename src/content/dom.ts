/**
 * Low-level DOM helpers for the content scripts.
 */
import { normalizeSpaces } from '../core/parse';

/** Tag name of the injected label host element (an unregistered custom element). */
export const LABEL_TAG = 'aoc-odds-label';

const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Elements whose text is never converted and whose subtrees are skipped. */
const EXCLUDED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option', 'optgroup',
  'datalist', 'output', 'code', 'pre', 'kbd', 'samp', 'var', 'canvas', 'iframe', 'object', 'embed',
  'head', 'title', 'meta', 'link',
]);
/** ARIA roles for order-entry widgets and gauges. */
const EXCLUDED_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'slider', 'combobox', 'progressbar', 'meter']);

/** Elements that act as a single clickable quote (a price button, link, tab…). */
export const INTERACTIVE_SELECTOR = [
  'button', '[role="button"]', 'a[href]', '[role="link"]', '[role="option"]', '[role="radio"]',
  '[role="tab"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="checkbox"]', '[role="switch"]',
  'summary', 'label',
].join(',');

export const ORDER_ENTRY_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
  'textarea', 'select', '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
  '[role="spinbutton"]', '[role="slider"]', '[role="textbox"]',
].join(',');

export function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

export function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3;
}

export function isLabelHost(node: Node | null | undefined): boolean {
  return isElement(node) && node.localName === LABEL_TAG;
}

/** True for elements whose own text must never be read as a price. */
export function isExcludedElement(el: Element): boolean {
  if (el.namespaceURI !== HTML_NS) return true; // svg, math
  const tag = el.localName;
  if (tag === LABEL_TAG || EXCLUDED_TAGS.has(tag)) return true;
  const editable = el.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  if ((el as HTMLElement).isContentEditable === true) return true;
  const role = el.getAttribute('role');
  if (role !== null && EXCLUDED_ROLES.has(role)) return true;
  return el.hasAttribute('data-aoc-ignore');
}

/** Lazily answers "does this element or any ancestor qualify as excluded?" with memoisation. */
export class ExclusionCache {
  private readonly memo = new Map<Element, boolean>();

  isExcludedDeep(el: Element): boolean {
    const path: Element[] = [];
    let result = false;
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const known = this.memo.get(cur);
      if (known !== undefined) {
        result = known;
        break;
      }
      path.push(cur);
      if (isExcludedElement(cur)) {
        result = true;
        break;
      }
    }
    for (const p of path) this.memo.set(p, result);
    return result;
  }
}

/** Layout-dependent questions, answered with real geometry in browsers and DOM heuristics elsewhere. */
export interface LayoutProbe {
  readonly available: boolean;
  /** Do two text nodes from different elements render as one run of characters ("6"+"2" → "62")? */
  inlineAdjacent(a: Text, b: Text): boolean;
}

function edgeRect(node: Text, which: 'first' | 'last'): DOMRect | null {
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  const rects = range.getClientRects();
  if (rects.length === 0) return null;
  return (which === 'first' ? rects[0] : rects[rects.length - 1]) ?? null;
}

function displayIsInline(el: Element | null): boolean {
  if (!el) return false;
  const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? '';
  return display === '' || display.startsWith('inline') || display === 'contents';
}

export function createLayoutProbe(doc: Document): LayoutProbe {
  const root = doc.documentElement;
  const available = !!root && root.getBoundingClientRect().width > 0;
  return {
    available,
    inlineAdjacent(a, b) {
      if (available) {
        const ra = edgeRect(a, 'last');
        const rb = edgeRect(b, 'first');
        if (ra && rb && ra.width + ra.height > 0 && rb.width + rb.height > 0) {
          const midA = (ra.top + ra.bottom) / 2;
          const midB = (rb.top + rb.bottom) / 2;
          const sameLine = Math.abs(midA - midB) <= Math.max(ra.height, rb.height) / 2;
          const fontSize = Number.parseFloat(doc.defaultView?.getComputedStyle(b.parentElement ?? root).fontSize ?? '16') || 16;
          const gap = rb.left - ra.right;
          return sameLine && gap >= -2 && gap <= Math.max(3, fontSize * 0.3);
        }
      }
      return displayIsInline(a.parentElement) && displayIsInline(b.parentElement);
    },
  };
}

export interface TextSegment {
  readonly node: Text;
  /** Offsets of this node's (normalised) text within VisualText.text. */
  readonly start: number;
  readonly end: number;
}

export interface VisualText {
  /** Normalised text as a reader would see it. */
  readonly text: string;
  readonly segments: readonly TextSegment[];
}

const BREAKING_ELEMENTS = new Set(['br', 'hr', 'img', 'wbr']);
/** A bare piece of a number, as rendered by digit-per-element tickers: "6", "62", ".5", "8¢". */
const NUMERIC_FRAGMENT = /^\$?[\d.]{1,4}[%¢]?$/;

/**
 * Should text from two different elements be read as one run of characters?
 * Only when they continue a number: "62"+"¢", "$"+"0.62", or ticker fragments
 * like "6"+"8" — never "-3.5"+"52%" (a spread line and a price) or
 * "Round 3"+"8%" — and only when they render next to each other.
 */
function continuesNumber(prev: Text, prevText: string, next: Text, nextText: string, layout: LayoutProbe): boolean {
  const a = prevText.trim();
  const b = nextText.trim();
  let candidate = false;
  if (/\d$/.test(a) && /^[%¢]/.test(b)) candidate = true;
  else if (a.endsWith('$') && /^[\d.]/.test(b)) candidate = true;
  else if (/[\d.]$/.test(a) && /^[\d.]/.test(b)) candidate = NUMERIC_FRAGMENT.test(a) && NUMERIC_FRAGMENT.test(b);
  return candidate && layout.inlineAdjacent(prev, next);
}

/**
 * Builds the text a reader sees inside `root`. Text from different elements
 * is separated by a space unless both sides are parts of one number that
 * renders as a single run (e.g. "<span>62</span><span>¢</span>").
 * Returns null when the text is longer than `limit` characters.
 */
export function visualText(root: Element, limit: number, layout: LayoutProbe): VisualText | null {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (isElement(node)) {
        if (isExcludedElement(node)) return NodeFilter.FILTER_REJECT;
        return BREAKING_ELEMENTS.has(node.localName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const segments: TextSegment[] = [];
  let prev: Text | null = null;
  let prevValue = '';
  let pendingBreak = false;
  let rawBudget = limit * 6 + 200;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isElement(node)) {
      pendingBreak = true;
      continue;
    }
    const data = (node as Text).data;
    rawBudget -= data.length;
    if (rawBudget < 0) return null;
    let value = normalizeSpaces(data);
    if (value === '') continue;
    if (value === ' ') {
      if (text !== '' && !text.endsWith(' ')) text += ' ';
      continue;
    }
    if (text.endsWith(' ') && value.startsWith(' ')) {
      value = value.slice(1);
    } else if (prev && text !== '' && !text.endsWith(' ') && !value.startsWith(' ')) {
      const join =
        !pendingBreak &&
        (prev.parentNode === node.parentNode || continuesNumber(prev, prevValue, node as Text, value, layout));
      if (!join) text += ' ';
    }
    pendingBreak = false;
    const start = text.length;
    text += value;
    segments.push({ node: node as Text, start, end: text.length });
    prev = node as Text;
    prevValue = value;
    if (text.trim().length > limit) return null;
  }
  // Trim, keeping segment offsets consistent.
  let offset = 0;
  if (text.startsWith(' ')) {
    text = text.slice(1);
    offset = 1;
  }
  if (text.endsWith(' ')) text = text.slice(0, -1);
  const len = text.length;
  const fixed = segments.map((s) => ({
    node: s.node,
    start: Math.max(0, s.start - offset),
    end: Math.min(len, Math.max(0, s.end - offset)),
  }));
  if (len > limit) return null;
  return { text, segments: fixed };
}

/** The segment (text node) holding character `index` of a VisualText. */
export function segmentAt(vt: VisualText, index: number): TextSegment | null {
  for (const s of vt.segments) if (index >= s.start && index < s.end) return s;
  return null;
}

/** Nearest ancestor-or-self matching `selector`, at most `maxLevels` levels up. */
export function closestWithin(el: Element, selector: string, maxLevels: number): Element | null {
  let cur: Element | null = el;
  for (let i = 0; cur && i <= maxLevels; i++, cur = cur.parentElement) {
    if (cur.matches(selector)) return cur;
  }
  return null;
}

export function isDocumentRoot(el: Element): boolean {
  const doc = el.ownerDocument;
  return el === doc.body || el === doc.documentElement;
}

/** Lower-cased words: letters, digits and the joiners in "p&l" / "p/l". */
export function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&/]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '' && w !== '/' && w !== '&');
}

/** Removes every label left behind (e.g. by a previous copy of the extension). */
export function removeStrayLabels(doc: Document): void {
  for (const el of Array.from(doc.getElementsByTagName(LABEL_TAG))) el.remove();
}

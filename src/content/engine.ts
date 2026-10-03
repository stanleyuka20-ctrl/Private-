/**
 * Keeps odds labels in sync with the page.
 *
 *  - One full scan when the integration becomes active (start, switched on,
 *    or navigating from an excluded page); afterwards only the parts of the
 *    page that changed are examined (MutationObserver, batched).
 *  - Every label belongs to exactly one price element (no duplicates). When
 *    that price changes, disappears, becomes ambiguous or now belongs to a
 *    different outcome, its label is refreshed or removed in the same batch.
 *  - DOM writes made by the engine itself are discarded from the observer
 *    queue (takeRecords), so labels never trigger further work (no loops).
 */
import { getPlatform } from '../core/platforms';
import type { DiagnosticEntry, DiagnosticsReport, PageStatus } from '../core/messages';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../core/settings';
import { analyze, classify, createScanContext, findTokenElement, hitForElement, unitTextNodes, type FullAnalysis, type ScanContext } from './detect';
import { isDocumentRoot, isElement, isLabelHost, isText, removeStrayLabels } from './dom';
import { buildLabelModel, createLabel, renderLabel, type LabelElements, type LabelPlacement, type LabelView } from './label';
import type { Adapter, OkDecision, SkipReason, TokenHit } from './types';

const DEFAULT_FLUSH_DELAY_MS = 50;
/** Give up on a label the page keeps deleting (without changing the price) after this many re-inserts. */
const MAX_REINSERTS = 3;

interface Annotation {
  readonly el: Element;
  hit: TokenHit;
  analysis: FullAnalysis;
  decision: OkDecision;
  signature: string;
  label: LabelElements | null;
  renderedKey: string;
  noRoom: boolean;
  reinserts: number;
  indexed: Element[];
}

export interface EngineOptions {
  readonly adapter: Adapter;
  readonly store: SettingsStore;
  readonly doc?: Document;
  /** False once the extension was reloaded/removed; the engine then cleans up. */
  readonly isContextValid?: () => boolean;
  readonly flushDelayMs?: number;
  readonly version?: string;
  /**
   * Resolves when the page is ready for the first scan. The content scripts
   * wait for the load event and an idle moment so labels are not inserted
   * while a framework (React/Next.js) is still hydrating the server HTML.
   */
  readonly whenReady?: () => Promise<void>;
}

/** Load event, then an idle callback (at most ~1.5 s later). */
export function pageSettled(win: Window): Promise<void> {
  return new Promise((resolve) => {
    const idle = () => {
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(() => resolve(), { timeout: 1500 });
      else win.setTimeout(resolve, 300);
    };
    if (win.document.readyState === 'complete') idle();
    else win.addEventListener('load', idle, { once: true });
  });
}

function signatureOf(hit: TokenHit, a: FullAnalysis, d: OkDecision): string {
  return [d.kind, d.side ?? '', d.outcome ?? '', a.rowLabel ?? '', hit.token.raw].join('|');
}

function describeElement(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el, i = 0; e && i < 4 && !isDocumentRoot(e); e = e.parentElement, i++) {
    let s = e.localName;
    const role = e.getAttribute('role');
    if (role) s += `[role=${role}]`;
    const testId = e.getAttribute('data-testid') ?? e.getAttribute('data-test-id') ?? e.getAttribute('data-cy');
    if (testId) s += `[data-testid=${testId.slice(0, 40)}]`;
    const classes = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean) : [];
    if (classes.length) s += `.${classes.slice(0, 3).map((c) => c.slice(0, 24)).join('.')}`;
    parts.unshift(s);
  }
  return parts.join(' > ');
}

export class Engine {
  readonly stats = { flushes: 0, fullScans: 0, evaluations: 0, inserts: 0, removals: 0 };

  private readonly adapter: Adapter;
  private readonly store: SettingsStore;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly isContextValid: () => boolean;
  private readonly flushDelay: number;
  private readonly version: string;
  private readonly whenReady: () => Promise<void>;

  private settings: Settings = DEFAULT_SETTINGS;
  private readonly annotations = new Map<Element, Annotation>();
  private readonly contextIndex = new Map<Element, Set<Annotation>>();
  private readonly skipped = new Map<Element, SkipReason>();
  private observer: MutationObserver | null = null;
  private readonly discoveryRoots = new Set<Node>();
  private readonly touchRoots = new Set<Node>();
  private labelsRemovedExternally = false;
  private fullScanPending = false;
  private lastActive = false;
  private inFlush = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly roomChecks = new Set<Annotation>();
  private roomFrame: number | null = null;
  private starting = false;
  private started = false;
  private disposed = false;
  private unsubscribe: (() => void) | null = null;
  private readonly onNavigation = () => this.scheduleFlush();

  constructor(options: EngineOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.doc = options.doc ?? document;
    const win = this.doc.defaultView;
    if (!win) throw new Error('Engine needs a document with a window');
    this.win = win;
    this.isContextValid = options.isContextValid ?? (() => true);
    this.flushDelay = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.version = options.version ?? '0.0.0';
    this.whenReady = options.whenReady ?? (() => Promise.resolve());
  }

  async start(): Promise<void> {
    if (this.starting || this.disposed) return;
    this.starting = true;
    removeStrayLabels(this.doc);
    try {
      this.settings = await this.store.load();
    } catch {
      this.settings = DEFAULT_SETTINGS;
    }
    await this.whenReady();
    if (this.disposed) return;
    try {
      this.settings = await this.store.load(); // may have changed while waiting
    } catch {
      // keep what was loaded first
    }
    if (this.disposed) return;
    removeStrayLabels(this.doc);
    this.started = true;
    this.unsubscribe = this.store.subscribe((s) => this.applySettings(s));
    this.win.addEventListener('popstate', this.onNavigation);
    this.win.addEventListener('hashchange', this.onNavigation);
    // Same-document navigations (pushState) fire no popstate; the Navigation API reports them.
    const navigation = (this.win as unknown as { navigation?: EventTarget }).navigation;
    navigation?.addEventListener?.('currententrychange', this.onNavigation);
    navigation?.addEventListener?.('navigatesuccess', this.onNavigation);
    this.syncObserver();
    this.scheduleFlush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearAll();
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    if (this.roomFrame !== null) this.win.cancelAnimationFrame?.(this.roomFrame);
    this.win.removeEventListener('popstate', this.onNavigation);
    this.win.removeEventListener('hashchange', this.onNavigation);
    const navigation = (this.win as unknown as { navigation?: EventTarget }).navigation;
    navigation?.removeEventListener?.('currententrychange', this.onNavigation);
    navigation?.removeEventListener?.('navigatesuccess', this.onNavigation);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Runs any pending batch immediately (tests, and before answering the popup). */
  flushNow(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // -------------------------------------------------------------------------
  // Settings and activity
  // -------------------------------------------------------------------------

  private platformOn(s: Settings = this.settings): boolean {
    return s.enabled && s.platforms[this.adapter.id];
  }

  private pathExcluded(): boolean {
    const path = this.win.location.pathname;
    return this.adapter.excludedPaths.some((re) => re.test(path));
  }

  private isActive(): boolean {
    return this.platformOn() && !this.pathExcluded();
  }

  private applySettings(next: Settings): void {
    if (this.disposed) return;
    const prev = this.settings;
    this.settings = next;
    this.syncObserver();
    if (!this.platformOn()) {
      this.clearAll();
      this.lastActive = false;
      return;
    }
    if (prev.displayOrder !== next.displayOrder || prev.rounding !== next.rounding) {
      this.mutate(() => {
        for (const ann of this.annotations.values()) {
          ann.noRoom = false;
          this.render(ann);
        }
      });
      this.scheduleRoomCheck();
    }
    this.scheduleFlush();
  }

  private syncObserver(): void {
    if (this.disposed) return;
    if (this.platformOn()) {
      if (!this.observer) {
        this.observer = new MutationObserver((records) => this.onMutations(records));
        this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, characterData: true });
      }
    } else if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      this.discoveryRoots.clear();
      this.touchRoots.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Mutation intake
  // -------------------------------------------------------------------------

  private onMutations(records: MutationRecord[]): void {
    for (const r of records) {
      if (r.type === 'characterData') {
        const parent = r.target.parentNode;
        if (isElement(parent)) {
          this.touchRoots.add(parent);
          this.discoveryRoots.add(parent);
        }
        continue;
      }
      if (isLabelHost(r.target)) continue;
      let external = false;
      for (const n of Array.from(r.addedNodes)) {
        if (isLabelHost(n)) continue;
        external = true;
        this.discoveryRoots.add(n);
      }
      for (const n of Array.from(r.removedNodes)) {
        if (isLabelHost(n)) this.labelsRemovedExternally = true;
        else external = true;
      }
      if (external) this.touchRoots.add(r.target);
    }
    if (!this.inFlush && (this.discoveryRoots.size || this.touchRoots.size || this.labelsRemovedExternally)) {
      this.scheduleFlush();
    }
  }

  /** Performs DOM writes and drops the observer records they caused. */
  private mutate(write: () => void): void {
    const pending = this.observer?.takeRecords() ?? [];
    if (pending.length) this.onMutations(pending);
    write();
    this.observer?.takeRecords();
  }

  private scheduleFlush(): void {
    if (this.disposed || this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushDelay);
  }

  private flush(): void {
    if (this.disposed || !this.started) return;
    if (!this.isContextValid()) {
      this.dispose();
      return;
    }
    this.stats.flushes++;
    const active = this.isActive();
    if (!active) {
      this.discoveryRoots.clear();
      this.touchRoots.clear();
      this.labelsRemovedExternally = false;
      if (this.annotations.size || this.skipped.size) this.clearAll();
      this.lastActive = false;
      return;
    }
    if (!this.lastActive) {
      this.fullScanPending = true;
      this.lastActive = true;
    }
    this.inFlush = true;
    try {
      this.mutate(() => this.process());
    } finally {
      this.inFlush = false;
    }
    if (this.discoveryRoots.size || this.touchRoots.size || this.labelsRemovedExternally) this.scheduleFlush();
    this.scheduleRoomCheck();
  }

  private collectRoots(nodes: Set<Node>, expandSmall: boolean): Element[] {
    const elements = new Set<Element>();
    for (const node of nodes) {
      let el: Element | null = isText(node) ? node.parentElement : isElement(node) ? node : null;
      if (!el || !el.isConnected || isLabelHost(el)) continue;
      // A small changed piece ("62" next to "¢") may only form a price with its neighbours.
      if (expandSmall && el.parentElement && !isDocumentRoot(el.parentElement)) {
        if (el.childElementCount <= 3 && (el.textContent?.length ?? 0) <= 16) el = el.parentElement;
      }
      elements.add(el);
    }
    const roots: Element[] = [];
    for (const el of elements) {
      let covered = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (elements.has(p)) {
          covered = true;
          break;
        }
      }
      if (!covered) roots.push(el);
    }
    return roots;
  }

  private process(): void {
    const sc = createScanContext(this.doc);
    const full = this.fullScanPending;
    this.fullScanPending = false;
    if (full) this.stats.fullScans++;
    const body = this.doc.body ?? this.doc.documentElement;
    const discovery = full ? [body] : this.collectRoots(this.discoveryRoots, true);
    const touch = full ? [] : this.collectRoots(this.touchRoots, false);
    this.discoveryRoots.clear();
    this.touchRoots.clear();
    const labelsRemoved = this.labelsRemovedExternally;
    this.labelsRemovedExternally = false;

    // 1. Re-check labels whose price element changed, moved away or lost its label.
    const recheck = new Set<Annotation>();
    for (const ann of this.annotations.values()) {
      if (full || !ann.el.isConnected) recheck.add(ann);
      else if (labelsRemoved && ann.label && ann.renderedKey && !ann.label.host.isConnected) recheck.add(ann);
    }
    for (const root of [...touch, ...discovery]) {
      for (let e: Element | null = root; e; e = e.parentElement) {
        const set = this.contextIndex.get(e);
        if (set) for (const ann of set) recheck.add(ann);
      }
    }
    for (const ann of recheck) this.recheck(ann, sc);
    for (const el of Array.from(this.skipped.keys())) if (!el.isConnected) this.skipped.delete(el);

    // 2. Find prices in the parts of the page that changed.
    const seen = new Set<Element>();
    for (const root of discovery) {
      for (const node of unitTextNodes(root, sc)) {
        const hit = findTokenElement(node, sc);
        if (!hit || seen.has(hit.el)) continue;
        seen.add(hit.el);
        const existing = this.annotations.get(hit.el);
        if (existing) {
          if (!recheck.has(existing)) this.recheck(existing, sc);
          continue;
        }
        this.evaluate(hit, sc);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Annotation lifecycle
  // -------------------------------------------------------------------------

  private evaluate(hit: TokenHit, sc: ScanContext): void {
    this.stats.evaluations++;
    const analysis = analyze(hit, sc);
    const decision = classify(analysis, this.adapter, sc);
    if (!decision.ok) {
      this.skipped.set(hit.el, decision.reason);
      return;
    }
    this.skipped.delete(hit.el);
    const ann: Annotation = {
      el: hit.el,
      hit,
      analysis,
      decision,
      signature: signatureOf(hit, analysis, decision),
      label: null,
      renderedKey: '',
      noRoom: false,
      reinserts: 0,
      indexed: [],
    };
    this.annotations.set(hit.el, ann);
    this.index(ann);
    this.render(ann);
  }

  private recheck(ann: Annotation, sc: ScanContext): void {
    this.stats.evaluations++;
    const hit = hitForElement(ann.el, sc);
    if (!hit) {
      this.remove(ann);
      return;
    }
    const analysis = analyze(hit, sc);
    const decision = classify(analysis, this.adapter, sc);
    if (!decision.ok) {
      this.remove(ann);
      this.skipped.set(ann.el, decision.reason);
      return;
    }
    const signature = signatureOf(hit, analysis, decision);
    const unchanged = signature === ann.signature && hit.firstNode === ann.hit.firstNode && hit.lastNode === ann.hit.lastNode;
    const labelLost = !!ann.label && ann.renderedKey !== '' && !ann.label.host.isConnected;
    if (labelLost && unchanged && this.settings.displayOrder !== 'price-only' && !ann.noRoom) ann.reinserts++;
    else if (!unchanged) {
      ann.reinserts = 0;
      ann.noRoom = false;
    }
    ann.hit = hit;
    ann.analysis = analysis;
    ann.decision = decision;
    ann.signature = signature;
    this.index(ann);
    this.render(ann);
  }

  private index(ann: Annotation): void {
    this.unindex(ann);
    const els = [ann.el, ann.analysis.scopeEl];
    if (ann.analysis.rowEl) els.push(ann.analysis.rowEl);
    if (ann.analysis.interactive) els.push(ann.analysis.interactive);
    for (const el of new Set(els)) {
      let set = this.contextIndex.get(el);
      if (!set) this.contextIndex.set(el, (set = new Set()));
      set.add(ann);
      ann.indexed.push(el);
    }
  }

  private unindex(ann: Annotation): void {
    for (const el of ann.indexed) {
      const set = this.contextIndex.get(el);
      if (!set) continue;
      set.delete(ann);
      if (set.size === 0) this.contextIndex.delete(el);
    }
    ann.indexed = [];
  }

  private remove(ann: Annotation): void {
    this.detachLabel(ann);
    this.unindex(ann);
    this.annotations.delete(ann.el);
    this.roomChecks.delete(ann);
  }

  private detachLabel(ann: Annotation): void {
    if (ann.label?.host.isConnected) {
      ann.label.host.remove();
      this.stats.removals++;
    }
  }

  private clearAll(): void {
    this.mutate(() => {
      for (const ann of this.annotations.values()) this.detachLabel(ann);
    });
    this.annotations.clear();
    this.contextIndex.clear();
    this.skipped.clear();
    this.roomChecks.clear();
  }

  private render(ann: Annotation): void {
    const order = this.settings.displayOrder;
    if (order === 'price-only' || ann.noRoom || ann.reinserts > MAX_REINSERTS) {
      this.detachLabel(ann);
      return;
    }
    const placement: LabelPlacement = order === 'odds-first' ? 'odds-first' : 'price-first';
    const view: LabelView = {
      kind: ann.decision.kind,
      side: ann.decision.side,
      outcome: ann.decision.outcome,
      token: ann.hit.token,
      rounding: this.settings.rounding,
      placement,
    };
    const model = buildLabelModel(view);
    if (!ann.label) ann.label = createLabel(this.doc);
    if (model.key !== ann.renderedKey) {
      renderLabel(ann.label, model, view);
      ann.renderedKey = model.key;
    }
    this.place(ann, placement);
  }

  /** Node right after which (or before which) the label goes: next to the price itself. */
  private anchor(hit: TokenHit, placement: LabelPlacement): Node {
    let node: Node = placement === 'price-first' ? hit.lastNode : hit.firstNode;
    const raw = hit.token.raw.replace(/\s+/g, '');
    while (node.parentElement && node.parentElement !== hit.el) {
      const text = (node.parentElement.textContent ?? '').replace(/\s+/g, '');
      if (text === '' || !raw.includes(text)) break;
      node = node.parentElement;
    }
    return node;
  }

  private place(ann: Annotation, placement: LabelPlacement): void {
    const host = ann.label?.host;
    if (!host) return;
    const anchor = this.anchor(ann.hit, placement);
    const parent = anchor.parentNode;
    if (!parent) return;
    if (placement === 'price-first') {
      if (anchor.nextSibling === host) return;
      parent.insertBefore(host, anchor.nextSibling);
    } else {
      if (anchor.previousSibling === host) return;
      parent.insertBefore(host, anchor);
    }
    this.stats.inserts++;
    this.roomChecks.add(ann);
  }

  // -------------------------------------------------------------------------
  // Room check: never let a label spill over neighbouring controls
  // -------------------------------------------------------------------------

  private scheduleRoomCheck(): void {
    if (!this.roomChecks.size || this.roomFrame !== null || this.disposed) return;
    const root = this.doc.documentElement;
    if (!root || root.getBoundingClientRect().width === 0 || !this.win.requestAnimationFrame) {
      this.roomChecks.clear();
      return;
    }
    this.roomFrame = this.win.requestAnimationFrame(() => {
      this.roomFrame = null;
      this.checkRoom();
    });
  }

  private clippingBox(host: Element, ann: Annotation): Element | null {
    if (ann.analysis.interactive) return ann.analysis.interactive;
    let el = host.parentElement;
    for (let i = 0; el && i < 4 && !isDocumentRoot(el); i++, el = el.parentElement) {
      const style = this.win.getComputedStyle(el);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return el;
    }
    return null;
  }

  private checkRoom(): void {
    if (this.disposed) return;
    const misfits: Annotation[] = [];
    for (const ann of this.roomChecks) {
      const host = ann.label?.host;
      if (!host?.isConnected) continue;
      const box = this.clippingBox(host, ann);
      if (!box) continue;
      const hr = host.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      if ((hr.width === 0 && hr.height === 0) || (br.width === 0 && br.height === 0)) continue;
      const fits = hr.left >= br.left - 1 && hr.right <= br.right + 1 && hr.top >= br.top - 1 && hr.bottom <= br.bottom + 1;
      if (!fits) misfits.push(ann);
    }
    this.roomChecks.clear();
    if (!misfits.length) return;
    this.mutate(() => {
      for (const ann of misfits) {
        ann.noRoom = true;
        this.detachLabel(ann);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Popup support
  // -------------------------------------------------------------------------

  getStatus(): PageStatus {
    const platform = getPlatform(this.adapter.id);
    let shown = 0;
    let noRoom = 0;
    for (const ann of this.annotations.values()) {
      if (ann.label?.host.isConnected) shown++;
      if (ann.noRoom) noRoom++;
    }
    const skippedByReason: Record<string, number> = {};
    for (const reason of this.skipped.values()) skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
    return {
      platformId: platform.id,
      platformName: platform.name,
      verification: platform.verification,
      enabled: this.settings.enabled,
      platformEnabled: this.settings.platforms[this.adapter.id],
      pageExcluded: this.pathExcluded(),
      displayOrder: this.settings.displayOrder,
      detected: this.annotations.size,
      shown,
      noRoom,
      skipped: this.skipped.size,
      skippedByReason,
    };
  }

  /**
   * Read-only report of how each price-like number on the page was handled,
   * for tuning an integration. Built on request only; nothing is sent anywhere.
   */
  getDiagnostics(limit = 80): DiagnosticsReport {
    const page = this.win.location.origin + this.win.location.pathname;
    const excluded = this.pathExcluded();
    const entries: DiagnosticEntry[] = [];
    if (!excluded) {
      const sc = createScanContext(this.doc);
      const seen = new Set<Element>();
      for (const node of unitTextNodes(this.doc.body ?? this.doc.documentElement, sc)) {
        const hit = findTokenElement(node, sc);
        if (!hit || seen.has(hit.el)) continue;
        seen.add(hit.el);
        const a = analyze(hit, sc);
        const d = classify(a, this.adapter, sc);
        entries.push({
          text: hit.vt.text,
          token: hit.token.raw,
          decision: d.ok ? `convert:${d.kind}` : `skip:${d.reason}`,
          side: d.ok ? d.side : a.side === 'both' ? 'both' : a.side,
          outcome: d.ok ? d.outcome : null,
          label: a.label.slice(0, 60),
          words: a.words.slice(0, 10),
          cellHeader: a.cellHeader,
          rowLabel: a.rowLabel,
          element: describeElement(hit.el),
        });
        if (entries.length >= limit) break;
      }
    }
    return {
      extensionVersion: this.version,
      platformId: this.adapter.id,
      page,
      generatedAt: new Date().toISOString(),
      pageExcluded: excluded,
      status: this.getStatus(),
      entries,
    };
  }
}

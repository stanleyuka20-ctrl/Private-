// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { kalshiAdapter } from '../../src/content/adapters/kalshi';
import { novigAdapter } from '../../src/content/adapters/novig';
import { polymarketUsAdapter } from '../../src/content/adapters/polymarket-us';
import { Engine } from '../../src/content/engine';
import { DEFAULT_SETTINGS, memorySettingsStore } from '../../src/core/settings';
import { labels, loadFixture, oddsOf, setBody, settle, startEngine, tick } from './helpers';

let engine: Engine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
  history.replaceState(null, '', '/');
  document.body.innerHTML = '';
});

const MARKET_ROW = (name: string, yes: string, no: string) =>
  `<div class="row"><span class="name">${name}</span><button class="yes">Yes ${yes}</button><button class="no">No ${no}</button></div>`;

function labelIn(el: Element | null): HTMLElement | null {
  return el?.querySelector('aoc-odds-label') ?? null;
}

describe('live updates', () => {
  it('updates the label when the price text changes in place', async () => {
    setBody(MARKET_ROW('Fed cut', '62¢', '39¢'));
    ({ engine } = await startEngine(kalshiAdapter));
    const yes = document.querySelector('.yes')!;
    expect(oddsOf(labelIn(yes)!)).toBe('-163');
    const text = Array.from(yes.childNodes).find((n) => n.nodeType === 3) as Text;
    text.data = 'Yes 75¢';
    await settle(engine!);
    expect(labels(yes)).toHaveLength(1);
    expect(oddsOf(labelIn(yes)!)).toBe('-300');
    expect(labelIn(yes)!.getAttribute('data-aoc-source')).toBe('75¢');
  });

  it('recovers when a framework replaces the whole text (and our label with it)', async () => {
    setBody('<div class="row"><span class="name">Eagles</span><button id="b"><span>Yes</span><span id="p">55¢</span></button></div>');
    ({ engine } = await startEngine(kalshiAdapter));
    const price = document.getElementById('p')!;
    expect(oddsOf(labelIn(price)!)).toBe('-122');
    price.textContent = '60¢'; // React-style setTextContent wipes the label too
    expect(labelIn(price)).toBeNull();
    await settle(engine!);
    expect(labels(price)).toHaveLength(1);
    expect(oddsOf(labelIn(price)!)).toBe('-150');
  });

  it('removes the label when the price disappears', async () => {
    setBody(MARKET_ROW('Fed cut', '62¢', '39¢'));
    ({ engine } = await startEngine(kalshiAdapter));
    const yes = document.querySelector('.yes')!;
    yes.textContent = 'Yes —';
    await settle(engine!);
    expect(labelIn(yes)).toBeNull();
    expect(engine!.getStatus().detected).toBe(1);
  });

  it('removes the label when the price becomes ambiguous', async () => {
    setBody('<div class="row"><span class="name">Fed</span><span class="pct" id="pct">62%</span><span>chance</span></div>');
    ({ engine } = await startEngine(kalshiAdapter));
    const pct = document.getElementById('pct')!;
    expect(labelIn(pct)).not.toBeNull();
    pct.textContent = '62% / 64%';
    await settle(engine!);
    expect(labelIn(pct)).toBeNull();
  });

  it('refreshes a reused list element that now shows a different outcome', async () => {
    setBody('<div id="list">' + MARKET_ROW('Kevin Hassett', '62¢', '39¢') + '</div>');
    ({ engine } = await startEngine(kalshiAdapter));
    const yes = document.querySelector('.yes')!;
    const before = labelIn(yes)!;
    expect(before.title).toContain('Yes');
    // Virtualised list reuses the row: same element, new outcome, side flipped on the button.
    document.querySelector('.name')!.textContent = 'Kevin Warsh';
    (Array.from(yes.childNodes).find((n) => n.nodeType === 3) as Text).data = 'No 62¢';
    await settle(engine!);
    expect(labels(yes)).toHaveLength(1);
    expect(labelIn(yes)!.getAttribute('data-aoc-side')).toBe('no');
    expect(labelIn(yes)!.title).toContain('No');
  });

  it('drops labels of removed elements', async () => {
    setBody('<div id="list">' + MARKET_ROW('A', '62¢', '39¢') + MARKET_ROW('B', '20¢', '81¢') + '</div>');
    ({ engine } = await startEngine(kalshiAdapter));
    expect(engine!.getStatus().detected).toBe(4);
    document.querySelector('.row')!.remove();
    await settle(engine!);
    expect(engine!.getStatus().detected).toBe(2);
    expect(labels()).toHaveLength(2);
  });
});

describe('scaling and loops', () => {
  it('handles infinite scroll by examining only the new rows, without duplicates', async () => {
    setBody('<div id="list">' + MARKET_ROW('Row 0', '50¢', '51¢') + '</div>');
    ({ engine } = await startEngine(kalshiAdapter));
    const list = document.getElementById('list')!;
    for (let batch = 1; batch <= 3; batch++) {
      const evaluationsBefore = engine!.stats.evaluations;
      const html = Array.from({ length: 20 }, (_, i) => MARKET_ROW(`Row ${batch}-${i}`, `${10 + i}¢`, `${91 - i}¢`)).join('');
      list.insertAdjacentHTML('beforeend', html);
      await settle(engine!);
      // 40 new prices; existing rows are not re-examined.
      expect(engine!.stats.evaluations - evaluationsBefore).toBe(40);
    }
    expect(labels()).toHaveLength(2 + 3 * 40);
    for (const button of Array.from(document.querySelectorAll('button'))) expect(labels(button)).toHaveLength(1);
    expect(engine!.stats.fullScans).toBe(1);
  });

  it('never re-processes its own label insertions (no observer loop)', async () => {
    loadFixture('kalshi');
    ({ engine } = await startEngine(kalshiAdapter));
    const flushes = engine!.stats.flushes;
    const evaluations = engine!.stats.evaluations;
    for (let i = 0; i < 5; i++) await tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(engine!.stats.flushes).toBe(flushes);
    expect(engine!.stats.evaluations).toBe(evaluations);
  });

  it('keeps exactly one label per price across repeated flushes and full rescans', async () => {
    loadFixture('kalshi');
    ({ engine } = await startEngine(kalshiAdapter));
    const count = labels().length;
    for (let i = 0; i < 3; i++) engine!.flushNow();
    expect(labels()).toHaveLength(count);
    // A second engine instance (e.g. after an extension update) removes stray labels first.
    engine!.dispose();
    ({ engine } = await startEngine(kalshiAdapter));
    expect(labels()).toHaveLength(count);
  });

  it('re-inserts a label the page removed, but gives up if the page keeps removing it', async () => {
    setBody(MARKET_ROW('Fed', '62¢', '39¢'));
    ({ engine } = await startEngine(kalshiAdapter));
    const yes = document.querySelector('.yes')!;
    for (let i = 0; i < 3; i++) {
      labelIn(yes)!.remove();
      await settle(engine!);
      expect(labelIn(yes)).not.toBeNull();
    }
    labelIn(yes)!.remove();
    await settle(engine!);
    labelIn(yes)?.remove();
    await settle(engine!);
    expect(labelIn(yes)).toBeNull();
    // A real price change resets the counter.
    (Array.from(yes.childNodes).find((n) => n.nodeType === 3) as Text).data = 'Yes 70¢';
    await settle(engine!);
    expect(oddsOf(labelIn(yes)!)).toBe('-233');
  });
});

describe('navigation without reloads', () => {
  it('clears labels on excluded pages and restores them when navigating back', async () => {
    history.replaceState(null, '', '/markets/fed');
    loadFixture('kalshi');
    ({ engine } = await startEngine(kalshiAdapter));
    const count = labels().length;
    expect(count).toBeGreaterThan(0);

    history.pushState(null, '', '/portfolio');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((r) => setTimeout(r, 5));
    engine!.flushNow();
    expect(labels()).toHaveLength(0);
    expect(engine!.getStatus().pageExcluded).toBe(true);

    // SPA renders new content while on the excluded page: still nothing converted.
    document.body.insertAdjacentHTML('beforeend', MARKET_ROW('Position', '62¢', '39¢'));
    await settle(engine!);
    expect(labels()).toHaveLength(0);

    history.pushState(null, '', '/markets/fed');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((r) => setTimeout(r, 5));
    engine!.flushNow();
    expect(labels()).toHaveLength(count + 2);
  });
});

describe('settings', () => {
  it('turns off and on instantly with the master switch', async () => {
    loadFixture('novig');
    const store = memorySettingsStore(DEFAULT_SETTINGS);
    engine = new Engine({ adapter: novigAdapter, store, flushDelayMs: 1 });
    await engine.start();
    engine.flushNow();
    const count = labels().length;
    expect(count).toBeGreaterThan(0);

    await store.save({ ...DEFAULT_SETTINGS, enabled: false });
    expect(labels()).toHaveLength(0);
    document.body.insertAdjacentHTML('beforeend', MARKET_ROW('New', '62%', '38%'));
    await settle(engine);
    expect(labels()).toHaveLength(0);

    await store.save({ ...DEFAULT_SETTINGS, enabled: true });
    await settle(engine);
    expect(labels()).toHaveLength(count + 2);
  });

  it('respects the per-platform switch', async () => {
    loadFixture('novig');
    const { engine: e, store } = await startEngine(novigAdapter);
    engine = e;
    await store.save({ ...DEFAULT_SETTINGS, platforms: { ...DEFAULT_SETTINGS.platforms, novig: false } });
    expect(labels()).toHaveLength(0);
    expect(engine.getStatus().platformEnabled).toBe(false);
    await store.save({ ...DEFAULT_SETTINGS, platforms: { ...DEFAULT_SETTINGS.platforms, kalshi: false } });
    await settle(engine);
    expect(labels().length).toBeGreaterThan(0);
  });

  it('places odds before or after the price, or hides them', async () => {
    setBody('<div class="row"><span class="name">X</span><button id="b"><span>Yes</span> <span id="p">60¢</span></button></div>');
    const { engine: e, store } = await startEngine(kalshiAdapter);
    engine = e;
    const price = document.getElementById('p')!;
    const priceText = price.firstChild!;
    expect(priceText.nextSibling?.nodeName.toLowerCase()).toBe('aoc-odds-label');

    await store.save({ ...DEFAULT_SETTINGS, displayOrder: 'odds-first' });
    expect(priceText.previousSibling?.nodeName.toLowerCase()).toBe('aoc-odds-label');
    expect(labels()).toHaveLength(1);

    await store.save({ ...DEFAULT_SETTINGS, displayOrder: 'price-only' });
    expect(labels()).toHaveLength(0);
    expect(engine.getStatus()).toMatchObject({ detected: 1, shown: 0 });

    await store.save({ ...DEFAULT_SETTINGS, displayOrder: 'price-first' });
    expect(labels()).toHaveLength(1);
  });

  it('applies the rounding preference', async () => {
    setBody('<div class="row"><span class="name">X</span><button>Yes 53%</button></div>');
    const { engine: e, store } = await startEngine(polymarketUsAdapter);
    engine = e;
    expect(oddsOf(labels()[0]!)).toBe('-113');
    await store.save({ ...DEFAULT_SETTINGS, rounding: 'tenth' });
    expect(oddsOf(labels()[0]!)).toBe('-112.8');
    await store.save({ ...DEFAULT_SETTINGS, rounding: 'five' });
    expect(oddsOf(labels()[0]!)).toBe('-115');
  });
});

describe('page safety', () => {
  it('never changes form fields and keeps clicks working', async () => {
    loadFixture('kalshi');
    ({ engine } = await startEngine(kalshiAdapter));
    expect((document.getElementById('amount') as HTMLInputElement).value).toBe('$25');
    expect((document.getElementById('limit') as HTMLInputElement).value).toBe('62');
    for (const field of Array.from(document.querySelectorAll('input, textarea, select'))) {
      expect(labels(field)).toHaveLength(0);
    }
    const yes = document.querySelector('.order-panel .yes') as HTMLButtonElement;
    let clicks = 0;
    yes.addEventListener('click', () => clicks++);
    labelIn(yes)!.click();
    expect(clicks).toBe(1);
  });

  it('keeps label text out of the page text that sites (and the scanner) read', async () => {
    setBody(MARKET_ROW('Fed', '62¢', '39¢'));
    ({ engine } = await startEngine(kalshiAdapter));
    expect(document.querySelector('.yes')!.textContent).toBe('Yes 62¢');
    expect(document.body.textContent).not.toContain('163');
  });

  it('cleans up when the extension context goes away (update or removal)', async () => {
    setBody(MARKET_ROW('Fed', '62¢', '39¢'));
    let valid = true;
    engine = new Engine({ adapter: kalshiAdapter, store: memorySettingsStore(), flushDelayMs: 1, isContextValid: () => valid });
    await engine.start();
    engine.flushNow();
    expect(labels()).toHaveLength(2);
    valid = false;
    document.body.insertAdjacentHTML('beforeend', '<p>trigger</p>');
    await settle(engine);
    expect(labels()).toHaveLength(0);
    expect(engine.isDisposed).toBe(true);
  });
});

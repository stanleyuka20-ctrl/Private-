import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import { Engine } from '../../src/content/engine';
import type { Adapter } from '../../src/content/types';
import { DEFAULT_SETTINGS, memorySettingsStore, type Settings } from '../../src/core/settings';

export const MINUS = '\u2212';

export function loadFixture(name: string): void {
  const path = resolve(process.cwd(), 'test/fixtures', `${name}.html`);
  const html = readFileSync(path, 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}

export function setBody(html: string): void {
  document.head.innerHTML = '';
  document.body.innerHTML = html;
}

/** Lets MutationObserver callbacks run. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function startEngine(adapter: Adapter, settings: Partial<Settings> = {}) {
  const store = memorySettingsStore({ ...DEFAULT_SETTINGS, ...settings });
  const engine = new Engine({ adapter, store, flushDelayMs: 1, version: 'test' });
  await engine.start();
  engine.flushNow();
  return { engine, store };
}

export async function settle(engine: Engine): Promise<void> {
  await tick();
  engine.flushNow();
}

export function labels(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('aoc-odds-label'));
}

export function oddsOf(label: Element): string {
  return (label.getAttribute('data-aoc-odds') ?? '').replace(MINUS, '-');
}

function describe(el: Element): string {
  return `${el.outerHTML.slice(0, 160)}`;
}

/** Checks every data-expect-* annotation in the current document and that no other labels exist. */
export function assertExpectations(): void {
  const all = labels();
  const expected = Array.from(document.querySelectorAll('[data-expect-odds]'));
  for (const el of expected) {
    const inside = all.filter((l) => el.contains(l));
    expect(inside.length, `exactly one label in ${describe(el)}`).toBe(1);
    const label = inside[0]!;
    expect(oddsOf(label), `odds in ${describe(el)}`).toBe(el.getAttribute('data-expect-odds'));
    const kind = el.getAttribute('data-expect-kind');
    if (kind) expect(label.getAttribute('data-aoc-kind'), `kind in ${describe(el)}`).toBe(kind);
    const side = el.getAttribute('data-expect-side');
    if (side) expect(label.getAttribute('data-aoc-side'), `side in ${describe(el)}`).toBe(side);
  }
  for (const el of Array.from(document.querySelectorAll('[data-expect-none]'))) {
    expect(all.filter((l) => el.contains(l)).map((l) => l.getAttribute('data-aoc-source')), `no label in ${describe(el)}`).toEqual([]);
  }
  const stray = all.filter((l) => !expected.some((el) => el.contains(l)));
  expect(stray.map((l) => `${l.getAttribute('data-aoc-source')} in ${describe(l.parentElement!)}`), 'unexpected labels').toEqual([]);
}

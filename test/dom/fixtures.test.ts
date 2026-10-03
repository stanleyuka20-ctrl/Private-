// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { kalshiAdapter } from '../../src/content/adapters/kalshi';
import { novigAdapter } from '../../src/content/adapters/novig';
import { polymarketUsAdapter } from '../../src/content/adapters/polymarket-us';
import { prophetxAdapter } from '../../src/content/adapters/prophetx';
import type { Engine } from '../../src/content/engine';
import type { Adapter } from '../../src/content/types';
import { assertExpectations, labels, loadFixture, startEngine } from './helpers';

const cases: Array<[string, Adapter]> = [
  ['kalshi', kalshiAdapter],
  ['polymarket-us', polymarketUsAdapter],
  ['prophetx', prophetxAdapter],
  ['novig', novigAdapter],
];

let engine: Engine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
  history.replaceState(null, '', '/');
});

describe.each(cases)('%s fixture', (name, adapter) => {
  it('converts every expected price and leaves every trap unchanged', async () => {
    loadFixture(name);
    ({ engine } = await startEngine(adapter));
    assertExpectations();
    expect(labels().length).toBeGreaterThan(5);
  });

  it('reports matching status counts', async () => {
    loadFixture(name);
    ({ engine } = await startEngine(adapter));
    const status = engine!.getStatus();
    const expected = document.querySelectorAll('[data-expect-odds]').length;
    expect(status.detected).toBe(expected);
    expect(status.shown).toBe(expected);
    expect(status.skipped).toBeGreaterThan(0);
    expect(status.pageExcluded).toBe(false);
  });

  it('produces a diagnostics report without touching the page', async () => {
    loadFixture(name);
    ({ engine } = await startEngine(adapter));
    const before = document.body.innerHTML;
    const report = engine!.getDiagnostics();
    expect(document.body.innerHTML).toBe(before);
    expect(report.entries.some((e) => e.decision.startsWith('convert:'))).toBe(true);
    expect(report.entries.some((e) => e.decision.startsWith('skip:'))).toBe(true);
  });
});

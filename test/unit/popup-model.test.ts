import { describe, expect, it } from 'vitest';
import type { PageStatus } from '../../src/core/messages';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { calculate, describeStatus, displayExample } from '../../src/popup/model';

const M = '\u2212';

const status = (over: Partial<PageStatus> = {}): PageStatus => ({
  platformId: 'kalshi',
  platformName: 'Kalshi',
  verification: 'unverified',
  enabled: true,
  platformEnabled: true,
  pageExcluded: false,
  displayOrder: 'price-first',
  detected: 12,
  shown: 12,
  noRoom: 0,
  skipped: 4,
  skippedByReason: {},
  ...over,
});

describe('calculate', () => {
  it('converts with the chosen rounding and shows the unrounded value', () => {
    expect(calculate('52.38', 'whole')).toMatchObject({ output: `${M}110`, error: false });
    expect(calculate('52.38', 'whole').detail).toContain(`${M}109.996 before rounding`);
    expect(calculate('53', 'tenth').output).toBe(`${M}112.8`);
    expect(calculate('41', 'five').output).toBe('+145');
    expect(calculate('50', 'whole').detail).toContain('+100 before rounding');
  });

  it('explains 0%, 100%, empty, invalid and out-of-range input', () => {
    expect(calculate('0', 'whole')).toMatchObject({ output: 'No odds', none: true });
    expect(calculate('100%', 'whole')).toMatchObject({ output: 'No odds', none: true });
    expect(calculate('', 'whole')).toMatchObject({ error: false, none: false });
    expect(calculate('abc', 'whole')).toMatchObject({ error: true });
    expect(calculate('-3', 'whole').detail).toContain('between 0% and 100%');
    expect(calculate('100.1', 'whole').error).toBe(true);
  });
});

describe('describeStatus', () => {
  it('reports conversions on a supported page', () => {
    const view = describeStatus({ settings: DEFAULT_SETTINGS, url: 'https://kalshi.com/markets/x', status: status() });
    expect(view).toMatchObject({ state: 'active', title: 'Kalshi: 12 prices converted', currentPlatform: 'kalshi' });
    expect(view.detail).toContain('4 other numbers left unchanged');
    expect(view.note).toContain('not yet been verified on the live site');
  });

  it('distinguishes off, platform off, excluded page, nothing detected and prices-only', () => {
    const off = { ...DEFAULT_SETTINGS, enabled: false };
    expect(describeStatus({ settings: off, url: null, status: status() }).title).toBe('Converter is off');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: status({ platformEnabled: false }) }).title).toBe('Kalshi is switched off');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: status({ pageExcluded: true }) }).title).toContain('left unchanged');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: status({ detected: 0, shown: 0 }) }).title).toContain('no prices detected');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: status({ displayOrder: 'price-only', shown: 0 }) }).title).toBe('Kalshi: 12 prices detected');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: status({ detected: 1, shown: 1, skipped: 0 }) }).title).toBe('Kalshi: 1 price converted');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: status({ noRoom: 2 }) }).detail).toContain('2 labels hidden');
  });

  it('asks for a reload on a supported site without a running content script', () => {
    const view = describeStatus({ settings: DEFAULT_SETTINGS, url: 'https://novig.com/nfl', status: null });
    expect(view).toMatchObject({ state: 'warn', currentPlatform: 'novig' });
    expect(view.title).toContain('reload');
  });

  it('explains unsupported and look-alike sites', () => {
    const intl = describeStatus({ settings: DEFAULT_SETTINGS, url: 'https://polymarket.com/event/x', status: null });
    expect(intl.state).toBe('off');
    expect(intl.detail).toContain('international Polymarket');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: 'https://example.com/', status: null }).detail).toContain('Works on');
    expect(describeStatus({ settings: DEFAULT_SETTINGS, url: null, status: null }).title).toBe('No supported page in this tab');
  });
});

describe('displayExample', () => {
  it('previews each display order', () => {
    expect(displayExample('price-first', 'whole')).toEqual({ before: '60% · ', odds: `${M}150`, after: '' });
    expect(displayExample('odds-first', 'whole')).toEqual({ before: '', odds: `${M}150`, after: ' · 60%' });
    expect(displayExample('price-only', 'whole').odds).toBe('');
    expect(displayExample('price-first', 'tenth').odds).toBe(`${M}150.0`);
  });
});

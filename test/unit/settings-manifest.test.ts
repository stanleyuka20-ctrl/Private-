import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORMS, platformForHost, unsupportedLookalikeMessage } from '../../src/core/platforms';
import { DEFAULT_SETTINGS, memorySettingsStore, normalizeSettings } from '../../src/core/settings';

const read = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));

describe('settings', () => {
  it('fills defaults and rejects malformed stored values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({ enabled: 'yes', displayOrder: 'sideways', rounding: 7, theme: 'neon', platforms: { kalshi: false, novig: 'x' } }),
    ).toEqual({ ...DEFAULT_SETTINGS, platforms: { ...DEFAULT_SETTINGS.platforms, kalshi: false } });
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, displayOrder: 'odds-first', rounding: 'five', theme: 'dark' })).toMatchObject({
      displayOrder: 'odds-first',
      rounding: 'five',
      theme: 'dark',
    });
  });

  it('defaults to showing the original price first (e.g. "60% · \u2212150")', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ enabled: true, displayOrder: 'price-first', rounding: 'whole' });
  });

  it('notifies subscribers on save', async () => {
    const store = memorySettingsStore();
    const seen: boolean[] = [];
    store.subscribe((s) => seen.push(s.enabled));
    await store.save({ ...DEFAULT_SETTINGS, enabled: false });
    expect(seen).toEqual([false]);
    expect((await store.load()).enabled).toBe(false);
  });
});

describe('platform registry', () => {
  it('maps hosts to platforms and keeps the international Polymarket site out', () => {
    expect(platformForHost('kalshi.com')?.id).toBe('kalshi');
    expect(platformForHost('POLYMARKET.US')?.id).toBe('polymarketUs');
    expect(platformForHost('www.prophetx.co')?.id).toBe('prophetx');
    expect(platformForHost('novig.com')?.id).toBe('novig');
    expect(platformForHost('app.novig.us')?.id).toBe('novig');
    expect(platformForHost('polymarket.com')).toBeNull();
    expect(platformForHost('docs.polymarket.us')).toBeNull();
    expect(unsupportedLookalikeMessage('polymarket.com')).toContain('international');
  });
});

describe('manifest.json', () => {
  const manifest = read('src/manifest.json');
  const pkg = read('package.json');

  it('is Manifest V3 with a version matching package.json', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe(pkg.version);
  });

  it('requests only storage and activeTab, with no extra host access or background code', () => {
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.background).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
  });

  it('injects one separate integration per platform, on exactly the registered hosts', () => {
    const scripts = manifest.content_scripts as Array<{ matches: string[]; js: string[]; all_frames?: boolean }>;
    expect(scripts).toHaveLength(PLATFORMS.length);
    const files: Record<string, string> = {
      polymarketUs: 'content/polymarket-us.js',
      kalshi: 'content/kalshi.js',
      prophetx: 'content/prophetx.js',
      novig: 'content/novig.js',
    };
    for (const platform of PLATFORMS) {
      const entry = scripts.find((s) => s.js[0] === files[platform.id]);
      expect(entry, platform.id).toBeDefined();
      expect(entry!.matches).toEqual([...platform.matches]);
      expect(entry!.all_frames).toBeUndefined();
      for (const pattern of entry!.matches) {
        expect(pattern.startsWith('https://')).toBe(true);
        expect(pattern).not.toContain('*.');
      }
    }
    const all = scripts.flatMap((s) => s.matches).join(' ');
    expect(all).not.toContain('polymarket.com');
  });
});

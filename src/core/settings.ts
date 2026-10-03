/**
 * User preferences, stored with chrome.storage.local so they persist across
 * browser restarts and never leave the device.
 */
import { ROUNDING_MODES, type RoundingMode } from './odds';
import { PLATFORM_IDS, type PlatformId } from './platforms';

/** American odds first, original price first, or original prices only. */
export type DisplayOrder = 'odds-first' | 'price-first' | 'price-only';
export type ThemePreference = 'auto' | 'light' | 'dark';

export const DISPLAY_ORDERS: readonly DisplayOrder[] = ['odds-first', 'price-first', 'price-only'];
export const THEMES: readonly ThemePreference[] = ['auto', 'light', 'dark'];

export interface Settings {
  readonly enabled: boolean;
  readonly platforms: Readonly<Record<PlatformId, boolean>>;
  readonly displayOrder: DisplayOrder;
  readonly rounding: RoundingMode;
  readonly theme: ThemePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  platforms: { polymarketUs: true, kalshi: true, prophetx: true, novig: true },
  displayOrder: 'price-first',
  rounding: 'whole',
  theme: 'auto',
};

export const SETTINGS_KEY = 'settings';

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Validates stored data, filling in defaults for anything missing or malformed. */
export function normalizeSettings(raw: unknown): Settings {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawPlatforms =
    obj.platforms !== null && typeof obj.platforms === 'object' ? (obj.platforms as Record<string, unknown>) : {};
  const platforms = {} as Record<PlatformId, boolean>;
  for (const id of PLATFORM_IDS) {
    platforms[id] = typeof rawPlatforms[id] === 'boolean' ? (rawPlatforms[id] as boolean) : DEFAULT_SETTINGS.platforms[id];
  }
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_SETTINGS.enabled,
    platforms,
    displayOrder: pick(obj.displayOrder, DISPLAY_ORDERS, DEFAULT_SETTINGS.displayOrder),
    rounding: pick(obj.rounding, ROUNDING_MODES, DEFAULT_SETTINGS.rounding),
    theme: pick(obj.theme, THEMES, DEFAULT_SETTINGS.theme),
  };
}

export function settingsEqual(a: Settings, b: Settings): boolean {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b));
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  /** Calls `listener` whenever the stored settings change; returns an unsubscribe function. */
  subscribe(listener: (settings: Settings) => void): () => void;
}

type StorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

/** chrome.storage-backed store (content scripts and popup). */
export function chromeSettingsStore(
  area: StorageArea = chrome.storage.local,
  areaName: string = 'local',
): SettingsStore {
  return {
    async load() {
      const data = await area.get(SETTINGS_KEY);
      return normalizeSettings((data as Record<string, unknown>)[SETTINGS_KEY]);
    },
    async save(settings) {
      await area.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
    },
    subscribe(listener) {
      const handler = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
        if (name !== areaName || !(SETTINGS_KEY in changes)) return;
        listener(normalizeSettings(changes[SETTINGS_KEY]?.newValue));
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

/** In-memory store for tests. */
export function memorySettingsStore(initial: Settings = DEFAULT_SETTINGS): SettingsStore & { current(): Settings } {
  let value = normalizeSettings(initial);
  const listeners = new Set<(s: Settings) => void>();
  return {
    async load() {
      return value;
    },
    async save(settings) {
      value = normalizeSettings(settings);
      for (const l of listeners) l(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current() {
      return value;
    },
  };
}

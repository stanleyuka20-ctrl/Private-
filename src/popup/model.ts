/**
 * Pure presentation logic for the popup (no DOM, no chrome.* calls), so it can
 * be unit-tested.
 */
import type { PageStatus } from '../core/messages';
import { MINUS, describeNoOdds, formatAmericanOdds, oddsToNumber, toAmericanOdds, type RoundingMode } from '../core/odds';
import { parsePercentInput } from '../core/parse';
import { getPlatform, platformForHost, unsupportedLookalikeMessage, type PlatformId } from '../core/platforms';
import type { DisplayOrder, Settings } from '../core/settings';

export type StatusState = 'active' | 'idle' | 'warn' | 'off';

export interface StatusView {
  readonly state: StatusState;
  readonly title: string;
  readonly detail: string;
  readonly note: string;
  readonly currentPlatform: PlatformId | null;
}

const SUPPORTED_LIST = 'Works on Polymarket US (polymarket.us), Kalshi, ProphetX and Novig.';

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function describeStatus(input: {
  readonly settings: Settings;
  readonly url: string | null;
  readonly status: PageStatus | null;
}): StatusView {
  const { settings, url, status } = input;
  const host = hostOf(url);
  const platform = status ? getPlatform(status.platformId) : host ? platformForHost(host) : null;
  const name = platform?.name ?? '';
  const currentPlatform = platform?.id ?? null;
  const note =
    platform?.verification === 'unverified'
      ? `The ${name} integration was built from ${name}'s public documentation and tested on representative pages; it has not yet been verified on the live site.`
      : '';

  if (!settings.enabled) {
    return {
      state: 'off',
      title: 'Converter is off',
      detail: platform ? `Turn it on to see American odds on ${name}.` : 'Turn it on to see American odds on supported sites.',
      note: '',
      currentPlatform,
    };
  }

  if (status) {
    if (!status.platformEnabled) {
      return { state: 'warn', title: `${name} is switched off`, detail: `Turn ${name} on under Sites.`, note: '', currentPlatform };
    }
    if (status.pageExcluded) {
      return {
        state: 'idle',
        title: `${name}: this page is left unchanged`,
        detail: 'Account, portfolio, wallet and help pages are deliberately not converted.',
        note,
        currentPlatform,
      };
    }
    if (status.detected === 0) {
      return {
        state: 'idle',
        title: `${name}: supported page, no prices detected yet`,
        detail:
          status.platformId === 'kalshi'
            ? 'Prices are detected in cents (62¢) or percent (62%). Payout multipliers such as 1.6x are not converted.'
            : 'Open a market list, event page or order panel. Only prices shown as % or ¢/$ on $1 contracts are converted.',
        note,
        currentPlatform,
      };
    }
    if (status.displayOrder === 'price-only') {
      return {
        state: 'active',
        title: `${name}: ${plural(status.detected, 'price')} detected`,
        detail: 'Showing original prices only. Choose “Odds first” or “Price first” to show conversions.',
        note,
        currentPlatform,
      };
    }
    const extras: string[] = [];
    if (status.noRoom > 0) extras.push(`${plural(status.noRoom, 'label')} hidden where there was no room`);
    if (status.skipped > 0) extras.push(`${plural(status.skipped, 'other number')} left unchanged (fees, volume, changes…)`);
    return {
      state: 'active',
      title: `${name}: ${plural(status.shown, 'price')} converted`,
      detail: extras.join(' · '),
      note,
      currentPlatform,
    };
  }

  if (platform) {
    return {
      state: 'warn',
      title: `${name}: reload this tab to activate`,
      detail: 'The converter starts when a page loads. Pages opened before the extension was installed or updated need a reload.',
      note,
      currentPlatform,
    };
  }
  if (host) {
    const lookalike = unsupportedLookalikeMessage(host);
    return {
      state: 'off',
      title: 'This site isn’t supported',
      detail: lookalike ?? SUPPORTED_LIST,
      note: '',
      currentPlatform: null,
    };
  }
  return { state: 'off', title: 'No supported page in this tab', detail: SUPPORTED_LIST, note: '', currentPlatform: null };
}

export interface CalcView {
  readonly output: string;
  readonly detail: string;
  readonly error: boolean;
  /** True for 0% / 100% (no finite odds). */
  readonly none: boolean;
}

function trimmed(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

export function calculate(input: string, rounding: RoundingMode): CalcView {
  const parsed = parsePercentInput(input);
  if (!parsed.ok) {
    if (parsed.error === 'empty') {
      return { output: '—', detail: 'Enter a percentage between 0 and 100.', error: false, none: false };
    }
    if (parsed.error === 'invalid') {
      return { output: '—', detail: 'That isn’t a number. Try 52.38 or 60%.', error: true, none: false };
    }
    return { output: '—', detail: 'A probability must be between 0% and 100%.', error: true, none: false };
  }
  const odds = toAmericanOdds(parsed.probability);
  if (odds.kind === 'none') {
    return { output: 'No odds', detail: describeNoOdds(odds.reason), error: false, none: true };
  }
  const formatted = formatAmericanOdds(odds, rounding) ?? '';
  const precise = oddsToNumber(odds);
  const preciseText = (precise > 0 ? '+' : MINUS) + trimmed(Math.abs(precise), 3);
  return {
    output: formatted,
    detail: `${parsed.digits}% = ${preciseText} before rounding. Equivalent odds before fees.`,
    error: false,
    none: false,
  };
}

/** Preview of how a 60% price is displayed with the chosen settings. */
export function displayExample(order: DisplayOrder, rounding: RoundingMode): { before: string; odds: string; after: string } {
  const odds = calculate('60', rounding).output;
  if (order === 'odds-first') return { before: '', odds, after: ' · 60%' };
  if (order === 'price-first') return { before: '60% · ', odds, after: '' };
  return { before: '60%', odds: '', after: ' (original prices only)' };
}

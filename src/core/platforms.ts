/**
 * Supported platforms and the exact hosts each integration runs on.
 * manifest.json must match this list (enforced by test/unit/manifest.test.ts).
 */

export type PlatformId = 'polymarketUs' | 'kalshi' | 'prophetx' | 'novig';

export const PLATFORM_IDS: readonly PlatformId[] = ['polymarketUs', 'kalshi', 'prophetx', 'novig'];

export interface PlatformInfo {
  readonly id: PlatformId;
  readonly name: string;
  /** Exact hostnames the integration runs on. */
  readonly hosts: readonly string[];
  /** Content-script match patterns; identical to manifest.json. */
  readonly matches: readonly string[];
  /** Domain shown in the popup. */
  readonly domainLabel: string;
  /**
   * 'unverified' = built from the platform's public documentation and tested
   * on representative fixtures, but not yet checked against the live site.
   */
  readonly verification: 'verified' | 'unverified';
}

export const PLATFORMS: readonly PlatformInfo[] = [
  {
    id: 'polymarketUs',
    name: 'Polymarket US',
    hosts: ['polymarket.us'],
    matches: ['https://polymarket.us/*'],
    domainLabel: 'polymarket.us',
    verification: 'unverified',
  },
  {
    id: 'kalshi',
    name: 'Kalshi',
    hosts: ['kalshi.com'],
    matches: ['https://kalshi.com/*'],
    domainLabel: 'kalshi.com',
    verification: 'unverified',
  },
  {
    id: 'prophetx',
    name: 'ProphetX',
    hosts: ['www.prophetx.co', 'prophetx.co'],
    matches: ['https://www.prophetx.co/*', 'https://prophetx.co/*'],
    domainLabel: 'prophetx.co',
    verification: 'unverified',
  },
  {
    id: 'novig',
    name: 'Novig',
    hosts: ['novig.com', 'app.novig.us'],
    matches: ['https://novig.com/*', 'https://app.novig.us/*'],
    domainLabel: 'novig.com',
    verification: 'unverified',
  },
];

export function getPlatform(id: PlatformId): PlatformInfo {
  const platform = PLATFORMS.find((p) => p.id === id);
  if (!platform) throw new Error(`Unknown platform ${id}`);
  return platform;
}

export function platformForHost(hostname: string): PlatformInfo | null {
  const host = hostname.toLowerCase();
  return PLATFORMS.find((p) => p.hosts.includes(host)) ?? null;
}

/** Sites that look related but are deliberately not supported. */
export function unsupportedLookalikeMessage(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host === 'polymarket.com' || host.endsWith('.polymarket.com')) {
    return 'This is the international Polymarket site (polymarket.com), a separate platform that is not supported. Polymarket US is at polymarket.us.';
  }
  if (host.endsWith('.polymarket.us') && host !== 'polymarket.us') {
    return 'Only the Polymarket US trading site (polymarket.us) is supported, not its other subdomains.';
  }
  if (host.endsWith('.kalshi.com') && host !== 'kalshi.com') {
    return 'Only the main Kalshi site (kalshi.com) is supported, not its other subdomains.';
  }
  return null;
}

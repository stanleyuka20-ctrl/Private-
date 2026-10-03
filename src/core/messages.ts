/** Messages exchanged between the popup and the content scripts. */
import type { DisplayOrder } from './settings';
import type { PlatformId } from './platforms';

export const MSG_GET_STATUS = 'aoc:get-status';
export const MSG_GET_DIAGNOSTICS = 'aoc:get-diagnostics';

export type ExtensionMessage = { readonly type: typeof MSG_GET_STATUS } | { readonly type: typeof MSG_GET_DIAGNOSTICS };

export interface PageStatus {
  readonly platformId: PlatformId;
  readonly platformName: string;
  readonly verification: 'verified' | 'unverified';
  readonly enabled: boolean;
  readonly platformEnabled: boolean;
  /** True on pages the integration deliberately skips (account, portfolio, help…). */
  readonly pageExcluded: boolean;
  readonly displayOrder: DisplayOrder;
  /** Prices recognised and converted (labels may be hidden in "prices only" mode). */
  readonly detected: number;
  /** Labels currently visible. */
  readonly shown: number;
  /** Recognised prices whose label was withheld because it would not fit. */
  readonly noRoom: number;
  /** Price-like numbers seen but deliberately left unchanged. */
  readonly skipped: number;
  readonly skippedByReason: Readonly<Record<string, number>>;
}

export interface DiagnosticEntry {
  readonly text: string;
  readonly token: string;
  readonly decision: string;
  readonly side: string | null;
  readonly outcome: string | null;
  readonly label: string;
  readonly words: readonly string[];
  readonly cellHeader: string | null;
  readonly rowLabel: string | null;
  readonly element: string;
}

export interface DiagnosticsReport {
  readonly extensionVersion: string;
  readonly platformId: PlatformId;
  readonly page: string;
  readonly generatedAt: string;
  readonly pageExcluded: boolean;
  readonly status: PageStatus;
  readonly entries: readonly DiagnosticEntry[];
}

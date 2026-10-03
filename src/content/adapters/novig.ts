/**
 * Novig integration — https://novig.com (formerly app.novig.us)
 *
 * Evidence (public sources, October 2026):
 *  - Novig relaunched as a CFTC-regulated exchange on Aug 4, 2026 and quotes
 *    contracts as probabilities (percentages) instead of American odds; each
 *    outcome pays $1 per contract (e.g. "DET Lions: Yes 65%").
 *  - The desktop web app moved from app.novig.us to novig.com ("continue on
 *    novig.com"); both hosts are matched.
 *  - Trades are "Take" (accept a resting price) or "Make" (post a price);
 *    every market has Yes and No sides that are converted independently.
 *
 * Status: UNVERIFIED against the live site (it could not be loaded from the
 * build environment). Detection relies on visible text and generic structure.
 */
import type { Adapter } from '../types';

export const novigAdapter: Adapter = {
  id: 'novig',
  units: { percent: true, cents: false, dollars: false },
  payoutPerContractUSD: 1,
  excludedPaths: [
    /^\/(blog|landing|about|careers|press|legal|terms|privacy|responsible-gaming|help|faq|support|promotions|promos|refer|referral|account|wallet|portfolio|positions|history|settings|transactions|deposit|withdraw|purchase|redeem|login|sign-?in|sign-?up|register)(\/|$)/i,
  ],
  buttonQuoteKind: 'price',
  unlabeledButtonQuotes: true,
  rowPercentIsEstimate: false,
};

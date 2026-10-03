/**
 * Kalshi integration — https://kalshi.com
 *
 * Evidence (public sources, October 2026):
 *  - Event contracts settle at $1 (Yes or No); prices run 1–99¢ and are read
 *    as probabilities. Kalshi help center: "How are prices determined?".
 *  - After CFTC staff guidance (Aug 7, 2026) Kalshi removed American odds on
 *    Aug 31, 2026; prices can be shown in cents, % or a payout multiplier.
 *    Multipliers ("1.6x") are not prices and are left unchanged.
 *  - Market pages show each outcome's "% chance" next to Yes/No buttons that
 *    carry prices; the order panel has Buy/Sell and Yes/No side buttons that
 *    show the current price (Kalshi Pro help: "The order panel").
 *
 * Status: UNVERIFIED against the live site (it could not be loaded from the
 * build environment). Detection relies on visible text and generic structure
 * (buttons, captions, table headers), not on Kalshi's CSS class names.
 */
import type { Adapter } from '../types';

export const kalshiAdapter: Adapter = {
  id: 'kalshi',
  units: { percent: true, cents: true, dollars: false },
  payoutPerContractUSD: 1,
  excludedPaths: [
    /^\/(account|portfolio|settings|deposit|withdraw|transfer|transfers|history|activity|statements|tax|documents|referral|referrals|rewards|help|docs|blog|legal|privacy|terms|careers|about|learn|news|sign-?in|sign-?up|login|register|onboarding)(\/|$)/i,
    /^\/pro\/help(\/|$)/i,
  ],
  buttonQuoteKind: 'price',
  unlabeledButtonQuotes: true,
  rowPercentIsEstimate: true,
};

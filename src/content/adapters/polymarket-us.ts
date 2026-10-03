/**
 * Polymarket US integration — https://polymarket.us
 *
 * This is the CFTC-regulated US exchange (QCX LLC d/b/a Polymarket US). The
 * international site, polymarket.com, is a separate platform and is NOT
 * matched by this extension.
 *
 * Evidence (public sources, October 2026):
 *  - Each market is a Yes/No contract that settles at $1.00 or $0.00; a price
 *    of 62¢ reads as roughly a 62% chance (docs.polymarket.us, "How Event
 *    Contracts Work", "Events & Markets").
 *  - Prices are quoted in cents by default ("Price" format, e.g. 62¢ or
 *    $0.62) with a percentage display option; some markets trade in 0.5¢
 *    ticks (e.g. 62.5¢) per the Polymarket US changelog.
 *  - Sports game pages list moneyline, spread and total contracts.
 *
 * Status: UNVERIFIED against the live site (it could not be loaded from the
 * build environment). Detection relies on visible text and generic structure.
 */
import type { Adapter } from '../types';

export const polymarketUsAdapter: Adapter = {
  id: 'polymarketUs',
  units: { percent: true, cents: true, dollars: true },
  payoutPerContractUSD: 1,
  excludedPaths: [
    /^\/(portfolio|account|settings|wallet|deposit|withdraw|activity|history|rewards|referral|referrals|leaderboard|profile|legal|terms|privacy|help|faq|learn|docs|blog|careers|about|login|sign-?in|sign-?up|onboarding)(\/|$)/i,
    /^\/@/,
  ],
  buttonQuoteKind: 'price',
  unlabeledButtonQuotes: true,
  rowPercentIsEstimate: true,
};

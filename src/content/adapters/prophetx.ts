/**
 * ProphetX integration — https://www.prophetx.co
 *
 * Evidence (public sources, October 2026):
 *  - ProphetX is a CFTC-regulated, peer-to-peer sports exchange (nationwide
 *    since June 18, 2026), reachable in desktop browsers at www.prophetx.co.
 *  - Contracts are priced between $0.01 and $0.99 and pay $1 if the outcome
 *    happens (reviews quote prices such as "$0.45").
 *  - Following the August 2026 CFTC guidance, American odds were removed and
 *    percentages are shown under spreads, moneylines, totals and props.
 *
 * Status: UNVERIFIED against the live site, and the exact path/subdomain of
 * the web trading app could not be confirmed (www.prophetx.co was the only
 * documented host). Detection relies on visible text and generic structure.
 */
import type { Adapter } from '../types';

export const prophetxAdapter: Adapter = {
  id: 'prophetx',
  units: { percent: true, cents: false, dollars: true },
  payoutPerContractUSD: 1,
  excludedPaths: [
    /^\/(news|blog|press|about|careers|legal|terms|privacy|responsible-gaming|responsible-trading|help|faq|support|promotions|promos|account|wallet|portfolio|my-bets|my-trades|my-positions|history|settings|transactions|deposit|withdraw|referral|refer|affiliates|login|sign-?in|sign-?up|register)(\/|$)/i,
  ],
  buttonQuoteKind: 'price',
  unlabeledButtonQuotes: true,
  rowPercentIsEstimate: false,
};

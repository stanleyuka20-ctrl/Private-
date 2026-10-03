# Compatibility report

_Last updated: October 3, 2026 · extension version 1.0.0_

**Short version:** all four integrations are built and tested against representative pages. **None of them has been verified on the live website yet**, because the four sites could not be reached from the environment where the extension was built. Each one is marked **Unverified** in the popup until that check is done.

| Platform | Pages it runs on | Price formats converted | Status |
|---|---|---|---|
| Polymarket US | `https://polymarket.us/*` | `62%`, `62¢`, `62.5¢`, `$0.62` | Unverified on live site · fixture-tested |
| Kalshi | `https://kalshi.com/*` | `62%`, `62¢`, `99.5¢` | Unverified on live site · fixture-tested |
| ProphetX | `https://www.prophetx.co/*`, `https://prophetx.co/*` | `52%`, `$0.52` | Unverified on live site · fixture-tested; web-app host not confirmed |
| Novig | `https://novig.com/*`, `https://app.novig.us/*` | `65%` | Unverified on live site · fixture-tested |

The international Polymarket site (`polymarket.com`) is a separate platform. The extension does **not** run there; this is tested.

## What "verified" would mean, and why it's missing

Verifying an integration means loading the real site, finding where prices appear in its page structure, and confirming three things against the extension's output: every price is converted, nothing unrelated is converted, and the site still works normally.

The build environment's network policy blocked every request to `polymarket.us`, `kalshi.com`, `prophetx.co` and `novig.com`, including their help centres and documentation sites. Because of that, each integration was built from:

1. Each platform's **published price format** (from its documentation, help centre and recent coverage, listed below).
2. **Generic, structure-based detection** that doesn't depend on any site's CSS class names. It looks at the visible text and the page structure: buttons, captions, table headers and rows.
3. **Representative fixture pages** (`test/fixtures/*.html`) that reproduce the documented formats with common React markup patterns, plus traps that must not be converted.

### How to complete verification (about 10 minutes per site)

1. Install the extension (see [README](../README.md)) and open a market list, an event page and an order panel on the site.
2. Check that each price you expect has a label, and that balances, volume, fees, price changes, scores, spreads, totals and order-entry fields have none.
3. If anything is wrong or missing, click **Copy page diagnostics** in the popup on that page and send the report with a note about what you expected. The report lists each price-like number on the page, how it was handled and why, plus the surrounding text and element path. It contains the page's visible text near prices, so review it before sharing. It's built only when you click, and it goes to your clipboard only. Nothing is sent anywhere.
4. A saved copy of the page also works: right-click → **Save as… → Webpage, Complete**, or copy the `outerHTML` of a market card from DevTools.

With that, adjusting an adapter is usually a small change to its configuration or vocabulary in `src/content/adapters/<platform>.ts` or `src/content/detect.ts`.

---

## Polymarket US

- **Hosts:** `https://polymarket.us/*` only. Subdomains such as `docs.polymarket.us` are not matched.
- **Evidence:**
  - Polymarket US is the CFTC-regulated US exchange (QCX LLC d/b/a Polymarket US), separate from the international site. US trading moved to polymarket.us. Sources: [polymarket.us](https://polymarket.us/), [Polymarket US docs: What is Polymarket US?](https://docs.polymarket.us/getting-started/what-is-polymarket-us), [startpolymarket.com: Polymarket in the US](https://startpolymarket.com/countries/united-states/).
  - Every market is a Yes/No contract that settles at **$1.00 or $0.00**, and a 62¢ price reads as roughly a 62% chance. Sources: [How Event Contracts Work](https://docs.polymarket.us/learn/home), [Events & Markets](https://docs.polymarket.us/concepts/events-and-markets).
  - Prices are shown in cents by default, with a percentage option. Since June 2026, some markets trade in **0.5¢ ticks**. Source: [Polymarket US changelog](https://docs.polymarket.us/changelog).
  - Sports pages list moneyline, spread and total contracts. Source: [polymarket.us/sports](https://polymarket.us/sports).
- **Converted:** outcome buttons (`Yes 62¢`, `Buy Up 54¢`, `OKC 62.5¢`, `PHI -1.5 52¢`, `O 47.5 51¢`), price-only moneyline buttons in a grid (`55¢`), `$0.60` and `52.38%` displays, "`52%` chance" gauges, outcome chance percentages beside Yes/No buttons, and the order panel's Yes/No buttons (labelled **sell** when the Sell tab is selected).
- **Left unchanged:** `<1%` and `>99%`, portfolio and P/L changes, volume, sizing presets (`25%`, `50%`, `Max`), slippage options, average price, cost, "To win", existing American odds (`PHI −122`, `55¢ (−122)`), and threshold names such as "Above 3.0%".
- **Excluded pages:** `/portfolio`, `/account`, `/settings`, `/wallet`, `/deposit`, `/withdraw`, `/activity`, `/history`, `/rewards`, `/referral(s)`, `/leaderboard`, `/profile`, `/@user`, help, legal and login pages.

## Kalshi

- **Hosts:** `https://kalshi.com/*` only. Kalshi Pro pages under `kalshi.com/pro` are included; `/pro/help` is excluded.
- **Evidence:**
  - Contracts settle at $1 (Yes or No). Prices run 1–99¢ and are read as probabilities. Source: [Kalshi help: How are prices determined?](https://help.kalshi.com/markets/markets-101/how-are-prices-determined).
  - CFTC staff told regulated exchanges on **Aug 7, 2026** not to show American-style odds. Kalshi removed them on **Aug 31, 2026**, and prices can now be shown in **cents, %, or a multiplier**. Sources: [Bloomberg](https://www.bloomberg.com/news/articles/2026-08-07/cftc-warns-prediction-markets-against-american-style-casino-odds), [Steve Ruddock: Kalshi Ditches American Odds](https://straighttothepoint.substack.com/p/bye-bye-miss-american-odds), [PokerStrategy](https://www.pokerstrategy.com/kalshi-no-longer-displaying-american-style-odds/).
  - The order panel has Buy/Sell and Yes/No side controls that show the current price. Sources: [Kalshi Pro help: The order panel](https://kalshi.com/pro/help/the-order-panel), [The orderbook](https://help.kalshi.com/markets/markets-101/the-orderbook). Kalshi Pro launched in July 2026 with a screener ranked by price, spread, depth and volume. Source: [DeFi Rate](https://defirate.com/news/kalshi-launches-pro-trading-terminal-prediction-markets-perps/).
- **Converted:** "`62%` chance", outcome chance percentages beside Yes/No buttons, `Yes 62¢` / `No 39¢` buttons (labelled **buy** or **sell** when a Buy/Sell toggle is selected), price-only team buttons on game cards, prices split across elements (`<span>68</span><span>¢</span>`, digit-by-digit tickers), and Kalshi Pro–style tables (Bid → sell, Ask → buy, Last → last traded). `Yes 100¢` and `No 0¢` get an explicit **n/a** label.
- **Left unchanged:** payout multipliers (`1.6x`), the Spread, volume and change columns, order-book price ladders, average price, fees, balances, P/L, `<1%`, threshold names ("Above 3.0%", "2.8% or higher", "3.5%+"), fill prices ("10 Yes @ 62¢"), existing American odds, and prose.
- **Excluded pages:** `/account`, `/portfolio`, `/settings`, deposit, withdraw and transfer pages, `/history`, `/activity`, statements and tax pages, rewards and referrals, help, docs, blog, legal, `/learn`, `/news`, and login pages.
- **Tip:** if Kalshi is set to show multipliers, no prices are detected. Switch its price display to cents or %.

## ProphetX

- **Hosts:** `https://www.prophetx.co/*` and `https://prophetx.co/*`.
- **Evidence:**
  - ProphetX is a CFTC-regulated, peer-to-peer sports exchange, live nationwide since **June 18, 2026**, and reachable in desktop browsers at www.prophetx.co. Sources: [PR Newswire](https://www.prnewswire.com/news-releases/prophetx-launches-nationwide-302804384.html), [BettingUSA review](https://www.bettingusa.com/prediction-markets/reviews/prophetx/).
  - Contracts are priced **$0.01–$0.99 and pay $1** if the outcome happens. Sources: [Lines.com review](https://www.lines.com/prediction-market/prophetx-review), [SI](https://www.si.com/prediction-markets/promos/prophetx-promo-code).
  - After the CFTC guidance, ProphetX removed American odds and shows **percentages** under spreads, moneylines, totals and props. Source: [Gambling Insider](https://www.gamblinginsider.com/news/195019/prediction-markets-odds-format).
- **Converted:** spread, moneyline and total buttons (`-3.5 52%`, `65%`, `O 44.5 51%`, `+3.5 49%`), prop buttons (`Yes 54%`), and the ticket's `Price 52%` and `Contract price $0.52`.
- **Left unchanged:** account P/L, "Matched $1.2M", commission, stake sizing presets, line-move arrows, legacy American-odds displays (`-150`, `52% (−108)`), order-book tables, and prose.
- **Open question:** public sources name only www.prophetx.co. If the trading app runs on a different subdomain (for example `app.` or `exchange.`), that host must be added to `src/manifest.json` and `src/core/platforms.ts` before the integration can run there. This is the first thing to check.
- **Excluded pages:** `/news`, `/blog`, `/press`, about, careers, legal, help, FAQ, support, promotions, account, wallet, portfolio, my-bets, history, settings, transactions, deposit, withdraw, referral and login pages.

## Novig

- **Hosts:** `https://novig.com/*` (current) and `https://app.novig.us/*` (former web app, which now points users to novig.com).
- **Evidence:**
  - Novig relaunched as a CFTC-regulated exchange on **Aug 4, 2026**. It quotes contracts as probabilities (percentages) instead of American odds, and each outcome pays **$1 per contract**, for example "DET Lions: Yes 65%". Sources: [Casino.org](https://www.casino.org/news/novig-eliminates-american-odds-in-effort-to-lift-financial-market-appeal/), [OddsShopper](https://www.oddsshopper.com/articles/prediction-markets/novig-odds-format-change).
  - The desktop app at app.novig.us shows "continue on novig.com". Sources: [app.novig.us](https://app.novig.us/), [Novig on X](https://x.com/Novig/status/1963641385807921336).
  - Trades are **Take** (accept a resting price) or **Make** (post your own). Every market has Yes and No sides. Source: [OddsShopper: How does Novig work?](https://www.oddsshopper.com/articles/prediction-markets/how-does-novig-work).
- **Converted:** Yes/No buttons for each outcome (moneyline, spread, total), the ticket's `Price 65%`, and the `Take 65%` button. Yes and No are converted independently, and No is never derived from Yes.
- **Left unchanged:** promotions ("25% off fees", "Boost 10%", APY), win-rate stats, price-change arrows, order-book rows, the Make price input, and wallet balances.
- **Excluded pages:** `/blog`, `/landing`, about, careers, press, legal, help, FAQ, support, promotions, referral, account, wallet, portfolio, positions, history, settings, transactions, deposit, withdraw, purchase, redeem and login pages.

---

## Limitations that apply to all four

- **Unverified page structure.** Detection is deliberately conservative: a price is converted only with positive evidence, such as an outcome button, a caption, or a known table column. On a real site this may leave some prices unconverted until the integration is tuned with diagnostics.
- **Bid/ask labelling** comes from what the page itself shows (Buy/Sell words, a selected Buy/Sell toggle, Bid/Ask columns). When a button shows a price without saying which, the label calls it the "price shown for Yes" (or the outcome) rather than guessing.
- **Not converted:** payout multipliers, decimal or fractional odds, bare numbers (`0.62`), `<1%` / `>99%`, prices drawn on `<canvas>` or SVG charts, prices inside iframes or closed shadow DOM, and order-book ladders without Bid/Ask headers.
- **Two prices in one element** (for example `52% ($0.52)`) are left unchanged, because a single label can't be attached to both unambiguously.
- **Very tight controls:** if a label would spill outside a fixed-size button, it's withheld rather than allowed to overlap. The popup counts these.
- **Fees:** conversions are equivalent odds **before fees**. Rounded source prices make a conversion approximate; the tooltip shows the range when that matters.

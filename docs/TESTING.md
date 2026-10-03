# Test report

_Extension version 1.0.0 · October 3, 2026_

## Summary

| Where | Tested? | Result |
|---|---|---|
| Live Polymarket US, Kalshi, ProphetX and Novig pages | **No.** The build environment's network policy blocked all four sites, plus their help centres and documentation hosts. | Not available. See the manual checklist below. |
| Conversion math and price parsing | Yes, unit tests | 44 / 44 pass |
| Popup logic, settings and manifest | Yes, unit tests | 14 / 14 pass |
| Detection on representative fixture pages (jsdom) | Yes | 12 / 12 pass |
| Live-update and page-safety behaviour (jsdom) | Yes | 18 / 18 pass |
| The built extension in real Chromium 141, fixtures served under the real hostnames | Yes | 17 / 17 pass |

**Nothing in this report was observed on a live platform page.** Every result comes from the conversion code, or from representative fixtures that reproduce each platform's *documented* price formats. No claim is made that any of the four integrations works on the live sites until that's checked.

## 1. Unit tests (`test/unit`, Vitest)

- **`odds.test.ts`** (29 tests)
  - Covers every example you specified: 10% → +900, 20% → +400, 25% → +300, 40% → +150, 50% → +100, 52.38% → −110, 60% → −150, 75% → −300, 80% → −400, 90% → −900.
  - Checks both formulas, the p / (1 − p) symmetry, and that the magnitude never falls below 100 across 0.1–99.9%.
  - Checks exact decimal handling. 52.38% stays exact (5238/10000), and `$0.57` equals 57% even though 0.57 × 100 ≠ 57 in floating point.
  - Checks sub-cent prices (62.5¢), and that ties are rounded half away from zero (32% = +212.5 exactly → +213).
  - Checks all three rounding modes, ±100 next to even money, 0% / 100% returning "no finite odds", rejection of malformed or out-of-range input, and the rounding-range tooltip values.
- **`parse.test.ts`** (15 tests) checks how the page text is read:
  - Percentages, cents and `$0.xx` prices are recognised. `$1`, `$12.40`, `$1,234.56`, `$0.5M` and bare numbers are rejected.
  - Out-of-range values are flagged, and digits that are part of a larger number are ignored.
  - Signed changes (`+5%`, `▲ 4%`, `(+5.2%)`) and qualifiers (`<1%`, `≥ 99%`) are flagged.
  - Spreads aren't mistaken for signs. Existing American odds are detected, while spreads, totals, scores and money amounts are not.
  - The calculator accepts 52.38, `52.38%` and `52,38`, and gives clear errors.
- **`popup-model.test.ts`** (7 tests) covers the calculator output and every status message: active, off, platform off, excluded page, nothing detected, prices-only, reload needed, unsupported site, and international Polymarket.
- **`settings-manifest.test.ts`** (7 tests) covers:
  - Settings validation and defaults.
  - The platform host registry, including that polymarket.com is excluded.
  - The manifest: it's MV3, requests only `storage` and `activeTab`, has no host permissions, background page or web-accessible resources, has one content script per platform, and its host list exactly matches the registry.

## 2. Fixture tests in jsdom (`test/dom`)

The fixtures (`test/fixtures/*.html`) are representative pages written for this project. They are **not** copies of the real sites. Each element that should get a label is annotated with the expected odds, quote kind and side. Each element that must stay unchanged is annotated as a trap. A test fails on any missing, wrong, duplicate or unexpected label.

| Fixture | Expected conversions | Traps that must stay unchanged |
|---|---:|---:|
| `kalshi.html` | 35 | 25 |
| `polymarket-us.html` | 22 | 14 |
| `prophetx.html` | 10 | 12 |
| `novig.html` | 10 | 7 |

The traps cover:
- account balances and P/L
- volume
- `▲ 4%` changes
- fees and commission
- average price, cost, "To win"
- sizing presets and slippage
- order-book ladders and the Spread column
- scores and records
- multipliers
- existing American odds
- prose
- `<1%`
- threshold names ("Above 3.0%", "2.8% or higher", "3.5%+")
- fill prices ("10 Yes @ 62¢")
- promotions and APY
- the Make price input

**`engine.test.ts`** (18 tests) covers how labels behave over time and on the page:
- Price text changed in place, and a framework-style re-render that also wipes the label.
- A price that disappears, or becomes ambiguous.
- A reused, virtualised row that now shows a different outcome and side.
- Removed rows.
- Infinite scroll, where only the new rows are examined: exactly 40 evaluations per 40 new prices, one full scan in total.
- No observer loop and no duplicates across repeated flushes or a second engine instance.
- A label the page keeps deleting is re-inserted, then given up on.
- SPA navigation into and out of excluded pages.
- The master and per-platform switches.
- All three display orders and all three rounding modes.
- Form fields untouched, clicks on a label reaching the button, label text kept out of the page's own text, and clean-up when the extension is updated or removed.

## 3. Real-browser tests (`test/e2e`, Playwright + Chromium 141)

These load the **built, unpacked extension** from `dist/` into Chromium. The fixtures are served at the platforms' real URLs (for example `https://kalshi.com/markets/...`) by intercepting requests inside the browser, so nothing leaves the machine. This exercises the real manifest host matching, content-script injection, `chrome.storage`, messaging, layout and the popup.

- All four fixtures, plus Novig's legacy host, produce exactly the expected labels with real layout (5 tests).
- **No labels on `polymarket.com`** (the international site).
- Live price changes, a re-render that wipes the label, and **zero label insertions or removals over 1.2 s once stable** (no loops).
- 60 rows added by infinite scroll get exactly one label each. A reused row follows its new outcome and side.
- SPA navigation with `history.pushState` to `/portfolio` removes all labels. Content rendered there stays unconverted. Navigating back restores the labels, as does the browser Back button.
- Clicking on the label still triggers the button's own click handler. Inputs keep their values and accept typing.
- A label that would overflow a fixed-width button is withheld, and every shown label lies inside its button's box.
- **Scale:** 2,000 new prices were labelled in about 450–530 ms, and a single live price change showed up in about 210–290 ms. That time includes the 50 ms batching delay and test polling.
- **Popup:**
  - Status text, and the master and Kalshi switches turning labels off and on live.
  - The three display orders, and rounding (−163 / −163.2 / −165).
  - Tooltip wording: "Equivalent odds before fees", "not a price you can trade at", "Actual execution prices may differ".
  - The calculator gives all ten required examples, with explanations for 0% and 100% and errors for invalid input.
  - **Settings persist after the browser restarts**, using the same profile with the browser closed and relaunched.
  - Keyboard: Tab reaches every control, and Space toggles the switches.
  - Light and dark themes, and the "No supported page" state.

Screenshots from these runs are in [`docs/images`](images/).

## How to run the tests

```bash
npm install
npm run typecheck
npm test              # unit + jsdom (fast)
npm run test:e2e      # builds dist/ and runs the Chromium tests (needs: npx playwright install chromium)
npm run verify        # all of the above, then packages release/
```

## Manual checklist for live pages (to complete verification)

Do this on each platform after installing:

1. **Market list or home page.** Each outcome's chance or price shows a small label such as `62% · −163`. Volume, price changes and balances have none.
2. **Event or game page.** Yes and No (or team, spread and total) buttons each have their own label, and the No price is not derived from Yes. On sports pages, spread lines (−3.5) and totals (O 47.5) are not converted; only their prices are.
3. **Order panel.** The side buttons are labelled, and labelled **sell** when the Sell tab is active, where the site shows such a tab. Amount and limit fields, fees, average price and payout are untouched. Placing or cancelling an order works exactly as before.
4. **Hover a label.** The tooltip says "Equivalent odds before fees" and describes the source price.
5. **Navigate** between markets without reloading. Labels follow the new prices. Visit Portfolio or Account: no labels.
6. **Popup.** It shows the page as supported with a count. Switch the converter off: labels vanish. Switch it on: they return.
7. If something is wrong, use **Copy page diagnostics** in the popup and share the report. It contains the page's visible text near prices, so review it first.

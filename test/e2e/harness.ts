/**
 * End-to-end harness: launches Chromium with the built, unpacked extension
 * (dist/) and serves the representative fixtures under the platforms' real
 * hostnames via request interception, so manifest matching, content-script
 * injection, storage and the popup run exactly as they would for a user.
 * No request leaves the machine.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const DIST = resolve(process.cwd(), 'dist');

/** Chrome derives an unpacked extension's ID from its absolute path. */
export const EXTENSION_ID = [...createHash('sha256').update(DIST).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
  .join('');

export const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup/popup.html`;

const FIXTURE_FOR_HOST: Record<string, string> = {
  'kalshi.com': 'kalshi',
  'polymarket.us': 'polymarket-us',
  'polymarket.com': 'polymarket-us', // the international site must NOT be converted
  'www.prophetx.co': 'prophetx',
  'novig.com': 'novig',
  'app.novig.us': 'novig',
};

export function newProfileDir(): string {
  return mkdtempSync(join(tmpdir(), 'aoc-e2e-'));
}

export async function launch(userDataDir: string = newProfileDir(), colorScheme: 'light' | 'dark' = 'light'): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    colorScheme,
    viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  await context.route(/^https:\/\/[^/]+\//, async (route) => {
    const url = new URL(route.request().url());
    const fixture = FIXTURE_FOR_HOST[url.hostname];
    if (!fixture || route.request().resourceType() !== 'document') {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    const body = readFileSync(resolve(process.cwd(), 'test/fixtures', `${fixture}.html`), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  return context;
}

export async function waitForLabels(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => document.querySelectorAll('aoc-odds-label').length === n, count, { timeout: 10_000 });
}

export interface ExpectationReport {
  readonly failures: string[];
  readonly labels: number;
  readonly expected: number;
}

/** Same rules as the jsdom suite, evaluated in the real browser (real layout). */
export function checkExpectations(page: Page): Promise<ExpectationReport> {
  return page.evaluate(() => {
    const failures: string[] = [];
    const norm = (s: string | null) => (s ?? '').replace('\u2212', '-');
    const labels = Array.from(document.querySelectorAll('aoc-odds-label'));
    const expected = Array.from(document.querySelectorAll('[data-expect-odds]'));
    for (const el of expected) {
      const desc = el.outerHTML.slice(0, 140);
      const inside = labels.filter((l) => el.contains(l));
      if (inside.length !== 1) {
        failures.push(`${inside.length} labels in ${desc}`);
        continue;
      }
      const label = inside[0]!;
      if (norm(label.getAttribute('data-aoc-odds')) !== el.getAttribute('data-expect-odds')) {
        failures.push(`odds ${label.getAttribute('data-aoc-odds')} in ${desc}`);
      }
      const kind = el.getAttribute('data-expect-kind');
      if (kind && label.getAttribute('data-aoc-kind') !== kind) failures.push(`kind ${label.getAttribute('data-aoc-kind')} in ${desc}`);
      const side = el.getAttribute('data-expect-side');
      if (side && label.getAttribute('data-aoc-side') !== side) failures.push(`side ${label.getAttribute('data-aoc-side')} in ${desc}`);
    }
    for (const el of Array.from(document.querySelectorAll('[data-expect-none]'))) {
      if (labels.some((l) => el.contains(l))) failures.push(`unexpected label in ${el.outerHTML.slice(0, 140)}`);
    }
    for (const label of labels) {
      if (!expected.some((el) => el.contains(label))) {
        failures.push(`stray label ${label.getAttribute('data-aoc-source')} in ${label.parentElement?.outerHTML.slice(0, 140)}`);
      }
    }
    return { failures, labels: labels.length, expected: expected.length };
  });
}

/** Opens the popup as a page bound to the tab that runs the given platform's content script. */
export async function openPopupFor(context: BrowserContext, platformId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(POPUP_URL);
  const tabId = await popup.evaluate(async (id) => {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id === undefined) continue;
      try {
        const status = (await chrome.tabs.sendMessage(tab.id, { type: 'aoc:get-status' })) as { platformId?: string } | undefined;
        if (status?.platformId === id) return tab.id;
      } catch {
        // no content script in this tab
      }
    }
    return null;
  }, platformId);
  if (tabId === null) throw new Error(`No tab running the ${platformId} integration`);
  await popup.goto(`${POPUP_URL}?tabId=${tabId}`);
  return popup;
}

/** Counts label insertions/removals seen from the page's own world over `ms`. */
export function countLabelMutations(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((done) => {
        let n = 0;
        const observer = new MutationObserver((records) => {
          for (const r of records) {
            for (const node of [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)]) {
              if (node.nodeName === 'AOC-ODDS-LABEL') n++;
            }
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          done(n);
        }, duration);
      }),
    ms,
  );
}

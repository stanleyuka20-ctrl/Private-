import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { checkExpectations, countLabelMutations, launch, waitForLabels } from './harness';

let context: BrowserContext;

test.beforeAll(async () => {
  context = await launch();
});

test.afterAll(async () => {
  await context.close();
});

async function open(url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

const SITES: Array<[string, string]> = [
  ['Kalshi', 'https://kalshi.com/markets/kxfeddecision/fed-decision'],
  ['Polymarket US', 'https://polymarket.us/event/fed-decision-in-december'],
  ['ProphetX', 'https://www.prophetx.co/event/123'],
  ['Novig', 'https://novig.com/nfl/det-car'],
  ['Novig (legacy host)', 'https://app.novig.us/nfl/det-car'],
];

for (const [name, url] of SITES) {
  test(`${name}: converts every expected price and nothing else (real layout)`, async () => {
    const page = await open(url);
    const expected = await page.locator('[data-expect-odds]').count();
    await waitForLabels(page, expected);
    const report = await checkExpectations(page);
    expect(report.failures).toEqual([]);
    expect(report.labels).toBe(expected);
    await page.close();
  });
}

test('does not run on the international Polymarket site', async () => {
  const page = await open('https://polymarket.com/event/fed-decision-in-december');
  await page.waitForTimeout(1500);
  expect(await page.locator('aoc-odds-label').count()).toBe(0);
  await page.close();
});

test('updates labels live and never loops on its own changes', async () => {
  const page = await open('https://kalshi.com/markets/live');
  await waitForLabels(page, await page.locator('[data-expect-odds]').count());
  const button = page.locator('#row-hassett button.yes');
  for (const cents of [70, 71, 52, 48, 90]) {
    await button.evaluate((el, c) => {
      (Array.from(el.childNodes).find((n) => n.nodeType === 3) as Text).data = `Yes ${c}¢`;
    }, cents);
  }
  await expect(button.locator('aoc-odds-label')).toHaveAttribute('data-aoc-odds', '\u2212900');
  await expect(button.locator('aoc-odds-label')).toHaveCount(1);
  // Framework-style re-render that wipes the label with the text.
  await page.locator('#split-btn').evaluate((el) => {
    el.innerHTML = 'Yes <span><span>20</span><span class="unit">¢</span></span>';
  });
  await expect(page.locator('#split-btn aoc-odds-label')).toHaveAttribute('data-aoc-odds', '+400');
  // Once stable, the extension makes no further changes.
  expect(await countLabelMutations(page, 1200)).toBe(0);
  await page.close();
});

test('handles infinite scroll and reused rows without duplicates', async () => {
  const page = await open('https://kalshi.com/markets/scroll');
  const initial = await page.locator('[data-expect-odds]').count();
  await waitForLabels(page, initial);
  await page.evaluate(() => {
    const list = document.getElementById('outcome-list')!;
    for (let i = 0; i < 60; i++) {
      list.insertAdjacentHTML(
        'beforeend',
        `<div class="row"><span class="name">Extra ${i}</span><button class="yes">Yes ${i + 20}¢</button><button class="no">No ${80 - i}¢</button></div>`,
      );
    }
  });
  await waitForLabels(page, initial + 120);
  const perButton = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#outcome-list button')).map((b) => b.querySelectorAll('aoc-odds-label').length),
  );
  expect(perButton.every((n) => n === 1)).toBe(true);
  // Reuse a row for a different outcome and side: the label follows the new content.
  await page.evaluate(() => {
    const row = document.getElementById('row-warsh')!;
    row.querySelector('.name')!.textContent = 'Christopher Waller';
    const yes = row.querySelector('button.yes')!;
    (Array.from(yes.childNodes).find((n) => n.nodeType === 3) as Text).data = 'No 25¢';
  });
  const reused = page.locator('#row-warsh button.yes aoc-odds-label');
  await expect(reused).toHaveAttribute('data-aoc-side', 'no');
  await expect(reused).toHaveAttribute('data-aoc-odds', '+300');
  await page.close();
});

test('follows navigation without page reloads', async () => {
  const page = await open('https://kalshi.com/markets/nav');
  const initial = await page.locator('[data-expect-odds]').count();
  await waitForLabels(page, initial);
  await page.evaluate(() => history.pushState({}, '', '/portfolio'));
  await waitForLabels(page, 0);
  // Content rendered while on an excluded page stays unconverted.
  await page.evaluate(() =>
    document.body.insertAdjacentHTML('beforeend', '<div class="row"><span class="name">Position</span><button>Yes 62¢</button></div>'),
  );
  await page.waitForTimeout(400);
  expect(await page.locator('aoc-odds-label').count()).toBe(0);
  await page.evaluate(() => history.pushState({}, '', '/markets/back'));
  await waitForLabels(page, initial + 1);
  await page.goBack();
  await waitForLabels(page, 0);
  await page.close();
});

test('keeps clicks, typing and order entry working', async () => {
  const page = await open('https://kalshi.com/markets/clicks');
  await waitForLabels(page, await page.locator('[data-expect-odds]').count());
  await page.evaluate(() => {
    (window as unknown as { clicks: number }).clicks = 0;
    document.querySelector('.order-panel .yes')!.addEventListener('click', () => {
      (window as unknown as { clicks: number }).clicks++;
    });
  });
  // Click exactly on the injected label inside the button.
  await page.locator('.order-panel .yes aoc-odds-label').click();
  await page.locator('.order-panel .yes').click();
  expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(2);
  const amount = page.locator('#amount');
  await expect(amount).toHaveValue('$25');
  await amount.fill('$40');
  await expect(amount).toHaveValue('$40');
  await page.locator('#limit').fill('61');
  await expect(page.locator('#limit')).toHaveValue('61');
  // The label does not change the button's accessible text in a way that breaks it.
  await expect(page.locator('.order-panel .yes')).toContainText('Yes');
  await page.close();
});

test('withholds a label that would spill outside a tight control', async () => {
  const page = await open('https://kalshi.com/markets/tight');
  await waitForLabels(page, await page.locator('[data-expect-odds]').count());
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="row"><span class="name">Tight</span>
         <button id="tight" style="width:48px;overflow:hidden;white-space:nowrap;padding:2px 4px">62¢</button>
         <button id="roomy">63¢</button></div>`,
    ),
  );
  await expect(page.locator('#roomy aoc-odds-label')).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#tight aoc-odds-label')).toHaveCount(0);
  // Every visible label sits inside its control's box.
  const outside = await page.evaluate(() =>
    Array.from(document.querySelectorAll('aoc-odds-label'))
      .map((label) => {
        const box = label.closest('button');
        if (!box) return null;
        const a = label.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1 ? null : box.outerHTML;
      })
      .filter(Boolean),
  );
  expect(outside).toEqual([]);
  await page.close();
});

test('stays fast on large pages: 2,000 prices, then one live update', async () => {
  const page = await open('https://kalshi.com/markets/large');
  const initial = await page.locator('[data-expect-odds]').count();
  await waitForLabels(page, initial);
  const started = Date.now();
  await page.evaluate(() => {
    const list = document.getElementById('outcome-list')!;
    const html: string[] = [];
    for (let i = 0; i < 1000; i++) {
      html.push(
        `<div class="row"><span class="name">Outcome ${i}</span><button class="yes">Yes ${(i % 98) + 1}¢</button><button class="no">No ${99 - (i % 98)}¢</button></div>`,
      );
    }
    list.insertAdjacentHTML('beforeend', html.join(''));
  });
  await waitForLabels(page, initial + 2000);
  const bulkMs = Date.now() - started;
  expect(bulkMs).toBeLessThan(5000);

  const updateStarted = Date.now();
  await page.evaluate(() => {
    const yes = document.querySelector('#outcome-list .row:last-child button.yes')!;
    (Array.from(yes.childNodes).find((n) => n.nodeType === 3) as Text).data = 'Yes 75¢';
  });
  await expect(page.locator('#outcome-list .row:last-child button.yes aoc-odds-label')).toHaveAttribute('data-aoc-odds', '\u2212300');
  const updateMs = Date.now() - updateStarted;
  expect(updateMs).toBeLessThan(1000);
  console.log(`2,000 new prices labelled in ${bulkMs} ms; single update reflected in ${updateMs} ms`);
  await page.close();
});

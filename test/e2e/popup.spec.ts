import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { POPUP_URL, launch, newProfileDir, openPopupFor, waitForLabels } from './harness';

const SCREENSHOTS = 'docs/images';

async function openFixture(context: Awaited<ReturnType<typeof launch>>, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await waitForLabels(page, await page.locator('[data-expect-odds]').count());
  return page;
}

test('popup shows page status and controls the page live', async () => {
  const context = await launch();
  const page = await openFixture(context, 'https://kalshi.com/markets/popup');
  const total = await page.locator('[data-expect-odds]').count();
  const popup = await openPopupFor(context, 'kalshi');

  await expect(popup.locator('#status-title')).toHaveText(`Kalshi: ${total} prices converted`);
  await expect(popup.locator('#status-note')).toContainText('not yet been verified on the live site');
  await expect(popup.locator('.site.current')).toHaveAttribute('data-platform', 'kalshi');

  // Master switch.
  await popup.getByRole('switch', { name: 'Converter on' }).uncheck();
  await waitForLabels(page, 0);
  await expect(popup.locator('#status-title')).toHaveText('Converter is off');
  await popup.getByRole('switch', { name: 'Converter on' }).check();
  await waitForLabels(page, total);

  // Per-platform switch.
  await popup.getByRole('switch', { name: 'Convert prices on Kalshi' }).uncheck();
  await waitForLabels(page, 0);
  await expect(popup.locator('#status-title')).toHaveText('Kalshi is switched off');
  await popup.getByRole('switch', { name: 'Convert prices on Kalshi' }).check();
  await waitForLabels(page, total);

  // Display order.
  const yes = page.locator('.order-panel .yes span').nth(1);
  await popup.getByRole('radio', { name: 'Odds first' }).check();
  await expect.poll(() => yes.evaluate((el) => el.firstChild?.nodeName)).toBe('AOC-ODDS-LABEL');
  await popup.getByRole('radio', { name: 'Prices only' }).check();
  await waitForLabels(page, 0);
  await expect(popup.locator('#status-title')).toHaveText(`Kalshi: ${total} prices detected`);
  await popup.getByRole('radio', { name: 'Price first' }).check();
  await waitForLabels(page, total);
  await expect.poll(() => yes.evaluate((el) => el.lastChild?.nodeName)).toBe('AOC-ODDS-LABEL');

  // Rounding.
  const fed = page.locator('#fed-card .chance aoc-odds-label');
  await expect(fed).toHaveAttribute('data-aoc-odds', '\u2212163');
  await popup.getByLabel('Rounding').selectOption('tenth');
  await expect(fed).toHaveAttribute('data-aoc-odds', '\u2212163.2');
  await popup.getByLabel('Rounding').selectOption('five');
  await expect(fed).toHaveAttribute('data-aoc-odds', '\u2212165');
  await popup.getByLabel('Rounding').selectOption('whole');

  // Tooltip wording.
  const title = await fed.getAttribute('title');
  expect(title).toContain('Equivalent odds before fees: \u2212163');
  expect(title).toContain('not a price you can trade at');
  expect(title).toContain('Actual execution prices may differ');
  await context.close();
});

test('calculator converts, rounds and explains invalid input', async () => {
  const context = await launch();
  const popup = await context.newPage();
  await popup.goto(POPUP_URL);
  const input = popup.getByLabel('Probability');
  const output = popup.locator('#calc-output');
  const cases: Array<[string, string]> = [
    ['10', '+900'], ['20', '+400'], ['25', '+300'], ['40', '+150'], ['50', '+100'],
    ['52.38', '\u2212110'], ['60', '\u2212150'], ['75', '\u2212300'], ['80', '\u2212400'], ['90', '\u2212900'],
  ];
  for (const [value, odds] of cases) {
    await input.fill(value);
    await expect(output).toHaveText(odds);
  }
  await input.fill('52.38%');
  await expect(popup.locator('#calc-detail')).toContainText('\u2212109.996 before rounding');
  await input.fill('0');
  await expect(output).toHaveText('No odds');
  await input.fill('100');
  await expect(output).toHaveText('No odds');
  await input.fill('abc');
  await expect(popup.locator('#calc-detail')).toHaveText('That isn’t a number. Try 52.38 or 60%.');
  await input.fill('120');
  await expect(popup.locator('#calc-detail')).toHaveText('A probability must be between 0% and 100%.');
  await popup.getByLabel('Rounding').selectOption('tenth');
  await input.fill('53');
  await expect(output).toHaveText('\u2212112.8');
  await context.close();
});

test('settings persist after the browser restarts', async () => {
  const profile = newProfileDir();
  let context = await launch(profile);
  let popup = await context.newPage();
  await popup.goto(POPUP_URL);
  await popup.getByLabel('Rounding').selectOption('tenth');
  await popup.getByRole('radio', { name: 'Odds first' }).check();
  await popup.getByRole('switch', { name: 'Convert prices on Novig' }).uncheck();
  await popup.getByLabel('Theme').selectOption('dark');
  await popup.waitForTimeout(300);
  await context.close();

  context = await launch(profile);
  popup = await context.newPage();
  await popup.goto(POPUP_URL);
  await expect(popup.getByLabel('Rounding')).toHaveValue('tenth');
  await expect(popup.getByRole('radio', { name: 'Odds first' })).toBeChecked();
  await expect(popup.getByRole('switch', { name: 'Convert prices on Novig' })).not.toBeChecked();
  await expect(popup.getByRole('switch', { name: 'Convert prices on Kalshi' })).toBeChecked();
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');

  const kalshi = await context.newPage();
  await kalshi.goto('https://kalshi.com/markets/persist');
  await waitForLabels(kalshi, await kalshi.locator('[data-expect-odds]').count());
  await expect(kalshi.locator('#fed-card .chance aoc-odds-label')).toHaveAttribute('data-aoc-odds', '\u2212163.2');
  const novig = await context.newPage();
  await novig.goto('https://novig.com/nfl/persist');
  await novig.waitForTimeout(1200);
  expect(await novig.locator('aoc-odds-label').count()).toBe(0);
  await context.close();
});

test('popup is keyboard accessible', async () => {
  const context = await launch();
  const popup = await context.newPage();
  await popup.goto(POPUP_URL);
  await popup.keyboard.press('Tab');
  await expect(popup.getByRole('switch', { name: 'Converter on' })).toBeFocused();
  await popup.keyboard.press('Space');
  await expect(popup.getByRole('switch', { name: 'Converter on' })).not.toBeChecked();
  await popup.keyboard.press('Space');
  await expect(popup.getByRole('switch', { name: 'Converter on' })).toBeChecked();
  // Tab reaches each site switch, the display options, selects, calculator and diagnostics.
  const reached = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await popup.keyboard.press('Tab');
    reached.add(await popup.evaluate(() => document.activeElement?.id || (document.activeElement as HTMLInputElement | null)?.name || ''));
  }
  for (const id of ['site-polymarketUs', 'site-kalshi', 'site-prophetx', 'site-novig', 'displayOrder', 'rounding', 'theme', 'calc-input', 'copy-diagnostics']) {
    expect(reached, id).toContain(id);
  }
  await context.close();
});

test('popup states for unsupported pages, light/dark themes, and screenshots', async () => {
  mkdirSync(SCREENSHOTS, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    const context = await launch(newProfileDir(), scheme);
    const page = await openFixture(context, 'https://kalshi.com/markets/kxfeddecision/fed-decision');
    const popup = await openPopupFor(context, 'kalshi');
    await popup.setViewportSize({ width: 340, height: 760 });
    await popup.getByLabel('Probability').fill('52.38');
    const background = await popup.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe(scheme === 'dark' ? 'rgb(21, 23, 28)' : 'rgb(255, 255, 255)');
    await popup.screenshot({ path: `${SCREENSHOTS}/popup-${scheme}.png`, fullPage: true });
    if (scheme === 'light') {
      await page.setViewportSize({ width: 640, height: 560 });
      await page.locator('#fed-card').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SCREENSHOTS}/kalshi-fixture.png`, clip: { x: 0, y: 40, width: 600, height: 520 } });
      // A tab that is not one of the four platforms.
      const other = await context.newPage();
      await other.goto(POPUP_URL);
      await expect(other.locator('#status-title')).toHaveText('No supported page in this tab');
    }
    await context.close();
  }
});

// Renders public/icon.svg to the PNG sizes Chrome/Edge use. Requires Playwright's
// Chromium (npx playwright install chromium). The PNGs are committed, so a normal
// build does not need this script.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const svg = await readFile(resolve(root, 'public/icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`,
    );
    await page.screenshot({ path: resolve(root, `public/icons/icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`public/icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}

/**
 * Captures the eight character designs off the roster review page.
 *
 * Writes face-on portraits, full review sheets and a lineup into
 * screenshots/characters/. Start the review server first:
 *
 *   npx vite --port 3007
 *   node scripts/capture_roster.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'screenshots/characters';
const IDS = ['first-draft','graphite','crosshatch','architect','whiteout','inkblot','chisel-tip','surveyor'];
await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:3007/characters.html?still', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2000));
const stage = await page.$('#stage');
const box = await stage.boundingBox();
const clip = { x: box.x + box.width * 0.28, y: box.y + box.height * 0.02, width: box.width * 0.44, height: box.height * 0.92 };
for (let i = 0; i < 8; i++) {
  await page.keyboard.press(`Digit${i + 1}`);
  await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/${String(i + 1).padStart(2,'0')}-${IDS[i]}.png`, clip });
  await page.screenshot({ path: `${OUT}/sheet-${String(i + 1).padStart(2,'0')}-${IDS[i]}.png` });
}
await page.keyboard.press('KeyL');
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: `${OUT}/00-lineup.png` });
console.log('errors:', errs);
await browser.close();

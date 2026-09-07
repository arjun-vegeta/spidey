/**
 * Drives the real menu into character select, picks a design and a colour, and
 * captures what the player sees. Run the dev server first.
 *
 *   npx vite --port 3007
 *   node scripts/verify_character_select.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:3007/';
const OUT = 'screenshots/characters';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1500,950'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE ' + m.text());
});

await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.menu-charbtn', { timeout: 30000 });
await sleep(600);
await page.screenshot({ path: `${OUT}/ui-01-identity.png` });

const label = await page.$eval('.menu-charbtn-name', (n) => n.textContent);
console.log('identity row shows:', label);

await page.click('.menu-charbtn');
await sleep(1500);
await page.screenshot({ path: `${OUT}/ui-02-picker.png` });

// Pick the fourth design, then a different ink colour.
const rows = await page.$$('.charpick-row');
console.log('roster rows:', rows.length);
await rows[3].click();
await sleep(1200);
await page.screenshot({ path: `${OUT}/ui-03-architect.png` });

const swatches = await page.$$('.charpick-swatches .menu-swatch');
console.log('ink swatches:', swatches.length);
await swatches[6].click();
await sleep(1200);
await page.screenshot({ path: `${OUT}/ui-04-recoloured.png` });

const picked = await page.$eval('.charpick-card-name', (n) => n.textContent);
const stored = await page.evaluate(() => localStorage.getItem('spidey-profile-v1'));
console.log('card shows:', picked);
console.log('persisted:', stored);

await page.click('.menu-actions .menu-btn-primary');
await sleep(500);
const back = await page.$eval('.menu-charbtn-name', (n) => n.textContent);
console.log('identity row after DONE:', back);
await page.screenshot({ path: `${OUT}/ui-05-back.png` });

console.log('errors:', errors);
await browser.close();

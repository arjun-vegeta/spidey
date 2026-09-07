/**
 * Screenshots the new menu surfaces and re-checks that SOLO still boots the
 * classic single-player flow after the multiplayer rework.
 *
 *   npm run dev && node scripts/verify_menu_visuals.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const URL = process.argv[2] || 'http://localhost:3001/';
const OUT = 'screenshots/multiplayer';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await sleep(4000);

const click = async (sel, text) => {
  await page.evaluate((s, t) => {
    const n = [...document.querySelectorAll(s)].find((x) =>
      (x.innerText || '').toUpperCase().includes(t));
    if (n) n.click();
  }, sel, text.toUpperCase());
  await sleep(500);
};

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  saved ${OUT}/${name}.png`);
};

console.log('· menu surfaces');
await shot('01-home');
await click('.menu-choice', 'MULTIPLAYER');
await shot('02-mode-picker');
await click('.menu-choice', 'JOIN ROOM');
await page.evaluate(() => {
  const i = document.querySelector('.menu-code-input');
  i.value = 'ABC234';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await shot('03-join');
await click('.menu-btn', 'BACK');
await click('.menu-choice', 'CREATE ROOM');
await sleep(2500);
await shot('04-lobby');

// Solo regression: the classic flow must be untouched.
console.log('· solo regression');
await page.evaluate(() => {
  window.__spideyMenu.activeSession?.leave();
  location.reload();
});
await sleep(5000);
await click('.menu-choice', 'SOLO');
await sleep(400);
const modalUp = await page.evaluate(() => {
  const m = document.getElementById('instructions-modal');
  return m && getComputedStyle(m).display !== 'none';
});
console.log(`  instructions modal shown: ${modalUp}`);
await shot('05-solo-instructions');

await page.keyboard.press('Enter');
await sleep(3000);
const solo = await page.evaluate(() => ({
  running: !!document.body.classList.contains('in-game'),
  wave: window.__spidey.enemyManager.currentWave,
  enemies: window.__spidey.enemyManager.enemies.length,
  mp: window.__spidey.isMultiplayer,
  mpHud: getComputedStyle(document.getElementById('mp-hud')).display,
  err: !!document.getElementById('spidey-boot-error'),
}));
console.log('  solo state:', JSON.stringify(solo));
await shot('06-solo-ingame');

const ok =
  modalUp && solo.running && solo.wave >= 1 && solo.enemies > 0 &&
  solo.mp === false && solo.mpHud === 'none' && solo.err === false;
console.log(ok ? '\nSOLO REGRESSION: PASS' : '\nSOLO REGRESSION: FAIL');
await browser.close();
process.exit(ok ? 0 : 1);

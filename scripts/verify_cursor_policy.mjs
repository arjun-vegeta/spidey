/**
 * CURSOR POLICY across every screen.
 *
 * The rule this checks: a click may capture the mouse ONLY while a run is
 * live and only on the game canvas. Anywhere else — the menu, the controls
 * card, the pause overlay, the death screen — the cursor has to survive so
 * there is something to click the buttons with.
 *
 * Regression it exists for: the mousedown listener is on `window`, so it used
 * to grab the pointer on any click at all. Pressing ESC and clicking QUIT TO
 * MENU re-locked on mousedown, which hid the pause card before the click
 * could land on the button — the button appeared dead.
 *
 *   npx vite --port 3007
 *   node scripts/verify_cursor_policy.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:3007/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.menu-charbtn', { timeout: 30000 });

// Count every pointer-lock request the page makes, from here on.
await page.evaluate(() => {
  const w = window;
  w.__lockCalls = 0;
  const proto = HTMLElement.prototype;
  const orig = proto.requestPointerLock;
  proto.requestPointerLock = function patched(...args) {
    w.__lockCalls++;
    return orig ? orig.apply(this, args) : undefined;
  };
});

const lockCalls = () => page.evaluate(() => window.__lockCalls);
const reset = () => page.evaluate(() => (window.__lockCalls = 0));

// ---- 1. The menu ---------------------------------------------------------
// The menu fades in; let it settle before the first real click.
await sleep(700);
await page.click('.menu-charbtn');
let pickerOpened = true;
try {
  await page.waitForSelector('.charpick-row', { timeout: 8000 });
} catch {
  pickerOpened = false;
}
check('character select opens on a menu click', pickerOpened);
check('menu clicks never grab the pointer', (await lockCalls()) === 0, `${await lockCalls()} calls`);

const rows = await page.$$('.charpick-row');
await rows[5].click();
await sleep(400);
const picked = await page.$eval('.charpick-card-name', (n) => n.textContent);
check('a second menu click still lands', picked === 'INKBLOT', `card says ${picked}`);
await page.click('.menu-actions .menu-btn-primary');
await sleep(300);

// ---- 2. The controls card ------------------------------------------------
await page.evaluate(() => {
  document.querySelector('.menu-choice-grid .menu-choice')?.click();
});
await sleep(400);
const modalShown = await page.evaluate(
  () => document.getElementById('instructions-modal')?.style.display
);
check('SOLO opens the controls card', modalShown === 'flex', `display: ${modalShown}`);
await reset();
await page.evaluate(() => document.getElementById('play-button')?.click());
await sleep(200);
check('clicking the controls card never grabs the pointer', (await lockCalls()) === 0);

// ---- 3. In a live run ----------------------------------------------------
await page.keyboard.press('Enter');
await sleep(1200);
const running = await page.evaluate(() => !!window.__spidey?.input?.pointerLockOnClick);
check('a live run allows click-to-capture', running);
await reset();
const lockedAlready = await page.evaluate(() => window.__spidey.input.isLocked);
await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  canvas?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
});
// Either the pointer was already captured (nothing to re-request), or the
// click asks for it. What must never happen is neither.
check(
  'clicking the canvas mid-run captures the pointer',
  lockedAlready || (await lockCalls()) > 0,
  lockedAlready ? 'already captured' : `${await lockCalls()} calls`
);

// Recapture path proper: pretend the pointer was released mid-run, then click
// the canvas the way a player does to get back in.
await reset();
await page.evaluate(() => {
  window.__spidey.input.isLocked = false;
  document
    .querySelector('canvas')
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
});
check('an unlocked run recaptures on a canvas click', (await lockCalls()) > 0, `${await lockCalls()} calls`);

// ---- 4. The end-of-match leaderboard -------------------------------------
// Its REMATCH / LEAVE buttons are the only way out of a finished match, and
// the match end hands the mouse back specifically so they can be clicked.
await reset();
await page.evaluate(() => {
  window.__spidey.mpHud.setActive(true);
  window.__spidey.mpHud.showEnd(
    [{ id: 'a', name: 'TESTER', colorIndex: 0, kills: 3, deaths: 1 }],
    'a',
    true,
    'TESTER',
    'kills'
  );
});
await sleep(300);
const endBtn = await page.evaluate(() => {
  const btn = document.querySelector('.mp-end-card button');
  if (!btn) return 'no button';
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  return btn.textContent;
});
check('leaderboard buttons do not grab the pointer', (await lockCalls()) === 0, `on "${endBtn}"`);
await page.evaluate(() => window.__spidey.mpHud.hideEnd());

// ---- 5. Paused -----------------------------------------------------------
await reset();
await page.evaluate(() => window.__spidey.hud.setPaused(true));
await sleep(200);
const pauseVisible = await page.evaluate(
  () => getComputedStyle(document.getElementById('pause-menu')).display !== 'none'
);
check('ESC-style pause shows the card', pauseVisible);

await page.evaluate(() => {
  const quit = document.getElementById('quit-btn');
  quit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
});
check('mousedown on QUIT does not grab the pointer', (await lockCalls()) === 0, `${await lockCalls()} calls`);

await page.evaluate(() => document.getElementById('quit-btn').click());
await sleep(600);
const menuBack = await page.evaluate(() => {
  const m = document.getElementById('main-menu');
  return !!m && getComputedStyle(m).display !== 'none';
});
check('QUIT TO MENU returns to the menu', menuBack);
const gateClosed = await page.evaluate(() => window.__spidey.input.pointerLockOnClick === false);
check('back on the menu, click-to-capture is off again', gateClosed);

await reset();
await page.evaluate(() => {
  document.querySelector('canvas')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
});
check('clicking behind the menu does not grab the pointer', (await lockCalls()) === 0);

console.log('\nerrors:', errors);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);

/**
 * Asserts the lobby fits on short screens with a FULL eight-player room.
 *
 * A full lobby is the tallest thing the menu ever draws. If it overflows, the
 * START MATCH button goes below the fold or players hide behind a scrollbar —
 * both of which look like the game is broken rather than like a layout bug.
 *
 *   npm run dev && node scripts/verify_lobby_fit.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const URL = process.argv[2] || 'http://localhost:3001/';
const OUT = 'screenshots/multiplayer';
const HEIGHTS = [900, 800, 760, 720, 700, 680, 660, 620, 600, 560, 540];

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-webgl', '--ignore-gpu-blocklist'],
});

let failures = 0;
console.log('\nLobby fit check — 8 players, six viewport heights\n');

for (const h of HEIGHTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: h });
  page.on('pageerror', (e) => console.log(`  [${h}] PAGE ERROR: ${e.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  const click = async (sel, text) => {
    await page.evaluate((s, t) => {
      const n = [...document.querySelectorAll(s)].find((x) => (x.innerText || '').toUpperCase().includes(t));
      if (n) n.click();
    }, sel, text);
    await sleep(400);
  };
  await click('.menu-choice', 'MULTIPLAYER');
  await click('.menu-choice', 'CREATE ROOM');
  await sleep(2500);

  const m = await page.evaluate(() => {
    const menu = window.__spideyMenu;
    const s = menu.activeSession;
    const names = ['SMUDGED-QUILL', 'BLOTTED-WEBHEAD', 'TRACED-MARGIN', 'CROSSHATCH-X',
                   'PENNED-SPLOTCH', 'RULED-STENCIL', 'SMUDGED-SWINGER'];
    names.forEach((nm, i) => {
      s.peers.set(`fake${i}`, {
        id: `fake${i}`, name: nm, colorIndex: i + 1, kills: 0, deaths: 0,
        lastSeen: Date.now(), alive: true, isSelf: false,
      });
    });
    menu.renderLobby();

    const list = document.querySelector('.menu-roster');
    const overlay = document.querySelector('#main-menu');
    const start = [...document.querySelectorAll('.menu-btn')]
      .find((b) => b.textContent.includes('START MATCH'));
    return {
      rows: list.children.length,
      rosterClipped: list.scrollHeight > list.clientHeight + 1,
      overflowPx: Math.max(0, overlay.scrollHeight - overlay.clientHeight),
      startBottom: start ? Math.round(start.getBoundingClientRect().bottom) : -1,
      cardH: Math.round(document.querySelector('.menu-card').getBoundingClientRect().height),
      viewport: window.innerHeight,
    };
  });

  // The real requirement is that START MATCH is reachable without scrolling
  // and that no player is hidden. A few pixels of overlay overflow from the
  // card's drop shadow is cosmetically irrelevant; more than that means the
  // layout genuinely does not fit.
  const startVisible = m.startBottom > 0 && m.startBottom <= m.viewport - 4;
  const ok = m.rows === 8 && !m.rosterClipped && m.overflowPx <= 12 && startVisible;
  if (!ok) failures++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${String(h).padStart(4)}px — ` +
    `rows=${m.rows} clipped=${m.rosterClipped} ` +
    `overflow=${m.overflowPx}px card=${m.cardH} start=${m.startBottom}/${m.viewport}`
  );

  await page.screenshot({ path: `${OUT}/lobby-8p-${h}.png` });
  await page.close();
}

await browser.close();
console.log(`\n${HEIGHTS.length - failures}/${HEIGHTS.length} viewports fit a full lobby`);
process.exit(failures ? 1 : 0);

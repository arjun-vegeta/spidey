import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--user-data-dir=/tmp/spideyprof'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
await page.click('#play-button');
await new Promise(r => setTimeout(r, 1500));
await page.keyboard.down('KeyW');
await new Promise(r => setTimeout(r, 1000));
await page.keyboard.up('KeyW');
const s = await page.evaluate(() => {
  const g = window.__spidey;
  return {
    build: document.getElementById('build-stamp')?.textContent,
    locked: g.input.isLocked, bypass: g.input.lockBypass, playing: g.input.isPlaying,
    running: !!g, pos: g.player.position.toArray(), keys: g.input.keys,
    modal: document.getElementById('instructions-modal')?.style.display || '(css)',
    pause: document.getElementById('pause-menu')?.style.display,
    lockEl: !!document.pointerLockElement,
  };
});
console.log('STATE:', JSON.stringify(s));
console.log('ERRORS:', errs.length ? errs.slice(0, 8) : 'none');
await browser.close();

import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
await page.click('#play-button');
await new Promise(r => setTimeout(r, 1500));
const s0 = await page.evaluate(() => {
  const g = window.__spidey;
  return { locked: g.input.isLocked, bypass: g.input.lockBypass, pos: g.player.position.toArray(), ammo: g.player.weaponManager.activeWeapon.currentAmmo, paused: document.getElementById('pause-menu')?.style.display, modal: document.getElementById('instructions-modal')?.style.display };
});
console.log('BEFORE_KEYS:', JSON.stringify(s0));
await page.keyboard.down('KeyW');
await new Promise(r => setTimeout(r, 1200));
const s1 = await page.evaluate(() => {
  const g = window.__spidey;
  return { keys: g.input.keys, pos: g.player.position.toArray(), mode: g.player.physics.mode };
});
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyV');
await new Promise(r => setTimeout(r, 400));
const s2 = await page.evaluate(() => ({ ammo: window.__spidey.player.weaponManager.activeWeapon.currentAmmo }));
console.log('KEYS_W:', JSON.stringify(s1));
console.log('AFTER_V:', JSON.stringify(s2));
console.log('ERRORS:', errs.length ? errs.slice(0, 8) : 'none');
await browser.close();

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT_DIR = '/Users/arjun/.gemini/antigravity-cli/brain/60c84054-ac5c-4484-8302-5f5c08ba69dd/screenshots';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist'
  ]
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#instructions-modal.ready', { timeout: 15000 });
await page.waitForFunction(() => window.__spidey !== undefined, { timeout: 15000 });

await page.click('#play-button');
await new Promise(r => setTimeout(r, 1200));

const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const modal = document.getElementById('instructions-modal');
  if (modal) modal.style.display = 'none';
  const ann = document.getElementById('hud-announcement');
  if (ann) ann.style.display = 'none';

  const g = window.__spidey;
  g.input.lockBypass = true;
  if (!g.isRunning) g.start();
  g.enemyManager.clear();
  g.enemyManager.intermissionTimer = 99999;
  g.player.health = 100;
  g.player.isDead = false;
  if (g.hud) g.hud.setMinimapVisible(true);
});

// Eye-level view from south inside plaza (z=-38) looking north at the funbox, half-pipe & bowl
await ev(() => {
  const g = window.__spidey;
  g.player.physics.position.set(0, 2.2, -38);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.05;
});

await new Promise(r => setTimeout(r, 800));
const shotPath = path.join(OUT_DIR, 'skatepark_ground_level.png');
await page.screenshot({ path: shotPath, type: 'png' });
console.log(`Saved screenshot: ${shotPath}`);

await browser.close();

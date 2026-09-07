import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT_DIR = '/Users/arjun/.gemini/antigravity-cli/brain/60c84054-ac5c-4484-8302-5f5c08ba69dd/screenshots';
fs.mkdirSync(OUT_DIR, { recursive: true });

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

async function captureShot(name, setupFn) {
  await ev(setupFn);
  await new Promise(r => setTimeout(r, 600));
  const shotPath = path.join(OUT_DIR, name);
  await page.screenshot({ path: shotPath, type: 'png' });
  console.log(`Saved screenshot: ${shotPath}`);
}

// 1. Exterior view looking North towards Grand Depot entrance portico
await captureShot('atrium_exterior_view.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(0, 2.0, -31.5);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = 0.12;
});

// 2. Interior Ground Floor looking at the Central Grand Staircase
await captureShot('atrium_ground_central_staircase.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(0, 1.8, -43.0);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = 0.10;
});

// 3. West Wing: Armory Vault with security counter and stacked crates
await captureShot('atrium_west_armory_vault.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(-6.5, 1.8, -48.0);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = -Math.PI / 4;
  g.player.pitch = 0.0;
});

// 4. East Wing: Library & Archive with study tables & bookshelves
await captureShot('atrium_east_library.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(6.5, 1.8, -48.0);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = Math.PI / 4;
  g.player.pitch = 0.0;
});

// 5. Standing on 2nd Floor Mezzanine looking down across the central atrium void
await captureShot('atrium_second_floor_mezzanine_overlook.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(0, 6.2, -41.5);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.32;
});

// 6. Second Floor NE corner looking at the cupola stairs
await captureShot('atrium_second_floor_cupola_stair.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(8.0, 6.2, -50.5);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0.15;
  g.player.pitch = 0.18;
});

// 7. Rooftop view (central raised glass lantern, NE cupola, water tower)
await captureShot('atrium_rooftop_view.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(-2.0, 10.8, -42.0);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0.15;
  g.player.pitch = -0.05;
});

// 8. Aerial bird's eye view with minimap
await captureShot('atrium_birds_eye_minimap.png', () => {
  const g = window.__spidey;
  g.player.physics.position.set(0, 32.0, -18.0);
  g.player.physics.velocity.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.75;
});

await browser.close();
console.log('Finished capturing all atrium screenshots.');

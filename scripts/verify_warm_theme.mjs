import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = '/Users/arjun/.gemini/antigravity-cli/brain/ee623179-d982-4d5c-a0c1-fb492a831993';

const server = await createServer({
  server: { port: 3000 }
});
await server.listen();
console.log('Vite server started on http://localhost:3000');

try {
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
  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  console.log('Loading page...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#instructions-modal.ready', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));

  const menuShotPath = path.join(ARTIFACT_DIR, 'homepage_warm.png');
  await page.screenshot({ path: menuShotPath });
  console.log('Captured homepage screenshot to:', menuShotPath);

  // Press Enter to start the game
  console.log('Pressing Enter to start game...');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1200));

  // Ensure lock bypass and active gameplay view
  await page.evaluate(() => {
    const modal = document.getElementById('instructions-modal');
    if (modal) modal.style.display = 'none';
    if (window.__spidey) {
      window.__spidey.input.lockBypass = true;
      if (!window.__spidey.isRunning) window.__spidey.start();
      window.__spidey.enemyManager.clear();
      window.__spidey.enemyManager.intermissionTimer = 99999;
      // Position player to see buildings and sky clearly
      window.__spidey.player.physics.position.set(0, 16.5, 0);
      window.__spidey.player.yaw = Math.PI / 2;
      window.__spidey.player.pitch = 0.05;
    }
  });

  await new Promise((r) => setTimeout(r, 800));

  const ingameShotPath = path.join(ARTIFACT_DIR, 'ingame_warm.png');
  await page.screenshot({ path: ingameShotPath });
  console.log('Captured in-game screenshot to:', ingameShotPath);

  console.log('Verification completed without errors. Page errors:', errors);

  await browser.close();
} finally {
  await server.close();
}

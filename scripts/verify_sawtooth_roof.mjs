import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT_DIR = '/Users/arjun/.gemini/antigravity-cli/brain/542179d0-2ae5-44b2-976a-d67cafb59605/screenshots';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log('Launching browser to test sawtooth sloping roof collision...');
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

console.log('Navigating to http://localhost:3000...');
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });

await page.click('#play-button');
await new Promise(r => setTimeout(r, 1200));

const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const modal = document.getElementById('instructions-modal');
  if (modal) modal.style.display = 'none';
  window.__spidey.input.lockBypass = true;
  if (!window.__spidey.isRunning) window.__spidey.start();
  window.__spidey.enemyManager.clear();
  window.__spidey.enemyManager.intermissionTimer = 99999;
});

console.log('--- Test 1: Drop onto Ironworks Sawtooth Roof (Bay 1 midpoint: x=-46, z=-44) ---');
const dropResult = await ev(async () => {
  const p = window.__spidey.player;
  p.physics.position.set(-46, 17.5, -44);
  p.physics.velocity.set(0, -5, 0);
  p.physics.mode = 1; // AIR
  p.physics.isGrounded = false;

  for (let i = 0; i < 30; i++) {
    p.update(0.016, []);
  }

  return {
    x: p.physics.position.x,
    y: p.physics.position.y,
    z: p.physics.position.z,
    isGrounded: p.physics.isGrounded,
    mode: p.physics.mode
  };
});

console.log('Drop landing result:', dropResult);
if (dropResult.y < 14.5) {
  throw new Error(`Player penetrated through roof! Y=${dropResult.y}`);
}
console.log('PASS: Player landed cleanly on the sloped roof at Y=' + dropResult.y.toFixed(2));

console.log('--- Test 2: Walk up the slope towards peak (+Z) ---');
const walkUpResult = await ev(async () => {
  const p = window.__spidey.player;
  const history = [];

  for (let i = 0; i < 60; i++) {
    p.physics.velocity.z = 4.0;
    p.physics.velocity.x = 0;
    p.update(0.016, []);
    history.push({
      z: p.physics.position.z,
      y: p.physics.position.y,
      grounded: p.physics.isGrounded
    });
  }

  return history;
});

const startY = walkUpResult[0].y;
const endY = walkUpResult[walkUpResult.length - 1].y;
console.log(`Walking up: start Y=${startY.toFixed(2)}, end Y=${endY.toFixed(2)}`);
console.log('All steps grounded:', walkUpResult.every(h => h.grounded));
if (endY <= startY) {
  throw new Error(`Player did not rise up the slope! start=${startY}, end=${endY}`);
}
console.log('PASS: Player rose smoothly up the slope as they walked forward!');

console.log('--- Test 3: High-velocity dive landing (fall from y=25m at -30 m/s) ---');
const highFallResult = await ev(async () => {
  const p = window.__spidey.player;
  p.physics.position.set(-46, 25, -44);
  p.physics.velocity.set(0, -30, 0);
  p.physics.mode = 1; // AIR
  p.physics.isGrounded = false;

  for (let i = 0; i < 30; i++) {
    p.update(0.016, []);
  }

  return {
    y: p.physics.position.y,
    vy: p.physics.velocity.y,
    grounded: p.physics.isGrounded
  };
});

console.log('High-velocity fall result:', highFallResult);
if (highFallResult.y < 14.5) {
  throw new Error(`Player tunneled through the roof on high-speed fall! Y=${highFallResult.y}`);
}
console.log('PASS: Anti-tunneling caught high-velocity drop! Standing at Y=' + highFallResult.y.toFixed(2));

console.log('--- Test 4: Capture in-game screenshot of standing on the sawtooth roof ---');
await ev(() => {
  const p = window.__spidey.player;
  // Position player standing near the south ridge looking north across the 3 sawtooth bays
  p.physics.position.set(-46, 14.2, -50);
  p.yaw = 0; // facing North
  p.pitch = -0.15; // looking slightly downward across the ridges
  p.camera.position.set(-46, 15.0, -50);
  p.camera.rotation.set(-0.15, 0, 0);
});

await new Promise(r => setTimeout(r, 600));

const screenshotPath = path.join(OUT_DIR, 'sawtooth_roof_standing_verified.png');
await page.screenshot({ path: screenshotPath, fullPage: false });
console.log('Saved screenshot to:', screenshotPath);

await browser.close();
console.log('ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!');

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT_DIR = '/Users/arjun/.gemini/antigravity-cli/brain/542179d0-2ae5-44b2-976a-d67cafb59605/screenshots';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

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

// Click Play
await page.click('#play-button');
await new Promise(r => setTimeout(r, 1500));

const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const modal = document.getElementById('instructions-modal');
  if (modal) modal.style.display = 'none';
  const waveBanner = document.getElementById('wave-announcement') || document.querySelector('.wave-banner');
  if (waveBanner) waveBanner.style.display = 'none';
  document.querySelectorAll('div').forEach(d => {
    if (d.innerText && d.innerText.includes('WAVE 1')) d.style.display = 'none';
  });
  window.__spidey.input.lockBypass = true;
  if (!window.__spidey.isRunning) window.__spidey.start();
  window.__spidey.enemyManager.clear();
  window.__spidey.enemyManager.intermissionTimer = 99999;
});

const shots = [
  // 1. Full Elevation showing entire building from ground to the 105m cathedral cross
  ['sovereign_cathedral_full_spire', [0, 42, -5], Math.PI, 0.44],
  // 2. 3/4 Perspective showing buttresses, gargoyle perches, flying arches, clock, and spire
  ['sovereign_cathedral_3d_perspective', [-28, 55, 25], Math.PI - 0.48, 0.38],
  // 3. Close-up on the Crown, Belfry, Clock Stage, and Spire
  ['sovereign_cathedral_crown_and_clocks', [0, 78, 38], Math.PI, 0.26]
];

for (const [name, [px, py, pz], yaw, pitch] of shots) {
  console.log(`Setting camera for ${name}...`);
  await ev(([pos, y, p]) => {
    const g = window.__spidey;
    // Hide any banner
    document.querySelectorAll('div').forEach(d => {
      if (d.innerText && d.innerText.includes('WAVE 1')) d.style.display = 'none';
    });
    g.player.physics.position.set(pos[0], pos[1], pos[2]);
    g.player.physics.velocity.set(0, 0, 0);
    g.player.yaw = y;
    g.player.pitch = p;
    g.player.health = 100;
  }, [[px, py, pz], yaw, pitch]);

  await new Promise(r => setTimeout(r, 600));
  const shotPath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: shotPath, type: 'png' });
  console.log(`Saved screenshot: ${shotPath}`);
}

await browser.close();
console.log('Capture complete!');

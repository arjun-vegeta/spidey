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

// Click Play to enter Blueprint City
await page.click('#play-button');
await new Promise(r => setTimeout(r, 1500));

const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => {
  const modal = document.getElementById('instructions-modal');
  if (modal) modal.style.display = 'none';
  window.__spidey.input.lockBypass = true;
  if (!window.__spidey.isRunning) window.__spidey.start();
  window.__spidey.enemyManager.clear();
  window.__spidey.enemyManager.intermissionTimer = 99999;
});

// Capture list: name, [x, y, z], yaw, pitch
const shots = [
  // 1. Overall District Aerial Panorama (standing on Crane Boom at y=46.5m looking South)
  ['district_aerial_overview', [6, 46.5, -2], 0, -0.2],

  // 2. W: Dockside Grand Terminal (cargo hoist, copper cupola, skybridge)
  ['dockside_grand_terminal', [-24, 18, 0], Math.PI * 0.5, -0.05],

  // 3. E: Metropol Prism Tech Spire (observation pods, helipad, cyan glow)
  ['metropol_tech_spire', [24, 25, 0], -Math.PI * 0.5, 0.25],

  // 4. N: Sovereign Clocktower & Cathedral (buttresses, gargoyles, clock, spire)
  ['sovereign_clocktower', [0, 35, 30], Math.PI, 0.35],

  // 5. S: Old Town Brownstone & Bohemian Loft (fire escape, stoop, front face)
  ['brownstone_fire_escape', [0, 1.8, -58], Math.PI, 0.28],

  // 6. S: Brownstone Rooftop Garden (timber pergola, picnic table, planters, chimneys)
  ['brownstone_roof_garden', [0, 16.5, -46], Math.PI, -0.05],

  // 7. NW: Ironworks Sawtooth Plant & Chimney (sawtooth sloped roof, 32m smokestack)
  ['ironworks_sawtooth_plant', [-24, 20, -28], 0.785, -0.15],

  // 8. SE: Brutalist Tiered Terrace Spire (diving boards, stepped setbacks)
  ['brutalist_diving_boards', [24, 20, 24], -2.35, 0.2],

  // 9. NE: Grand Copper Mansard Hotel (copper mansard, corner turret tower)
  ['copper_mansard_turret', [24, 16, -24], -0.785, 0.25],

  // 10. SW: Royale Art-Deco Cinema & Palace (marquee bulbs, blade sign, billboard)
  ['royale_art_deco_cinema', [-24, 12, 24], 2.35, 0.1],

  // 11. Central Construction Site Crane & Open Slabs
  ['construction_site_crane', [-10, 21, 10], 2.5, 0.15],
];

for (const [name, pos, yaw, pitch] of shots) {
  await ev(([p, y, pt]) => {
    const g = window.__spidey;
    g.player.physics.position.set(p[0], p[1], p[2]);
    g.player.physics.velocity.set(0, 0, 0);
    g.player.yaw = y;
    g.player.pitch = pt;
    g.player.health = 100;
  }, [pos, yaw, pitch]);

  await new Promise(r => setTimeout(r, 600));
  const savePath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: savePath });
  console.log(`Captured: ${name}.png`);
}

await browser.close();
console.log('All landmark screenshots captured successfully!');

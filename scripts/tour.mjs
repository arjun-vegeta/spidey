import puppeteer from 'puppeteer-core';
const OUT = '/var/folders/28/3r7lx6ns2pd5sd072zz83jcw0000gn/T/opencode/tour';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
await page.click('#play-button');
await new Promise(r => setTimeout(r, 1500));
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  document.getElementById('instructions-modal').style.display = 'none';
  window.__spidey.input.lockBypass = true;
  if (!window.__spidey.isRunning) window.__spidey.start();
  window.__spidey.enemyManager.clear();
  window.__spidey.enemyManager.intermissionTimer = 99999;
});
const shots = [
  ['theater', [0, 16.5, 0], Math.PI / 2, 0.05],
  ['walkup', [0, 4, 20], Math.PI, 0.12],
  ['waterworks', [-20, 8, -20], 0.82, 0.15],
  ['copper', [20, 12, -20], -0.785, 0.2],
  ['ledge', [20, 14, 46], -Math.PI / 2, 0.1],
  ['glass', [18, 22, 0], -Math.PI / 2, 0.08],
  ['crown', [0, 42, 18], Math.PI, 0.18],
  ['dock', [-28, 17, 6], Math.PI / 2, 0.0],
];
for (const [name, pos, yaw, pitch] of shots) {
  await ev(([p, y, pt]) => {
    const g = window.__spidey;
    g.player.physics.position.set(p[0], p[1], p[2]);
    g.player.physics.velocity.set(0, 0, 0);
    g.player.yaw = y; g.player.pitch = pt;
    g.player.health = 100;
  }, [pos, yaw, pitch]);
  await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}-${name}.png` });
}
await browser.close();
console.log('tour done');

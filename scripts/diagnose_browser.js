import puppeteer from 'puppeteer-core';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const logs = [];
  page.on('console', (msg) => {
    logs.push(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
    console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    logs.push(`[PAGE ERROR]: ${err.message}\n${err.stack}`);
    console.error(`[PAGE ERROR]: ${err.message}\n${err.stack}`);
  });

  console.log('Navigating to http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });

  console.log('Taking screenshot before click...');
  await page.screenshot({ path: 'screenshots/test_before_click.png' });

  console.log('Clicking #play-button...');
  try {
    await page.click('#play-button');
  } catch (e) {
    console.error('Click error:', e);
  }

  // Wait 2 seconds
  await new Promise((r) => setTimeout(r, 2000));

  console.log('Taking screenshot after click...');
  await page.screenshot({ path: 'screenshots/test_after_click.png' });

  const elementInfo = await page.evaluate(() => {
    const pts = [
      { x: 100, y: 200 },
      { x: 100, y: 600 },
      { x: 720, y: 450 }
    ];
    return pts.map(p => {
      const el = document.elementFromPoint(p.x, p.y);
      return {
        pt: p,
        tag: el?.tagName,
        id: el?.id,
        className: el?.className,
        bg: el ? window.getComputedStyle(el).backgroundColor : null
      };
    });
  });
  console.log('Elements at points:', JSON.stringify(elementInfo, null, 2));

  // Inspect 3D camera and weapon position
  const sceneDebug = await page.evaluate(() => {
    const hud = document.getElementById('hud-container');
    if (hud) hud.style.display = 'none'; // Hide HUD to see raw canvas
    return { ok: true };
  });

  await page.screenshot({ path: 'screenshots/test_raw_canvas.png' });

  // Restore HUD
  await page.evaluate(() => {
    const hud = document.getElementById('hud-container');
    if (hud) hud.style.display = 'block';
  });

  // Evaluate WebGL status and canvas
  const canvasStatus = await page.evaluate(() => {
    const canvas = document.querySelector('#canvas-container canvas');
    if (!canvas) return { hasCanvas: false };
    const rect = canvas.getBoundingClientRect();
    return {
      hasCanvas: true,
      width: canvas.width,
      height: canvas.height,
      rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left }
    };
  });
  console.log('Canvas status:', canvasStatus);

  await browser.close();
  console.log('Diagnostic finished.');
}

run().catch((e) => {
  console.error('Fatal diagnostic error:', e);
  process.exit(1);
});

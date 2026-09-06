import puppeteer from 'puppeteer-core';

async function run() {
  console.log('Launching Chrome for visual test suite...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[BROWSER ERROR]: ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    console.error(`[PAGE ERROR]: ${err.message}`);
  });

  console.log('Opening http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });

  // 1. Click enter blueprint city and play
  console.log('Clicking play button...');
  await page.click('#play-button');
  await new Promise((r) => setTimeout(r, 1200));

  // Capture Pistol default view
  console.log('Capturing test_1_pistol.png...');
  await page.screenshot({ path: 'screenshots/test_1_pistol.png' });

  // 2. Switch to SMG (key '2')
  console.log('Switching to SMG (key 2)...');
  await page.keyboard.press('Digit2');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_2_smg.png...');
  await page.screenshot({ path: 'screenshots/test_2_smg.png' });

  // 3. Aim Down Sights on SMG (hold key 'q')
  console.log('Aiming down sights with Holographic sight on SMG (holding Q)...');
  await page.keyboard.down('KeyQ');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_3_smg_ads.png...');
  await page.screenshot({ path: 'screenshots/test_3_smg_ads.png' });
  await page.keyboard.up('KeyQ');
  await new Promise((r) => setTimeout(r, 400));

  // 4. Switch to Sniper (key '3')
  console.log('Switching to Sniper (key 3)...');
  await page.keyboard.press('Digit3');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_4_sniper.png...');
  await page.screenshot({ path: 'screenshots/test_4_sniper.png' });

  // 5. Scope in with Sniper (hold key 'q')
  console.log('Scoping in with Sniper (holding Q)...');
  await page.keyboard.down('KeyQ');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_5_sniper_scoped.png...');
  await page.screenshot({ path: 'screenshots/test_5_sniper_scoped.png' });
  await page.keyboard.up('KeyQ');
  await new Promise((r) => setTimeout(r, 400));

  // 6. Look around and test movement
  console.log('Testing mouse look and movement...');
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('Space');
  await new Promise((r) => setTimeout(r, 500));
  console.log('Capturing test_6_jumping.png...');
  await page.screenshot({ path: 'screenshots/test_6_jumping.png' });

  // 7. Test Web-Swinging (holding 'E' key)
  console.log('Testing web-swinging by holding E key...');
  await page.keyboard.press('Digit1'); // Switch to Pistol (usable while swinging!)
  await page.keyboard.down('KeyE'); // Hold web swing
  await new Promise((r) => setTimeout(r, 800));
  console.log('Capturing test_7_web_swinging.png...');
  await page.screenshot({ path: 'screenshots/test_7_web_swinging.png' });

  // 8. Fire weapon while swinging (Pistol aerial fire)
  console.log('Testing weapon firing (V key / Enter)...');
  await page.keyboard.press('KeyV');
  await new Promise((r) => setTimeout(r, 150));
  console.log('Capturing test_8_firing.png...');
  await page.screenshot({ path: 'screenshots/test_8_firing.png' });

  await page.keyboard.up('KeyE'); // Release web
  await new Promise((r) => setTimeout(r, 400));

  await browser.close();
  console.log('Visual test suite completed successfully!');
}

run().catch((e) => {
  console.error('Fatal error in visual test:', e);
  process.exit(1);
});

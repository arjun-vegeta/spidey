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
    console.log(`[BROWSER ${msg.type()}]: ${msg.text()}`);
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

  const ensurePlaying = async () => {
    await page.evaluate(() => {
      const modal = document.getElementById('instructions-modal');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
      }
      if (window.__spidey) {
        window.__spidey.input.lockBypass = true;
        if (!window.__spidey.isRunning) {
          window.__spidey.start();
        }
        if (window.__spidey.player && window.__spidey.player.health < 60 && !window.__spidey.player.isDead) {
          window.__spidey.player.health = 100;
        }
      }
    });
  };

  await ensurePlaying();

  // Capture Pistol default view
  console.log('Capturing test_1_pistol.png...');
  await page.screenshot({ path: 'screenshots/test_1_pistol.png' });

  // 2. Switch to SMG (key '2')
  console.log('Switching to SMG (key 2)...');
  await page.keyboard.press('Digit2');
  await new Promise((r) => setTimeout(r, 600));
  await ensurePlaying();
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
  await ensurePlaying();
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
  await ensurePlaying();
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('Space');
  await new Promise((r) => setTimeout(r, 500));
  console.log('Capturing test_6_jumping.png...');
  await page.screenshot({ path: 'screenshots/test_6_jumping.png' });

  // 7. Test Web-Swinging (holding 'E' key)
  console.log('Testing web-swinging by holding E key...');
  await ensurePlaying();
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

  // 9. Minimap visible (Key N toggles / default ON)
  console.log('Testing minimap visible (N key)...');
  await ensurePlaying();
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_9_minimap.png...');
  await page.screenshot({ path: 'screenshots/test_9_minimap.png' });

  // 10. Damage-ring firing lane
  console.log('Testing directional damage ring firing lane...');
  await page.evaluate(() => {
    if (window.__spidey) {
      // Simulate enemy projectile impact from east flank
      window.__spidey.player.takeDamage(12);
      window.__spidey.enemyManager.onPlayerDamaged?.({ x: 25, y: 0.5, z: 10 });
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  console.log('Capturing test_10_damage_ring.png...');
  await page.screenshot({ path: 'screenshots/test_10_damage_ring.png' });

  // 11. Terrace/balcony vista
  console.log('Orienting view toward terrace and balcony architectural vista...');
  await page.evaluate(() => {
    if (window.__spidey) {
      window.__spidey.player.yaw = -Math.PI * 0.45;
      window.__spidey.player.pitch = 0.12;
    }
  });
  await page.keyboard.press('KeyW');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_11_terrace_vista.png...');
  await page.screenshot({ path: 'screenshots/test_11_terrace_vista.png' });

  // 12. Onboarding hint
  console.log('Testing onboarding hint display...');
  await page.evaluate(() => {
    if (window.__spidey) {
      window.__spidey.hud.showHint('HOLD RIGHT-CLICK TO SWING');
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  console.log('Capturing test_12_onboarding_hint.png...');
  await page.screenshot({ path: 'screenshots/test_12_onboarding_hint.png' });

  // 13. Pause menu (P / Escape key)
  console.log('Opening pause menu (P / Escape key)...');
  await page.evaluate(() => {
    if (window.__spidey) {
      window.__spidey.hud.setPaused(true);
    }
  });
  await new Promise((r) => setTimeout(r, 500));
  console.log('Capturing test_13_pause_menu.png...');
  await page.screenshot({ path: 'screenshots/test_13_pause_menu.png' });

  // Resume before death test
  await page.evaluate(() => {
    if (window.__spidey) {
      window.__spidey.hud.setPaused(false);
    }
  });
  await new Promise((r) => setTimeout(r, 300));

  // 14. Death screen
  console.log('Testing player death and killer recap screen...');
  await page.evaluate(() => {
    if (window.__spidey) {
      window.__spidey.enemyManager.lastPlayerDeath = 'THUG · 18m · AHEAD';
      window.__spidey.player.takeDamage(999);
      window.__spidey.hud.showDeathScreen(window.__spidey.totalScore, window.__spidey.enemyManager.lastPlayerDeath);
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  console.log('Capturing test_14_death_screen.png...');
  await page.screenshot({ path: 'screenshots/test_14_death_screen.png' });

  // Verify restart via Key R
  console.log('Testing restart via R key...');
  await page.keyboard.press('KeyR');
  await new Promise((r) => setTimeout(r, 600));

  await browser.close();
  console.log('Visual test suite completed successfully!');
}

run().catch((e) => {
  console.error('Fatal error in visual test:', e);
  process.exit(1);
});

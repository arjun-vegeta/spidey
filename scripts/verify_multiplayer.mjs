/**
 * Two-peer multiplayer smoke test.
 *
 * Drives two real Chrome pages through the actual menu DOM — create a room,
 * read the code, join with it, start the match, drop in — then asserts that
 * the peers can see, move and shoot each other. Run the dev server first.
 *
 *   npm run dev
 *   node scripts/verify_multiplayer.mjs [http://localhost:3001]
 */
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:3001/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for `fn` to return truthy in the page, polling. */
async function until(page, fn, { timeout = 25000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    let value;
    try {
      value = await page.evaluate(fn);
    } catch {
      value = null;
    }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(250);
  }
}

/** Clicks the first element whose trimmed text matches, scoped to a selector. */
async function clickByText(page, selector, text) {
  const done = await page.evaluate(
    (sel, t) => {
      const nodes = [...document.querySelectorAll(sel)];
      const hit = nodes.find((n) => (n.innerText || '').trim().toUpperCase().includes(t));
      if (!hit) return false;
      hit.click();
      return true;
    },
    selector,
    text.toUpperCase()
  );
  if (!done) throw new Error(`could not find "${text}" in ${selector}`);
  await sleep(350);
}

/**
 * Each peer gets its OWN browser instance, not just its own tab.
 *
 * Chrome throttles requestAnimationFrame in background tabs, and the game
 * broadcasts its transform from the render loop. Two tabs in one browser would
 * leave the backgrounded peer frozen and silent — an artefact of the harness,
 * not the game. Separate browsers put both peers in the foreground, which is
 * also what two real players on two machines look like.
 */
function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

const browsers = [];

async function openPeer(label, profile) {
  const browser = await launch();
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // Pin a known name, ink and character so the character each peer DRAWS for
  // the other can be asserted rather than guessed at.
  if (profile) {
    await page.evaluateOnNewDocument((p) => {
      try {
        localStorage.setItem('spidey-profile-v1', JSON.stringify(p));
      } catch { /* private mode: the test just uses whatever it gets */ }
    }, profile);
  }
  page.on('pageerror', (e) => console.log(`  [${label}] PAGE ERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${label}] console.error: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!window.__spidey, { label: 'game boot' });
  await page.evaluate(() => {
    const g = window.__spidey;
    const orig = g.exitMultiplayer.bind(g);
    g.exitMultiplayer = function patched() {
      window.__exitTrace = new Error('exitMultiplayer called').stack;
      return orig();
    };
  });
  await until(
    page,
    () => {
      const m = document.getElementById('main-menu');
      return m && getComputedStyle(m).display !== 'none';
    },
    { label: 'menu visible' }
  );
  return page;
}

let exitCode = 0;
try {
  console.log(`\nSpidey multiplayer verification against ${URL}\n`);

  console.log('· booting two peers');
  const HOST_PROFILE = { name: 'HOST-ALPHA', colorIndex: 1, characterId: 'inkblot' };
  const GUEST_PROFILE = { name: 'GUEST-BETA', colorIndex: 6, characterId: 'chisel-tip' };
  const [host, guest] = await Promise.all([
    openPeer('HOST', HOST_PROFILE),
    openPeer('GUEST', GUEST_PROFILE),
  ]);
  check('both peers boot and reach the menu', true);

  // Give each peer a recognisable name.
  for (const [page, name] of [
    [host, 'HOSTY'],
    [guest, 'GUESTY'],
  ]) {
    await page.evaluate((n) => {
      const input = document.querySelector('.menu-name-input');
      input.value = n;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, name);
  }
  check('names accepted from the identity field', true);

  console.log('· host creates a room');
  await clickByText(host, '.menu-choice', 'MULTIPLAYER');
  await clickByText(host, '.menu-choice', 'CREATE ROOM');

  const code = await until(
    host,
    () => {
      const el = document.querySelector('.menu-code-value');
      const t = el && el.textContent.trim();
      return t && t.length === 6 ? t : null;
    },
    { label: 'room code' }
  );
  check('room code generated', /^[0-9A-HJKMNP-TV-Z]{6}$/.test(code), code);

  console.log(`· guest joins with ${code}`);
  await clickByText(guest, '.menu-choice', 'MULTIPLAYER');
  await clickByText(guest, '.menu-choice', 'JOIN ROOM');
  await guest.evaluate((c) => {
    const input = document.querySelector('.menu-code-input');
    input.value = c;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, code);
  await clickByText(guest, '.menu-btn', 'JOIN');

  // The mesh has to form over public relays; give it room.
  // The lobby session lives on the menu until the match hands it to the game.
  const rosterOk = await Promise.all([
    until(host, () => window.__spideyMenu.activeSession?.playerCount === 2, {
      timeout: 45000,
      label: 'host sees 2 players',
    }),
    until(guest, () => window.__spideyMenu.activeSession?.playerCount === 2, {
      timeout: 45000,
      label: 'guest sees 2 players',
    }),
  ]).then(() => true);
  check('peers discovered each other over WebRTC', rosterOk);

  const namesSeen = await host.evaluate(() =>
    window.__spideyMenu.activeSession.roster.map((p) => p.name).sort()
  );
  check(
    'profiles exchanged (names visible to the host)',
    namesSeen.includes('GUESTY') && namesSeen.includes('HOSTY'),
    namesSeen.join(', ')
  );

  const hostAgreement = await Promise.all([
    host.evaluate(() => {
      const s = window.__spideyMenu.activeSession;
      return s.hostId === s.selfId;
    }),
    guest.evaluate(() => {
      const s = window.__spideyMenu.activeSession;
      return !!s.hostId && s.hostId !== s.selfId;
    }),
  ]);
  check('both peers agree on who the host is', hostAgreement.every(Boolean));

  // Regression: a lobby idles with no game traffic at all. Before the presence
  // heartbeat existed, every peer aged out of every roster after the timeout
  // and the match started empty. Waiting out PEER_TIMEOUT_MS proves it holds.
  console.log('· idling in the lobby past the peer timeout (18s)');
  await sleep(18000);
  const survived = await Promise.all([
    host.evaluate(() => window.__spideyMenu.activeSession.playerCount),
    guest.evaluate(() => window.__spideyMenu.activeSession.playerCount),
  ]);
  check(
    'roster survives a lobby left idle past the peer timeout',
    survived.every((n) => n === 2),
    `host=${survived[0]} guest=${survived[1]}`
  );

  console.log('· host starts the match');
  await clickByText(host, '.menu-btn', 'START MATCH');
  await sleep(1200);

  // Drop in on both, then bypass pointer lock (headless never grants it).
  for (const page of [host, guest]) {
    await clickByText(page, '.menu-btn', 'DROP IN');
    await page.evaluate(() => {
      window.__spidey.input.lockBypass = true;
    });
  }
  await sleep(500);

  const playing = await Promise.all([
    host.evaluate(() => window.__spidey.net.phase),
    guest.evaluate(() => window.__spidey.net.phase),
  ]);
  check('both peers entered the playing phase', playing.every((p) => p === 'playing'), playing.join('/'));

  console.log('· waiting for avatars and transform replication');
  await Promise.all([
    until(host, () => window.__spidey.remotes.count === 1, { label: 'host sees an avatar' }),
    until(guest, () => window.__spidey.remotes.count === 1, { label: 'guest sees an avatar' }),
  ]);
  check('each peer spawned an avatar for the other', true);

  // Teleport the guest and confirm the host's copy of them follows.
  const before = await host.evaluate(() => {
    const rp = window.__spidey.remotes.all[0];
    return { x: rp.group.position.x, z: rp.group.position.z };
  });
  await guest.evaluate(() => {
    window.__spidey.player.physics.position.set(42, 6, -37);
  });
  await sleep(1800);
  const after = await host.evaluate(() => {
    const rp = window.__spidey.remotes.all[0];
    return { x: rp.group.position.x, z: rp.group.position.z };
  });
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check(
    'guest movement replicates to the host',
    moved > 5,
    `moved ${moved.toFixed(1)}m toward (42, -37) → (${after.x.toFixed(1)}, ${after.z.toFixed(1)})`
  );

  // ---------------------------------------------------------------------
  // The real shooting path: a genuine weapon raycast resolving against a
  // genuine remote avatar's hitboxes. Everything below this point in the file
  // reports hits over the wire directly, which would happily pass even if
  // `RemotePlayerManager.resolveHit` were completely broken.
  // ---------------------------------------------------------------------
  console.log('· firing a real weapon at a real avatar');

  // Pin both players in open air facing each other so gravity, geometry and
  // the city cannot interfere with the shot under test.
  const pin = (page, pos) =>
    page.evaluate((p) => {
      const g = window.__spidey;
      const hold = () => {
        g.player.physics.position.set(p[0], p[1], p[2]);
        g.player.physics.velocity.set(0, 0, 0);
        window.__pinRaf = requestAnimationFrame(hold);
      };
      hold();
    }, pos);

  const HOST_AT = [0, 80, 0];
  const GUEST_AT = [0, 80, -7];
  await pin(host, HOST_AT);
  await pin(guest, GUEST_AT);
  await sleep(1500);

  // Aim the host at the rival's torso. `lookInit()` is deliberately NOT used —
  // it resets yaw and pitch — and the pitch sign convention is measured from
  // the real camera rather than assumed.
  const setAim = (yaw, pitch) =>
    host.evaluate(
      (y, p) => {
        const g = window.__spidey;
        g.player.yaw = y;
        g.player.pitch = p;
      },
      yaw,
      pitch
    );

  const measureAim = () =>
    host.evaluate(() => {
      const g = window.__spidey;
      const rp = g.remotes.all[0];
      const cam = g.player.camera;
      const dir = new g.player.position.constructor();
      cam.getWorldDirection(dir);
      const dx = rp.group.position.x - cam.position.x;
      const dy = rp.group.position.y + 1.15 - cam.position.y;
      const dz = rp.group.position.z - cam.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      return { dot: dir.x * (dx / len) + dir.y * (dy / len) + dir.z * (dz / len), dist: len };
    });

  const geom = await host.evaluate(() => {
    const g = window.__spidey;
    const rp = g.remotes.all[0];
    const cam = g.player.camera;
    const dx = rp.group.position.x - cam.position.x;
    const dy = rp.group.position.y + 1.15 - cam.position.y;
    const dz = rp.group.position.z - cam.position.z;
    return { yaw: Math.atan2(-dx, -dz), up: Math.atan2(dy, Math.hypot(dx, dz)) };
  });

  await setAim(geom.yaw, geom.up);
  await sleep(200);
  const aimA = await measureAim();
  await setAim(geom.yaw, -geom.up);
  await sleep(200);
  const aimB = await measureAim();

  const best = aimA.dot >= aimB.dot ? geom.up : -geom.up;
  await setAim(geom.yaw, best);
  await sleep(200);
  const aim = await measureAim();

  check(
    'host camera is actually pointed at the rival',
    aim.dot > 0.9995,
    `alignment=${aim.dot.toFixed(5)} at ${aim.dist.toFixed(1)}m`
  );

  const rayTargets = await host.evaluate(() => window.__spidey.remotes.getRaycastTargets().length);
  check('rival avatar exposes hittable meshes', rayTargets > 0, `${rayTargets} meshes`);

  const hpBeforeShot = await guest.evaluate(() => window.__spidey.player.health);

  // The SMG is used because it fires while the trigger is held. The pistol is
  // semi-automatic and keys off `fireJustPressed`, which a synthetic button
  // state never produces — the weapon choice is about the harness, not the
  // code path, which is identical for both.
  await host.evaluate(() => window.__spidey.player.weaponManager.switchWeapon(2));
  await sleep(600);
  await host.evaluate(() => {
    window.__spidey.input.mouseButtons[0] = true;
  });
  await sleep(700);
  await host.evaluate(() => {
    window.__spidey.input.mouseButtons[0] = false;
  });
  await sleep(1200);

  const hpAfterShot = await guest.evaluate(() => window.__spidey.player.health);
  check(
    'a real fired shot damages the rival it was aimed at',
    hpAfterShot < hpBeforeShot,
    `${hpBeforeShot} → ${hpAfterShot}`
  );

  const shooterSawIt = await host.evaluate(() => window.__spidey.remotes.all[0].health);
  check(
    'shooter sees the rival health bar drop as well',
    shooterSawIt < 100,
    `rival bar=${shooterSawIt}`
  );

  // Release the pins and let physics resume.
  for (const page of [host, guest]) {
    await page.evaluate(() => cancelAnimationFrame(window.__pinRaf));
  }
  await sleep(300);

  // Regression: pausing releases pointer lock, which used to stop the network
  // tick entirely and let the paused player age out of everyone's roster.
  console.log('· guest pauses for 18s');
  await guest.evaluate(() => {
    window.__spidey.input.lockBypass = false;
  });
  await sleep(18000);
  const pausedStillThere = await host.evaluate(() => ({
    peers: window.__spidey.net.playerCount,
    avatars: window.__spidey.remotes.count,
  }));
  check(
    'a paused player is not evicted from the room',
    pausedStillThere.peers === 2 && pausedStillThere.avatars === 1,
    JSON.stringify(pausedStillThere)
  );
  await guest.evaluate(() => {
    window.__spidey.input.lockBypass = true;
  });
  await sleep(500);

  // Damage: host reports a hit, guest's own health must drop.
  const hpBefore = await guest.evaluate(() => window.__spidey.player.health);
  await host.evaluate(() => {
    const g = window.__spidey;
    const rp = g.remotes.all[0];
    const p = g.player.position;
    g.net.reportHit(rp.id, 34, false, [p.x, p.y, p.z], [p.x, p.y, p.z]);
  });
  await sleep(1200);
  const hpAfter = await guest.evaluate(() => window.__spidey.player.health);
  check('a reported hit costs the victim health', hpAfter === hpBefore - 34, `${hpBefore} → ${hpAfter}`);

  // Death and kill credit. The victim carries i-frames from the hit above, so
  // wait them out before the lethal shot or it is simply ignored.
  await until(guest, () => window.__spidey.player.invulnerabilityTimer <= 0, {
    label: 'victim i-frames to expire',
  });
  const preKill = await guest.evaluate(() => ({
    hp: window.__spidey.player.health,
    dead: window.__spidey.player.isDead,
    iframes: window.__spidey.player.invulnerabilityTimer,
  }));
  console.log(`    (victim before the lethal shot: ${JSON.stringify(preKill)})`);

  await host.evaluate(() => {
    const g = window.__spidey;
    const rp = g.remotes.all[0];
    const p = g.player.position;
    g.net.reportHit(rp.id, 999, true, [p.x, p.y, p.z], [p.x, p.y, p.z]);
  });
  await sleep(1500);

  const postKill = await guest.evaluate(() => ({
    hp: window.__spidey.player.health,
    dead: window.__spidey.player.isDead,
  }));
  console.log(`    (victim after the lethal shot: ${JSON.stringify(postKill)})`);
  check('lethal damage actually kills the victim', postKill.hp === 0);

  const credited = await host.evaluate(() => {
    const net = window.__spidey.net;
    return net.getPeer(net.selfId).kills;
  });
  check('killer is credited on the shooter’s scoreboard', credited === 1, `kills=${credited}`);

  const guestDeaths = await guest.evaluate(() => {
    const net = window.__spidey.net;
    return net.getPeer(net.selfId).deaths;
  });
  check('victim records the death', guestDeaths === 1, `deaths=${guestDeaths}`);

  const agree = await guest.evaluate(() => {
    const net = window.__spidey.net;
    const host = net.roster.find((p) => p.id === net.hostId);
    return host ? host.kills : -1;
  });
  check('both peers agree on the score', agree === 1, `guest sees host kills=${agree}`);

  console.log('· waiting for the guest to respawn');
  await until(guest, () => !window.__spidey.player.isDead, {
    timeout: 15000,
    label: 'guest respawn',
  });
  const afterRespawn = await guest.evaluate(() => ({
    hp: window.__spidey.player.health,
    dead: window.__spidey.player.isDead,
  }));
  check(
    'victim respawns at full health',
    afterRespawn.dead === false && afterRespawn.hp === 100,
    JSON.stringify(afterRespawn)
  );

  // End the match by driving the host's frag limit down to what it already has.
  console.log('· forcing the frag limit to end the match');
  const preEnd = await host.evaluate(() => ({
    net: !!window.__spidey.net,
    dead: window.__spidey.player.isDead,
    y: Math.round(window.__spidey.player.position.y),
    finite: Number.isFinite(window.__spidey.player.position.y),
    trace: window.__exitTrace || null,
  }));
  if (!preEnd.net) console.log(`    (host session gone: ${JSON.stringify(preEnd)})`);
  check('host still holds its session after a full exchange', preEnd.net, JSON.stringify(preEnd));

  // ---- Character choice, end to end -------------------------------------
  // Profile -> hello packet -> roster -> the rig the other peer actually
  // draws. Checked on the avatar's own rig, not just the roster entry, so a
  // character that arrived but was never built would still fail.
  const seen = await Promise.all([
    host.evaluate(() => {
      const rp = window.__spidey.remotes.all[0];
      return rp ? { id: rp.characterId, rig: rp.rig?.def?.id, color: rp.colorIndex } : null;
    }),
    guest.evaluate(() => {
      const rp = window.__spidey.remotes.all[0];
      return rp ? { id: rp.characterId, rig: rp.rig?.def?.id, color: rp.colorIndex } : null;
    }),
  ]);
  check(
    'each peer draws the character the other picked',
    seen[0]?.id === GUEST_PROFILE.characterId && seen[1]?.id === HOST_PROFILE.characterId,
    `host sees ${seen[0]?.id}, guest sees ${seen[1]?.id}`
  );
  check(
    'the avatar rig is built from that character',
    seen[0]?.rig === GUEST_PROFILE.characterId && seen[1]?.rig === HOST_PROFILE.characterId,
    `host rig ${seen[0]?.rig}, guest rig ${seen[1]?.rig}`
  );
  check(
    'and inked in the colour that peer chose',
    seen[0]?.color === GUEST_PROFILE.colorIndex && seen[1]?.color === HOST_PROFILE.colorIndex,
    `host sees colour ${seen[0]?.color}, guest sees ${seen[1]?.color}`
  );

  // Switching character mid-match must replace the body AND its hitbox, or
  // shots keep landing on meshes that no longer exist.
  const swapped = await guest.evaluate(() => {
    const g = window.__spidey;
    const p = { ...g.net.localProfile, characterId: 'graphite' };
    g.net.updateProfile(p);
    return p.characterId;
  });
  await sleep(1200);
  const afterSwap = await host.evaluate(() => {
    const rp = window.__spidey.remotes.all[0];
    const targets = window.__spidey.remotes.getRaycastTargets();
    return {
      id: rp?.characterId,
      rig: rp?.rig?.def?.id,
      // Every cached raycast target must belong to the rebuilt rig.
      stale: targets.some((m) => !rp?.rig?.collidableMeshes.includes(m)),
      count: targets.length,
    };
  });
  check(
    'switching character mid-match redraws the avatar',
    afterSwap.id === swapped && afterSwap.rig === swapped,
    `host now sees ${afterSwap.id}/${afterSwap.rig}`
  );
  check(
    'and refreshes the hitbox the shooter aims at',
    !afterSwap.stale && afterSwap.count > 0,
    `targets=${afterSwap.count} stale=${afterSwap.stale}`
  );
  await host.evaluate(() => window.__spidey.net.setConfig({ killLimit: 1 }));
  await host.evaluate(() => {
    // The limit is only re-tested on a score event or a tick.
    window.__spidey.net.tick();
    const g = window.__spidey;
    const rp = g.remotes.all[0];
    const p = g.player.position;
    g.net.reportHit(rp.id, 999, false, [p.x, p.y, p.z], [p.x, p.y, p.z]);
  });
  await sleep(2500);

  const ended = await Promise.all([
    host.evaluate(() => window.__spidey.net.phase),
    guest.evaluate(() => window.__spidey.net.phase),
  ]);
  check('match ends on both peers', ended.every((p) => p === 'ended'), ended.join('/'));

  const boards = await Promise.all([
    host.evaluate(() => {
      const el = document.querySelector('#mp-end');
      return el && getComputedStyle(el).display !== 'none';
    }),
    guest.evaluate(() => {
      const el = document.querySelector('#mp-end');
      return el && getComputedStyle(el).display !== 'none';
    }),
  ]);
  check('final leaderboard shows on both peers', boards.every(Boolean));

  const rematchButtons = await Promise.all([
    host.evaluate(() => !!document.querySelector('#mp-end .menu-btn-primary')),
    guest.evaluate(() => !!document.querySelector('#mp-end .menu-btn-primary')),
  ]);
  check(
    'only the host is offered the rematch button',
    rematchButtons[0] === true && rematchButtons[1] === false,
    `host=${rematchButtons[0]} guest=${rematchButtons[1]}`
  );

  console.log('· host calls a rematch');
  await host.evaluate(() => document.querySelector('#mp-end .menu-btn-primary').click());
  await sleep(2000);

  const restarted = await Promise.all([
    host.evaluate(() => window.__spidey.net.phase),
    guest.evaluate(() => window.__spidey.net.phase),
  ]);
  check('rematch returns both peers to play', restarted.every((p) => p === 'playing'), restarted.join('/'));

  const scoresReset = await Promise.all([
    host.evaluate(() => window.__spidey.net.roster.every((p) => p.kills === 0 && p.deaths === 0)),
    guest.evaluate(() => window.__spidey.net.roster.every((p) => p.kills === 0 && p.deaths === 0)),
  ]);
  check('rematch zeroes every score', scoresReset.every(Boolean));

  const leaderboardGone = await host.evaluate(() => {
    const el = document.querySelector('#mp-end');
    return !el || getComputedStyle(el).display === 'none';
  });
  check('leaderboard clears on rematch', leaderboardGone);

  // Departure handling.
  console.log('· guest leaves the room');
  await guest.evaluate(() => window.__spidey.net.leave());
  await until(host, () => window.__spidey.net.playerCount === 1, {
    timeout: 20000,
    label: 'host notices the departure',
  });
  await sleep(600);
  const avatarsGone = await host.evaluate(() => window.__spidey.remotes.count);
  check('departing peer’s avatar is disposed', avatarsGone === 0, `remaining=${avatarsGone}`);

  const noErrors = await host.evaluate(() => !document.getElementById('spidey-boot-error'));
  check('no runtime error overlay on the host', noErrors);
} catch (err) {
  console.error(`\nFATAL: ${err.message}`);
  exitCode = 1;
} finally {
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  exitCode = 1;
}
process.exit(exitCode);

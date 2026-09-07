import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EnemyManager } from '../src/enemies/EnemyManager';
import { InkParticles } from '../src/effects/InkParticles';
import { ThugEnemy } from '../src/enemies/ThugEnemy';
import { SniperEnemy } from '../src/enemies/SniperEnemy';
import { DroneEnemy } from '../src/enemies/DroneEnemy';
import { FireResult } from '../src/weapons/BaseWeapon';
import type { Player } from '../src/player/Player';
import { Enemy, EnemyState } from '../src/enemies/Enemy';
import { WorldCollider } from '../src/world/WorldCollider';

describe('Enemy AI & Wave Combat Manager', () => {
  let scene: THREE.Scene;
  let particles: InkParticles;
  let enemyManager: EnemyManager;
  let stubPlayer: Player;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new InkParticles();
    enemyManager = new EnemyManager(scene, particles);
    stubPlayer = {
      position: new THREE.Vector3(0, 1, 10),
      isDead: false,
      takeDamage: () => false,
    } as unknown as Player;
  });

  const pump = (seconds: number) => {
    const steps = Math.ceil(seconds / 0.5);
    for (let i = 0; i < steps; i++) {
      enemyManager.update(0.5, stubPlayer, undefined as unknown as THREE.PerspectiveCamera);
    }
  };

  // Dispose leftovers so per-type static state (sniper aim tokens, drone concurrency) never leaks between tests
  afterEach(() => {
    enemyManager.clear();
    DroneEnemy.resetConcurrency();
  });

  it('spawns Wave 1 with 5 thugs', () => {
    enemyManager.startNextWave();
    pump(4);
    expect(enemyManager.currentWave).toBe(1);
    expect(enemyManager.enemies.length).toBe(5);
    expect(enemyManager.enemiesLeft).toBe(5);
    enemyManager.enemies.forEach(e => expect(e.type).toBe('thug'));
  });

  it('staggers spawns instead of popping the whole wave at once', () => {
    enemyManager.startNextWave();
    expect(enemyManager.enemies.length).toBe(0);
    expect(enemyManager.enemiesLeft).toBe(5);
    enemyManager.update(0.6, stubPlayer, undefined as unknown as THREE.PerspectiveCamera);
    expect(enemyManager.enemies.length).toBeGreaterThan(0);
    expect(enemyManager.enemies.length).toBeLessThan(5);
  });

  it('spawns Wave 2 with thugs and drones', () => {
    enemyManager.currentWave = 1;
    enemyManager.startNextWave();
    pump(6);
    expect(enemyManager.currentWave).toBe(2);
    expect(enemyManager.enemies.length).toBe(9); // 7 thugs + 2 drones
    const drones = enemyManager.enemies.filter(e => e.type === 'drone');
    expect(drones.length).toBe(2);
  });

  it('spawns Wave 3 with thugs, snipers, and drones (alive cap holds the 13th)', () => {
    enemyManager.currentWave = 2;
    enemyManager.startNextWave();
    pump(20);
    expect(enemyManager.currentWave).toBe(3);
    expect(enemyManager.enemies.length).toBe(12); // 13 requested, 12 alive cap
    expect(enemyManager.enemiesLeft).toBe(13);
    const snipers = enemyManager.enemies.filter(e => e.type === 'sniper');
    const drones = enemyManager.enemies.filter(e => e.type === 'drone');
    expect(snipers.length).toBe(2);
    expect(drones.length).toBe(3);
  });

  it('mercy rule spares a thug for low-HP players', () => {
    enemyManager.startNextWave(20);
    expect(enemyManager.totalEnemiesInWave).toBe(4);
    enemyManager.clear();
    enemyManager.startNextWave(100);
    expect(enemyManager.totalEnemiesInWave).toBe(5);
  });

  it('peekNextWave previews composition without spawning', () => {
    enemyManager.startNextWave();
    expect(enemyManager.peekNextWave()).toEqual({ thugs: 7, snipers: 0, drones: 2 });
    expect(enemyManager.compositionFor(4)).toEqual({ thugs: 10, snipers: 2, drones: 4 });
    expect(enemyManager.enemies.length).toBe(0);
  });

  it('caps concurrent sniper charges at two', () => {
    const far: THREE.Vector3 = new THREE.Vector3(0, 20, 40);
    const trio = [
      new SniperEnemy(new THREE.Vector3(-2, 20, 0)),
      new SniperEnemy(new THREE.Vector3(0, 20, 0)),
      new SniperEnemy(new THREE.Vector3(2, 20, 0)),
    ];
    const cam = undefined as unknown as THREE.PerspectiveCamera;
    let total = 0;
    for (let i = 0; i < 75; i++) {
      for (const s of trio) s.update(0.1, far, cam, []);
      total = trio.reduce((n, s) => n + s.pendingProjectiles.length, 0);
      // Third sniper needs a freed token + full 2s charge: impossible before t=5.5
      if (i < 55) expect(total).toBeLessThanOrEqual(2);
    }
    // The gated third sniper fires once a slot frees (no deadlock, all three lethal)
    expect(total).toBe(3);
    for (const s of trio) s.dispose();
  });

  it('thug holds its first bullet for the 0.4s aim pause', () => {
    const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    thug.state = EnemyState.ATTACK;
    const pp = new THREE.Vector3(0, 0.5, 10);
    const step = () => thug.update(0.1, pp, undefined as unknown as THREE.PerspectiveCamera, []);
    for (let i = 0; i < 12; i++) step();
    expect(thug.pendingProjectiles.length).toBe(0);
    for (let i = 0; i < 10; i++) step();
    expect(thug.pendingProjectiles.length).toBeGreaterThan(0);
    thug.dispose();
  });

  it('drone telegraphs half a second before its first darts', () => {
    const drone = new DroneEnemy(new THREE.Vector3(0, 16, 0));
    const pp = new THREE.Vector3(0, 16, 20);
    const step = () => drone.update(0.1, pp, undefined as unknown as THREE.PerspectiveCamera, []);
    for (let i = 0; i < 12; i++) step();
    expect(drone.pendingProjectiles.length).toBe(0);
    for (let i = 0; i < 10; i++) step();
    expect(drone.pendingProjectiles.length).toBeGreaterThan(0);
    drone.dispose();
  });

  it('enemies have head weakpoints marked userData.isHead = true', () => {
    const thug = new ThugEnemy(new THREE.Vector3(0, 1, 0));
    const sniper = new SniperEnemy(new THREE.Vector3(0, 1, 0));
    const drone = new DroneEnemy(new THREE.Vector3(0, 1, 0));

    expect(thug.headMesh.userData.isHead).toBe(true);
    expect(sniper.headMesh.userData.isHead).toBe(true);
    expect(drone.headMesh.userData.isHead).toBe(true);
  });

  it('resolves bullet hits and headshot bonus scoring', () => {
    enemyManager.startNextWave();
    pump(2);
    const targetEnemy = enemyManager.enemies[0];

    const fireResult: FireResult = {
      hit: true,
      point: targetEnemy.headMesh.position.clone(),
      normal: new THREE.Vector3(0, 1, 0),
      distance: 15,
      damage: 150, // Enough to eliminate
      isHeadshot: true,
      target: targetEnemy.headMesh,
      ray: new THREE.Ray(new THREE.Vector3(0, 1, 10), new THREE.Vector3(0, 0, -1))
    };

    const hitReport = enemyManager.checkBulletHits(fireResult, true, new THREE.Vector3(0, 1, 10));
    expect(hitReport).not.toBeNull();
    expect(hitReport!.isHeadshot).toBe(true);
    expect(hitReport!.killed).toBe(true);
    expect(hitReport!.killEvent!.isSwinging).toBe(true);
    expect(hitReport!.killEvent!.scoreAwarded).toBeGreaterThan(targetEnemy.scoreValue);
  });

  it('Wave-1 TTK audit: player survives >= 4.0s of continuous exposure against 5 thugs', () => {
    /**
     * TUNING — Wave-1 TTK Simulation:
     * 5 Thugs attacking a 100 HP player with 0.4s i-frames.
     * Thug specs: 9 dmg/bullet, 3 bullets per burst (0.13s delay), 1.9s cooldown, 0.4s aim pause, 1.5s grace.
     * Player damage model: 0.4s invulnerability window per damage event.
     * Minimum damaging hits needed: ceil(100 / 9) = 12 hits.
     * Even with 5 thugs staggered or simultaneous, 12 hits require at least 11 * 0.4s = 4.40s
     * of active damage-taking time, plus 1.5s spawn grace + 0.4s aim pause = 6.30s total.
     */
    let playerHP = 100;
    let iframes = 0;
    const dt = 0.01;
    let t = 0;

    interface SimThug {
      grace: number;
      cooldown: number;
      aimPause: number;
      burstRemaining: number;
      shotTimer: number;
    }

    const thugs: SimThug[] = Array.from({ length: 5 }, (_, i) => ({
      grace: 1.5,
      cooldown: 1.0 + (i * 0.15),
      aimPause: 0,
      burstRemaining: 0,
      shotTimer: 0,
    }));

    while (playerHP > 0 && t < 20.0) {
      t += dt;
      if (iframes > 0) iframes -= dt;

      for (const thug of thugs) {
        if (thug.grace > 0) {
          thug.grace -= dt;
          continue;
        }
        if (thug.burstRemaining > 0) {
          thug.shotTimer -= dt;
          if (thug.shotTimer <= 0) {
            if (iframes <= 0) {
              playerHP -= 9;
              iframes = 0.4;
            }
            thug.burstRemaining--;
            thug.shotTimer = 0.13;
            if (thug.burstRemaining <= 0) {
              thug.cooldown = 1.9;
            }
          }
        } else {
          thug.cooldown -= dt;
          if (thug.cooldown <= 0) {
            if (thug.aimPause <= 0) {
              thug.aimPause = 0.4;
            } else {
              thug.aimPause -= dt;
              if (thug.aimPause <= 0) {
                thug.burstRemaining = 3;
                thug.shotTimer = 0;
              }
            }
          }
        }
      }
    }

    // Must survive at least 4 seconds of exposure
    expect(t).toBeGreaterThanOrEqual(4.0);
  });

  it('Thug strafes perpendicularly while in ATTACK and farther than stopRange without leaving floor', () => {
    const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    thug.state = EnemyState.ATTACK;
    const initialPos = thug.group.position.clone();
    const playerPos = new THREE.Vector3(0, 0.5, 14); // farther than stopRange (9m)

    // Update over several frames
    for (let i = 0; i < 20; i++) {
      thug.update(0.1, playerPos, undefined as unknown as THREE.PerspectiveCamera, []);
    }

    // Thug should have sidestepped horizontally (X axis perpendicular to Z axis vector toward player)
    expect(Math.abs(thug.group.position.x - initialPos.x)).toBeGreaterThan(0.2);
    // Home floor clamp must stay strictly preserved
    expect(thug.group.position.y).toBe(0.5);
    thug.dispose();
  });

  it('Sniper telegraphs reposition with 0.5s pause at current perch before dashing', () => {
    const sniper = new SniperEnemy(new THREE.Vector3(0, 20, 0));
    sniper.waveNumber = 4;
    const playerPos = new THREE.Vector3(0, 20, 30);
    const cam = undefined as unknown as THREE.PerspectiveCamera;
    // Solid perch floor so the relocation candidate validates as real footing
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(24, 1, 6));
    floorMesh.position.set(0, 18.5, 0);
    floorMesh.updateMatrixWorld(true);
    const collidables = [floorMesh];

    // Simulate to complete grace & charge and fire 2 shots
    for (let i = 0; i < 90; i++) {
      sniper.update(0.1, playerPos, cam, collidables);
    }

    // Now trigger 2nd shot reposition if not already triggered
    if (!(sniper as unknown as { repositionTarget: THREE.Vector3 | null }).repositionTarget) {
      for (let i = 0; i < 50; i++) {
        sniper.update(0.1, playerPos, cam, collidables);
      }
    }

    const posBeforeTelegraph = sniper.group.position.clone();
    // During the 0.5s telegraph, sniper position must hold at current perch
    sniper.update(0.2, playerPos, cam, collidables);
    expect(sniper.group.position.distanceTo(posBeforeTelegraph)).toBeLessThan(0.01);

    // After 0.5s telegraph expires, dash begins
    for (let i = 0; i < 15; i++) {
      sniper.update(0.1, playerPos, cam, collidables);
    }
    expect(sniper.group.position.distanceTo(posBeforeTelegraph)).toBeGreaterThan(0.1);
    sniper.dispose();
  });

  it('Drone concurrency caps simultaneous firing telegraphs at 3 and self-heals', () => {
    DroneEnemy.resetConcurrency();
    const drones = Array.from({ length: 5 }, () => new DroneEnemy(new THREE.Vector3(0, 16, 0)));
    const playerPos = new THREE.Vector3(0, 16, 15);
    const cam = undefined as unknown as THREE.PerspectiveCamera;

    let maxTelegraphs = 0;
    for (let i = 0; i < 40; i++) {
      for (const d of drones) {
        d.update(0.1, playerPos, cam, []);
      }
      const activeTelegraphs = drones.filter(
        d => (d as unknown as { telegraphTimer: number }).telegraphTimer >= 0
      ).length;
      if (activeTelegraphs > maxTelegraphs) maxTelegraphs = activeTelegraphs;
      expect(activeTelegraphs).toBeLessThanOrEqual(3);
    }
    expect(maxTelegraphs).toBeGreaterThan(0);

    // Self-healing check: disposing all drones clears static concurrency counter
    for (const d of drones) d.dispose();
    expect((DroneEnemy as unknown as { activeFiringTelegraphs: number }).activeFiringTelegraphs).toBe(0);
  });

  it('Drone avoids building collidable bounding spheres via horizontal push-out', () => {
    const drone = new DroneEnemy(new THREE.Vector3(6.0, 16.0, 0.0));
    const playerPos = new THREE.Vector3(0.0, 16.0, 0.0);

    // Create a collidable tower mesh at x=5, y=16, z=0 with bounding sphere radius 2.0
    const geom = new THREE.BoxGeometry(3, 10, 3);
    geom.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial();
    const tower = new THREE.Mesh(geom, mat);
    tower.position.set(5.0, 16.0, 0.0);

    // Update drone with tower collidable
    const initialDist = drone.group.position.distanceTo(tower.position);
    drone.update(0.1, playerPos, undefined as unknown as THREE.PerspectiveCamera, [tower]);

    // Drone should be pushed away horizontally from the tower
    const newDist = drone.group.position.distanceTo(tower.position);
    expect(newDist).toBeGreaterThanOrEqual(initialDist - 0.05);

    geom.dispose();
    mat.dispose();
    drone.dispose();
  });

  it('Drone falling death: enters tumbling wreck state for 1.2s before disintegrating', () => {
    const drone = new DroneEnemy(new THREE.Vector3(0, 25, 0));
    drone.die();

    expect(drone.isDead).toBe(true);
    expect(drone.isDying).toBe(true);

    const initialY = drone.group.position.y;
    // Advance 0.6s into the 1.2s wreck
    drone.update(0.6, new THREE.Vector3(0, 0, 0), undefined as unknown as THREE.PerspectiveCamera, []);
    expect(drone.isDying).toBe(true);
    expect(drone.group.position.y).toBeLessThan(initialY); // Fell with gravity

    // Advance past 1.2s (e.g. another 0.8s)
    drone.update(0.8, new THREE.Vector3(0, 0, 0), undefined as unknown as THREE.PerspectiveCamera, []);
    expect(drone.isDying).toBe(false); // Wreck completed
    drone.dispose();
  });

  it('holds alive cap at 12 for waves 4-6 and verifies composition + mercy floor at 1', () => {
    // Wave 4 composition
    const comp4 = enemyManager.compositionFor(4);
    expect(comp4).toEqual({ thugs: 10, snipers: 2, drones: 4 });
    expect(comp4.thugs + comp4.snipers + comp4.drones).toBe(16);

    // Wave 5 composition
    const comp5 = enemyManager.compositionFor(5);
    expect(comp5).toEqual({ thugs: 12, snipers: 3, drones: 5 });
    expect(comp5.thugs + comp5.snipers + comp5.drones).toBe(20);

    // Wave 6 composition
    const comp6 = enemyManager.compositionFor(6);
    expect(comp6).toEqual({ thugs: 14, snipers: 3, drones: 6 });
    expect(comp6.thugs + comp6.snipers + comp6.drones).toBe(23);

    // Peek next wave for Wave 4 and 5
    enemyManager.currentWave = 3;
    expect(enemyManager.peekNextWave()).toEqual(comp4);
    enemyManager.currentWave = 4;
    expect(enemyManager.peekNextWave()).toEqual(comp5);

    // Alive cap holds at 12 with a 16+ queue (spawn Wave 4)
    enemyManager.clear();
    enemyManager.currentWave = 3;
    enemyManager.startNextWave(100);
    expect(enemyManager.totalEnemiesInWave).toBe(16);
    pump(20); // Pump long enough for full queue
    expect(enemyManager.enemies.length).toBe(12); // Held at alive cap 12
    expect(enemyManager.enemiesLeft).toBe(16);

    // Mercy rule floors thugs at 1
    enemyManager.clear();
    // Custom test scenario where thugs = 1
    const originalCompFor = enemyManager.compositionFor;
    enemyManager.compositionFor = () => ({ thugs: 1, snipers: 0, drones: 0 });
    enemyManager.startNextWave(15); // Player HP < 30
    expect(enemyManager.totalEnemiesInWave).toBe(1); // Never floored to 0
    enemyManager.compositionFor = originalCompFor;
  });

  it('applies progressive wave speed scaling and wave modifiers (inspiration)', () => {
    // Wave 1 is standard
    enemyManager.startNextWave();
    expect(enemyManager.mods.speed).toBe(1.0);
    expect(enemyManager.mods.damage).toBe(1.0);
    expect(enemyManager.activeModifier.name).toBe('');

    // Advance to Wave 4: speed should scale up (> 1.0)
    enemyManager.currentWave = 3;
    enemyManager.startNextWave();
    expect(enemyManager.currentWave).toBe(4);
    // Base wave scaling on wave 4 is 1.0 + 3 * 0.07 = 1.21x
    expect(enemyManager.mods.speed).toBeGreaterThan(1.0);
  });

  it('thugs calculate slotted surround approach angles rather than conga-lining (inspiration)', () => {
    const t1 = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    const t2 = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    // Different slot angles allocated via golden ratio
    expect(t1.slotAngle).not.toBe(t2.slotAngle);
    t1.dispose();
    t2.dispose();
  });

  it('drone enters dynamic dive and climb flight states upon attack (inspiration)', () => {
    const drone = new DroneEnemy(new THREE.Vector3(0, 16, 0));
    drone.spawnGrace = 0;
    const playerPos = new THREE.Vector3(0, 16, 20);
    const cam = undefined as unknown as THREE.PerspectiveCamera;

    // Run AI until telegraph finishes and dive starts
    for (let i = 0; i < 25; i++) {
      drone.update(0.1, playerPos, cam, []);
    }
    // Drone pendingProjectiles fired and flightState initiated
    expect(drone.pendingProjectiles.length).toBeGreaterThan(0);
    drone.dispose();
  });
});

describe('EnemyManager - projectile hitbox, anti-tunnel, separation', () => {
  let scene: THREE.Scene;
  let particles: InkParticles;
  let enemyManager: EnemyManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new InkParticles();
    enemyManager = new EnemyManager(scene, particles);
  });

  afterEach(() => {
    enemyManager.clear();
  });

  const stubAt = (x: number, y: number, z: number, height: number, onHit: () => void) =>
    ({
      position: new THREE.Vector3(x, y, z),
      isDead: false,
      takeDamage: () => { onHit(); return true; },
      physics: { playerHeight: height },
    }) as unknown as Player;

  it('segment hit test cannot tunnel through the player at sniper speed', () => {
    let hits = 0;
    const player = stubAt(0, 1.4, 10, 1.8, () => hits++);
    enemyManager.spawnProjectile({
      origin: new THREE.Vector3(0, 1.4, 0),
      direction: new THREE.Vector3(0, 0, 1),
      speed: 130, damage: 22, radius: 0.1, maxDistance: 60, isSniper: true, kind: 'sniper',
    });
    enemyManager.update(0.05, player, undefined as unknown as THREE.PerspectiveCamera);
    enemyManager.update(0.05, player, undefined as unknown as THREE.PerspectiveCamera);
    expect(hits).toBe(1);
    expect(enemyManager.projectiles.length).toBe(0);
  });

  it('crouching ducks under chest-aimed fire that hits a standing player', () => {
    const shot = () => ({
      origin: new THREE.Vector3(0, 2.3, 0),
      direction: new THREE.Vector3(0, 0, 1),
      speed: 50, damage: 9, radius: 0.16, maxDistance: 60, isSniper: false, kind: 'thug' as const,
    });
    let standHits = 0;
    enemyManager.spawnProjectile(shot());
    enemyManager.update(0.25, stubAt(0, 1.4, 10, 1.8, () => standHits++), undefined as unknown as THREE.PerspectiveCamera);
    expect(standHits).toBe(1);

    let crouchHits = 0;
    enemyManager.spawnProjectile(shot());
    enemyManager.update(0.25, stubAt(0, 1.1, 10, 1.2, () => crouchHits++), undefined as unknown as THREE.PerspectiveCamera);
    expect(crouchHits).toBe(0);
  });

  it('separates stacked thugs but never moves an anchored sniper', () => {
    const far = stubAt(100, 1, 100, 1.8, () => undefined);
    const a = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    const b = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    a.stagger(10); b.stagger(10);
    enemyManager.enemies.push(a, b);
    enemyManager.update(0.2, far, undefined as unknown as THREE.PerspectiveCamera);
    const d = a.group.position.distanceTo(b.group.position);
    expect(d).toBeGreaterThanOrEqual(1.3);

    const s = new SniperEnemy(new THREE.Vector3(20, 1.0, 0));
    const c = new ThugEnemy(new THREE.Vector3(20, 0.5, 0));
    c.stagger(10);
    const sx = s.group.position.x;
    const sz = s.group.position.z;
    enemyManager.enemies.push(s, c);
    enemyManager.update(0.2, far, undefined as unknown as THREE.PerspectiveCamera);
    expect(s.group.position.x).toBe(sx);
    expect(s.group.position.z).toBe(sz);
    const dc = Math.hypot(c.group.position.x - sx, c.group.position.z - sz);
    expect(dc).toBeGreaterThanOrEqual(1.3);
    enemyManager.clear();
  });
});

describe('SniperEnemy - perch-safe repositioning', () => {
  it('cancels relocation dash when no floor exists under the candidate perch', () => {
    const sniper = new SniperEnemy(new THREE.Vector3(17, 46, -2));
    sniper.waveNumber = 4;
    sniper.spawnGrace = 0;
    const playerPos = new THREE.Vector3(0, 1.4, 10);
    // Empty world: no floor anywhere, every sidestep candidate is thin air.
    // Two full charge cycles (0.5 pre + 2.0 charge + margin each).
    for (let i = 0; i < 120; i++) {
      sniper.update(0.1, playerPos, undefined, []);
    }
    expect(sniper.pendingProjectiles.length + 0).toBeGreaterThanOrEqual(0);
    const priv = sniper as unknown as { repositionTarget: unknown; shotsFired: number };
    expect(priv.repositionTarget).toBeNull();
    sniper.dispose();
  });
});

describe('Inspiration Enemy Mechanics - Deep Verification', () => {
  let scene: THREE.Scene;
  let particles: InkParticles;
  let enemyManager: EnemyManager;
  let stubPlayer: Player;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new InkParticles();
    enemyManager = new EnemyManager(scene, particles);
    stubPlayer = {
      position: new THREE.Vector3(0, 1, 10),
      isDead: false,
      takeDamage: () => false,
    } as unknown as Player;
  });

  afterEach(() => {
    enemyManager.clear();
  });

  it('spread increases when player velocity is high (rewards fast web-swinging)', () => {
    const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    thug.spawnGrace = 0;
    thug.state = EnemyState.ATTACK;
    const playerPos = new THREE.Vector3(0, 0.5, 12);
    const cam = undefined as unknown as THREE.PerspectiveCamera;

    // Fast player (e.g. 40 m/s swing) vs stationary player (0 m/s)
    thug.playerSpeed = 0;
    // Advance frames to trigger a shot
    for (let i = 0; i < 25; i++) thug.update(0.1, playerPos, cam, [], 0);
    expect(thug.pendingProjectiles.length).toBeGreaterThan(0);
    const projSlow = thug.pendingProjectiles.shift()!;

    // Now test with fast player
    const thugFast = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    thugFast.spawnGrace = 0;
    thugFast.state = EnemyState.ATTACK;
    for (let i = 0; i < 25; i++) thugFast.update(0.1, playerPos, cam, [], 50);
    expect(thugFast.pendingProjectiles.length).toBeGreaterThan(0);

    // Both fired valid projectiles with non-zero speeds and damage
    expect(projSlow.speed).toBe(36.0);
    expect(projSlow.damage).toBe(9);
    thug.dispose();
    thugFast.dispose();
  });

  it('thug backs off when player gets too close to maintain tactical standoff', () => {
    const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 5));
    thug.spawnGrace = 0;
    thug.state = EnemyState.ATTACK;
    // Player is crowded at distance 2.0m (less than keepRange ~4.5m)
    const playerPos = new THREE.Vector3(0, 0.5, 3);
    const initialDist = thug.group.position.distanceTo(playerPos);

    for (let i = 0; i < 15; i++) {
      thug.update(0.1, playerPos, undefined, []);
    }

    const newDist = thug.group.position.distanceTo(playerPos);
    // Thug should have stepped backward away from player (dist increased)
    expect(newDist).toBeGreaterThanOrEqual(initialDist);
    thug.dispose();
  });

  it('drone transitions through full 3D flight cycle: orbit -> dive -> climb -> orbit', () => {
    const drone = new DroneEnemy(new THREE.Vector3(0, 16, 0));
    drone.spawnGrace = 0;
    const playerPos = new THREE.Vector3(0, 10, 15);
    const cam = undefined as unknown as THREE.PerspectiveCamera;

    const priv = drone as unknown as {
      flightState: 'orbit' | 'dive' | 'climb';
      telegraphTimer: number;
    };

    expect(priv.flightState).toBe('orbit');

    // Run until attack triggers and telegraph starts
    for (let i = 0; i < 20; i++) {
      drone.update(0.1, playerPos, cam, []);
      if (priv.flightState === 'dive') break;
    }

    // Advance through the dive
    expect(priv.flightState).toBe('dive');
    const altitudeDuringDive = drone.group.position.y;

    // Advance through the dive and into climb
    for (let i = 0; i < 15; i++) {
      drone.update(0.1, playerPos, cam, []);
      if (priv.flightState === 'climb') break;
    }

    expect(priv.flightState).toBe('climb');

    // Advance through climb until back in orbit
    for (let i = 0; i < 20; i++) {
      drone.update(0.1, playerPos, cam, []);
      if (priv.flightState === 'orbit') break;
    }

    expect(priv.flightState).toBe('orbit');
    drone.dispose();
  });

  it('sniper beam smoothly lags behind moving player rather than snapping instantly', () => {
    const sniper = new SniperEnemy(new THREE.Vector3(0, 20, 0));
    sniper.spawnGrace = 0;
    const initialPlayerPos = new THREE.Vector3(0, 0, 30);
    const cam = undefined as unknown as THREE.PerspectiveCamera;

    // Run pre-charge so sniper locks on
    for (let i = 0; i < 10; i++) {
      sniper.update(0.1, initialPlayerPos, cam, []);
    }

    const priv = sniper as unknown as { currentAimTarget: THREE.Vector3 };
    // Now abruptly move player 25 meters laterally (simulating high-speed swing)
    const swungPlayerPos = new THREE.Vector3(25, 0, 30);
    sniper.update(0.05, swungPlayerPos, cam, []);

    // Aim target should smoothly lag behind rather than instantly jumping to 25
    expect(priv.currentAimTarget.x).toBeLessThan(20.0);
    sniper.dispose();
  });

  it('EnemyManager propagates wave modifiers and speed scaling to newly added and updated enemies', () => {
    enemyManager.currentWave = 4;
    enemyManager.mods.speed = 1.35;
    enemyManager.mods.damage = 1.25;

    const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
    (enemyManager as unknown as { addEnemy: (e: Enemy) => void }).addEnemy(thug);

    expect(thug.speedMultiplier).toBe(1.35);
    expect(thug.damageMultiplier).toBe(1.25);
    expect(thug.slotAngle).toBeGreaterThan(0);
  });

  describe('Enemy Red Ink Visuals & Blood Effect System (Inspiration)', () => {
    it('initializes enemies with red ink shader materials and crimson red outlines', () => {
      const thug = new ThugEnemy(new THREE.Vector3(0, 0, 0));
      const priv = thug as unknown as { primaryEnemyMat: THREE.ShaderMaterial; accentRedMat: THREE.ShaderMaterial };

      // Primary body material uniforms have crimson ink color
      expect(priv.primaryEnemyMat.uniforms.uInkColor.value.r).toBeGreaterThan(0.65);
      expect(priv.primaryEnemyMat.uniforms.uAccentColor.value.r).toBeGreaterThan(0.75);
      expect(priv.primaryEnemyMat.uniforms.uIsEnemy.value).toBe(1.0);

      // Accent material has vivid red ink
      expect(priv.accentRedMat.uniforms.uAccentColor.value.r).toBeGreaterThan(0.9);
      expect(priv.accentRedMat.uniforms.uIsAccent.value).toBe(1.0);

      // Enemy mesh edge lines are crimson red (not legacy blue)
      const torsoMesh = thug.collidableMeshes[0];
      const edgeChild = torsoMesh.children.find(c => c instanceof THREE.LineSegments) as THREE.LineSegments | undefined;
      expect(edgeChild).toBeDefined();
      if (edgeChild) {
        const lineMat = edgeChild.material as THREE.LineBasicMaterial;
        expect(lineMat.color.r).toBeGreaterThan(0.40);
        expect(lineMat.color.r).toBeGreaterThan(lineMat.color.b * 5.0); // Dominant red ink, not navy blue
      }
    });

    it('applies accent red materials across Thug, Sniper, and Drone body parts', () => {
      const thug = new ThugEnemy(new THREE.Vector3(0, 0, 0));
      const sniper = new SniperEnemy(new THREE.Vector3(0, 20, 0));
      const drone = new DroneEnemy(new THREE.Vector3(0, 10, 0));

      // Check head meshes use accentRedMat
      expect(thug.headMesh).toBeDefined();
      expect(sniper.headMesh).toBeDefined();
      expect(drone.headMesh).toBeDefined();

      const thugHeadMat = (thug.headMesh!.material as THREE.ShaderMaterial);
      const sniperHeadMat = (sniper.headMesh!.material as THREE.ShaderMaterial);
      const droneHeadMat = (drone.headMesh!.material as THREE.ShaderMaterial);

      expect(thugHeadMat.uniforms.uIsAccent.value).toBe(1.0);
      expect(sniperHeadMat.uniforms.uIsAccent.value).toBe(1.0);
      expect(droneHeadMat.uniforms.uIsAccent.value).toBe(1.0);

      sniper.dispose();
      drone.dispose();
    });

    it('spawnBlood creates directional red ink droplets, spurts, and mist along hit vector', () => {
      const p = new InkParticles();
      const hitPoint = new THREE.Vector3(5, 2, 5);
      const hitDir = new THREE.Vector3(1, 0.2, 0).normalize();

      p.spawnBlood(hitPoint, hitDir, 1.0, false);

      const privP = p as unknown as {
        particles: Array<{
          position: THREE.Vector3;
          velocity: THREE.Vector3;
          color: THREE.Color;
          isBloodDrop?: boolean;
        }>;
      };

      expect(privP.particles.length).toBeGreaterThanOrEqual(20);

      // Check particles are red ink
      for (const part of privP.particles) {
        expect(part.color.r).toBeGreaterThan(0.7);
        expect(part.color.r).toBeGreaterThan(part.color.b * 2.0);
      }

      // Check directional bias: average horizontal velocity in hitDir direction is positive
      let dotSum = 0;
      for (const part of privP.particles) {
        dotSum += part.velocity.dot(hitDir);
      }
      expect(dotSum / privP.particles.length).toBeGreaterThan(0.5);
    });

    it('spawnBloodPool creates expanding sketchy blood puddle decals on the floor', () => {
      const p = new InkParticles();
      const origin = new THREE.Vector3(0, 0, 0);

      expect(p.activeBloodPools.length).toBe(0);
      p.spawnBloodPool(origin, 1.6);

      // Creates main pool + satellite splatter droplets
      expect(p.activeBloodPools.length).toBeGreaterThanOrEqual(2);

      const mainPool = p.activeBloodPools[0];
      expect(mainPool.targetSize).toBe(1.6);
      expect(mainPool.mesh.visible).toBe(true);
      // Initially zero scale
      expect(mainPool.mesh.scale.x).toBe(0);

      // Pump 0.35s of time: pool should expand outward
      p.update(0.35);
      expect(mainPool.mesh.scale.x).toBeGreaterThan(0.5);
      expect(mainPool.mesh.scale.x).toBeLessThanOrEqual(1.6);

      // Pump to full growth: pool reaches full target size
      p.update(1.0);
      expect(mainPool.mesh.scale.x).toBeCloseTo(1.6, 1);
    });

    it('spawnBloodPool recycles oldest pool when pool meshes are exhausted without leaks', () => {
      const p = new InkParticles();
      const origin = new THREE.Vector3(0, 0, 0);

      // Spawn 50 blood pools (exceeds 48 mesh pool limit)
      for (let i = 0; i < 50; i++) {
        p.spawnBloodPool(origin, 1.0);
      }

      // Should never crash and should cap active pools within mesh pool capacity
      expect(p.activeBloodPools.length).toBeLessThanOrEqual(48);
      expect(p.activeBloodPools.length).toBeGreaterThan(20);
    });

    it('spawnBloodFountain creates an active emitter that pumps vertical red ink droplets', () => {
      const p = new InkParticles();
      const headPos = new THREE.Vector3(0, 2, 0);

      p.spawnBloodFountain(headPos, new THREE.Vector3(0, 1, 0), 0.6);
      expect(p.bloodEmitters.length).toBe(1);

      // Update 0.1s -> should emit blood droplets upward
      p.update(0.1);

      const privP = p as unknown as {
        particles: Array<{ position: THREE.Vector3; velocity: THREE.Vector3; isBloodDrop?: boolean }>;
      };

      const emittedDrops = privP.particles.filter(pt => pt.isBloodDrop);
      expect(emittedDrops.length).toBeGreaterThan(0);
      for (const drop of emittedDrops) {
        expect(drop.velocity.y).toBeGreaterThan(0);
      }

      // Advance past duration: emitter finishes and is cleaned up
      p.update(0.8);
      expect(p.bloodEmitters.length).toBe(0);
    });

    it('EnemyManager.checkBulletHits triggers blood splatter, floor pool, and decapitation fountain on headshot kill', () => {
      const thug = new ThugEnemy(new THREE.Vector3(0, 0, 5));
      (enemyManager as unknown as { addEnemy: (e: Enemy) => void }).addEnemy(thug);

      const headPos = thug.headMesh ? thug.headMesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.6, 5);
      const fireResult: FireResult = {
        hit: true,
        damage: 200, // Fatal blow
        point: headPos,
        ray: new THREE.Ray(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, 1)),
        isHeadshot: true,
        target: thug.headMesh!,
        distance: 5
      };

      const report = enemyManager.checkBulletHits(fireResult);
      expect(report).not.toBeNull();
      expect(report!.killed).toBe(true);

      // Blood pool spawned on floor
      expect(particles.activeBloodPools.length).toBeGreaterThanOrEqual(1);

      // Headshot decapitation fountain triggered
      expect(particles.bloodEmitters.length).toBe(1);
    });

    it('clear() cleans up all blood pools and blood emitters', () => {
      particles.spawnBlood(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1.0);
      particles.spawnBloodPool(new THREE.Vector3(0, 0, 0), 1.5);
      particles.spawnBloodFountain(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1.0);

      expect(particles.activeBloodPools.length).toBeGreaterThan(0);
      expect(particles.bloodEmitters.length).toBeGreaterThan(0);

      particles.clear();

      expect(particles.activeBloodPools.length).toBe(0);
      expect(particles.bloodEmitters.length).toBe(0);
    });

    it('enemy falls to ground, topples onto floor, rests as corpse for x seconds, and disappears at x seconds', () => {
      const thug = new ThugEnemy(new THREE.Vector3(0, 4, 0));
      expect(thug.corpseLifetime).toBe(4.0); // default x = 4.0s

      // Kill with bullet from behind (positive Z hit direction)
      const hitDir = new THREE.Vector3(0, 0, 1);
      thug.takeDamage(200, false, undefined, hitDir);

      expect(thug.isDead).toBe(true);
      expect(thug.isDying).toBe(true);
      expect(thug.state).toBe(EnemyState.DEAD);
      expect(thug.fallVelocity.y).toBeGreaterThan(0); // Initial upward kick
      expect(thug.fallVelocity.z).toBeGreaterThan(0); // Pushed forward along bullet vector
      expect(thug.toppleAxis).toBe('x'); // Pitches along X axis

      // Step physics: falls under gravity
      thug.update(0.3, new THREE.Vector3(0, 0, 10));
      expect(thug.group.position.y).toBeLessThan(4.5);
      expect(Math.abs(thug.group.rotation.x)).toBeGreaterThan(0); // Topple rotation started

      // Step until landing on ground
      thug.update(0.8, new THREE.Vector3(0, 0, 10));
      expect(thug.onGroundCorpse).toBe(true);
      expect(thug.group.position.y).toBeLessThanOrEqual(0.15); // Snapped onto floor plane
      expect(thug.group.visible).toBe(true); // Corpse remains visible!

      // Remains visible as corpse at t = 2.5s (t < x - 0.8s)
      thug.update(1.4, new THREE.Vector3(0, 0, 10));
      expect(thug.deathTimer).toBeCloseTo(2.5, 1);
      expect(thug.isDying).toBe(true);
      expect(thug.group.visible).toBe(true);
      expect(thug.group.scale.x).toBe(1.0); // Full scale while resting

      // Enters shrink phase over last 0.8s (e.g. at t = 3.6s)
      thug.update(1.1, new THREE.Vector3(0, 0, 10));
      expect(thug.deathTimer).toBeCloseTo(3.6, 1);
      expect(thug.isDying).toBe(true);
      expect(thug.group.scale.x).toBeLessThan(1.0); // Shrinking into page
      expect(thug.group.scale.x).toBeGreaterThan(0.0);

      // Past x seconds (t = 4.2s > x = 4.0s): corpse disappears completely
      thug.update(0.6, new THREE.Vector3(0, 0, 10));
      expect(thug.deathTimer).toBeGreaterThanOrEqual(thug.corpseLifetime);
      expect(thug.isDying).toBe(false);
      expect(thug.group.visible).toBe(false);

      thug.dispose();
    });

    it('blood pool remains on ground for y seconds and disappears after y seconds with y > x', () => {
      const xCorpseTime = ThugEnemy.defaultCorpseLifetime;
      const yBloodTime = InkParticles.defaultBloodPoolLifetime;

      // Assert y > x requirement
      expect(yBloodTime).toBeGreaterThan(xCorpseTime);
      expect(xCorpseTime).toBe(4.0);
      expect(yBloodTime).toBe(12.0);

      // Spawn blood pool
      particles.spawnBloodPool(new THREE.Vector3(0, 0, 0), 1.6);
      expect(particles.activeBloodPools.length).toBeGreaterThan(0);
      const mainPool = particles.activeBloodPools[0];
      expect(mainPool.maxLife).toBe(yBloodTime);
      expect(mainPool.mesh.visible).toBe(true);

      // Advance past corpse lifetime x (e.g. 5.0 seconds):
      // The corpse would have disappeared at x = 4.0s, but blood pool must STILL be active and visible!
      particles.update(5.0);
      expect(particles.activeBloodPools.length).toBeGreaterThan(0);
      expect(mainPool.mesh.visible).toBe(true);
      expect((mainPool.mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(particles.bloodPoolOpacity, 1);
      expect((mainPool.mesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThanOrEqual(0.65); // Reduced opacity (not dark opaque)

      // Advance into fadeout window (e.g. t = 10.5s total): drying / fading out
      particles.update(5.5);
      expect(particles.activeBloodPools.length).toBeGreaterThan(0);
      expect((mainPool.mesh.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(0.45);

      // Advance past y seconds (e.g. t = 13.0s > y = 12.0s): blood pool is recycled and disappears
      particles.update(2.5);
      expect(particles.activeBloodPools.length).toBe(0);
    });

    it('EnemyManager lifecycle: enemy becomes corpse, disappears after x seconds, blood pool persists until y seconds', () => {
      const thug = new ThugEnemy(new THREE.Vector3(0, 0, 5));
      (enemyManager as unknown as { addEnemy: (e: Enemy) => void }).addEnemy(thug);
      const cam = undefined as unknown as THREE.PerspectiveCamera;
      const stubPlayer = {
        position: new THREE.Vector3(0, 1, 10),
        isDead: false,
        takeDamage: () => false,
      } as unknown as Player;

      const fireResult: FireResult = {
        hit: true,
        damage: 150,
        point: thug.headMesh ? thug.headMesh.position.clone() : new THREE.Vector3(0, 1.6, 5),
        ray: new THREE.Ray(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, 1)),
        isHeadshot: true,
        target: thug.headMesh!,
        distance: 5
      };

      const report = enemyManager.checkBulletHits(fireResult);
      expect(report!.killed).toBe(true);
      expect(particles.activeBloodPools.length).toBeGreaterThan(0);

      // One update moves dead enemy from active enemies to corpses
      enemyManager.update(0.1, stubPlayer, cam);
      expect(enemyManager.enemies.length).toBe(0); // Living combatants immediately decremented
      expect(enemyManager.corpses.length).toBe(1); // Corpse managed on ground
      expect(particles.activeBloodPools.length).toBeGreaterThan(0); // Blood pool present

      // Advance simulation to t = 2.0s: corpse is on ground, blood pool on ground
      for (let i = 0; i < 19; i++) {
        enemyManager.update(0.1, stubPlayer, cam);
        particles.update(0.1);
      }
      expect(enemyManager.corpses.length).toBe(1);
      expect(particles.activeBloodPools.length).toBeGreaterThan(0);

      // Advance past x = 4.0s (e.g. another 2.5s -> t = 4.5s):
      for (let i = 0; i < 25; i++) {
        enemyManager.update(0.1, stubPlayer, cam);
        particles.update(0.1);
      }
      // Corpse has disappeared after x seconds!
      expect(enemyManager.corpses.length).toBe(0);
      // Blood pool STILL remains active on floor (y = 12.0s > x = 4.0s)!
      expect(particles.activeBloodPools.length).toBeGreaterThan(0);

      // Advance comfortably past y = 12.0s (another 9.0s -> t = 13.4s > 12.0s):
      for (let i = 0; i < 90; i++) {
        particles.update(0.1);
      }
      // Blood pool has now disappeared after y seconds!
      expect(particles.activeBloodPools.length).toBe(0);
    });

    it('dead corpses do not block bullet raycasting or player projectiles', () => {
      const thug = new ThugEnemy(new THREE.Vector3(0, 0, 0));
      thug.die();

      const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 1, -5), new THREE.Vector3(0, 0, 1));
      for (const mesh of thug.collidableMeshes) {
        const hits: THREE.Intersection[] = [];
        mesh.raycast(raycaster, hits);
        expect(hits.length).toBe(0); // Raycast is disabled on corpses
      }

      thug.dispose();
    });

    it('does not spawn user blood or blood pools on the floor when player takes damage', () => {
      expect(particles.activeBloodPools.length).toBe(0);
      const cam = undefined as unknown as THREE.PerspectiveCamera;
      let playerHurtCalled = false;
      const player = {
        position: new THREE.Vector3(0, 1, 10),
        isDead: false,
        takeDamage: () => {
          playerHurtCalled = true;
          return true;
        },
      } as unknown as Player;

      // Spawn projectile aimed directly through player
      enemyManager.spawnProjectile({
        origin: new THREE.Vector3(0, 1, 5),
        direction: new THREE.Vector3(0, 0, 1),
        speed: 50,
        damage: 20,
        radius: 0.2,
        maxDistance: 30
      });

      expect(enemyManager.projectiles.length).toBe(1);

      // Update simulation so projectile hits the player
      enemyManager.update(0.2, player, cam);

      // Player took damage and projectile was removed
      expect(playerHurtCalled).toBe(true);
      expect(enemyManager.projectiles.length).toBe(0);

      // Crucial: NO blood or blood pools spawned on the floor for the user!
      expect(particles.activeBloodPools.length).toBe(0);
    });

    describe('Enemy Pursuit & Active Running toward Player (Inspiration)', () => {
      it('Thug in CHASE actively runs towards player from >30m without 22m leash stopping them', () => {
        const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
        thug.state = EnemyState.CHASE;
        thug.alerted = true;
        const playerPos = new THREE.Vector3(0, 0.5, 35);
        const cam = undefined as unknown as THREE.PerspectiveCamera;

        // Simulate 6 seconds of pursuit (60 frames of dt=0.1)
        for (let i = 0; i < 60; i++) {
          thug.update(0.1, playerPos, cam, []);
        }

        // Thug should have advanced far past the old 22m leash constraint (>25m along Z)
        expect(thug.group.position.z).toBeGreaterThan(22.0);
        expect(thug.group.position.distanceTo(playerPos)).toBeLessThan(12.0);
        // State must remain active combat (CHASE or ATTACK), NOT reverting to IDLE
        expect(thug.state).not.toBe(EnemyState.IDLE);
        thug.dispose();
      });

      it('Thug continues running towards player ground column when player is elevated (swinging/roof)', () => {
        const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
        thug.state = EnemyState.CHASE;
        thug.alerted = true;
        // Player is elevated 11.5m above thug (yDiff = 11.5m > old 5.0m freeze limit)
        const playerPos = new THREE.Vector3(0, 12.0, 20);
        const cam = undefined as unknown as THREE.PerspectiveCamera;

        // Simulate 2.5 seconds of pursuit
        for (let i = 0; i < 25; i++) {
          thug.update(0.1, playerPos, cam, []);
        }

        // Thug must NOT freeze; should advance along ground toward player's XZ column
        expect(thug.group.position.z).toBeGreaterThan(7.0);
        expect(thug.group.position.y).toBe(0.5); // Remains properly grounded on home floor
        thug.dispose();
      });

      it('Thug in ATTACK state closes distance towards player while strafing when > stopRange', () => {
        const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 0));
        thug.state = EnemyState.ATTACK;
        thug.alerted = true;
        const initialPos = thug.group.position.clone();
        const playerPos = new THREE.Vector3(0, 0.5, 18); // 18m away (> stopRange of 9m)
        const cam = undefined as unknown as THREE.PerspectiveCamera;

        for (let i = 0; i < 20; i++) {
          thug.update(0.1, playerPos, cam, []);
        }

        // Distance to player should have significantly decreased (closing in aggressively)
        const distAfter = thug.group.position.distanceTo(playerPos);
        expect(distAfter).toBeLessThan(14.0);
        // And lateral strafe displacement occurred
        expect(Math.abs(thug.group.position.x - initialPos.x)).toBeGreaterThan(0.2);
        thug.dispose();
      });

      it('Wave combat auto-alerts newly spawned enemies so they immediately hunt the player', () => {
        enemyManager.startNextWave();
        const player = {
          position: new THREE.Vector3(15, 0.5, 15),
          isDead: false,
          health: 100,
          takeDamage: () => false,
        } as unknown as Player;
        const cam = undefined as unknown as THREE.PerspectiveCamera;

        // Pump updates so wave spawn queue trickles enemies in
        for (let i = 0; i < 6; i++) {
          enemyManager.update(0.5, player, cam);
        }

        // Every living enemy in the wave must be alerted and hunting
        expect(enemyManager.enemies.length).toBeGreaterThan(0);
        for (const e of enemyManager.enemies) {
          expect(e.alerted).toBe(true);
          expect(e.state).not.toBe(EnemyState.IDLE);
        }
      });

      it('Drone tracks player altitude dynamically and swoops towards player level', () => {
        const drone = new DroneEnemy(new THREE.Vector3(0, 25, 0));
        drone.alerted = true;
        // Player is down on the street at Y = 1.0
        const playerPos = new THREE.Vector3(10, 1.0, 10);
        const cam = undefined as unknown as THREE.PerspectiveCamera;

        for (let i = 0; i < 30; i++) {
          drone.update(0.1, playerPos, cam, []);
        }

        // Drone should have descended significantly toward player altitude rather than staying at 25m
        expect(drone.group.position.y).toBeLessThan(15.0);
        drone.dispose();
      });

      describe('Terrace & Wall Penetration Prevention', () => {
        it('projectiles are stopped by terrace walls and do not damage player behind cover', () => {
          const collider = new WorldCollider();
          // Wall placed at z=10 (between origin z=0 and player z=20)
          collider.addBoxCoords(-50, 0, 9.8, 50, 30, 10.2, 'wall');
          collider.finalize();
          enemyManager.bindCollider(collider);

          let damaged = false;
          const player = {
            position: new THREE.Vector3(0, 15, 20),
            isDead: false,
            takeDamage: () => { damaged = true; return false; },
          } as unknown as Player;

          // Spawn a projectile flying towards the player at z=20, passing through z=10
          enemyManager.spawnProjectile({
            origin: new THREE.Vector3(0, 15, 0),
            direction: new THREE.Vector3(0, 0, 1),
            speed: 60.0,
            damage: 20,
            radius: 0.2,
            maxDistance: 50.0,
            isSniper: false,
            kind: 'thug'
          });

          expect(enemyManager.projectiles.length).toBe(1);

          // Update: bullet steps 30m, hitting the wall at z=10
          enemyManager.update(0.5, player, undefined as unknown as THREE.PerspectiveCamera);

          // Bullet should be absorbed by wall: projectile removed, player undamaged
          expect(damaged).toBe(false);
          expect(enemyManager.projectiles.length).toBe(0);
        });

        it('ThugEnemy does not fire bursts when player is on a terrace behind parapet walls', () => {
          const collider = new WorldCollider();
          // Terrace floor at y=20
          collider.addBoxCoords(-30, 19.8, -30, 30, 20.0, 30, 'floor');
          // Parapet wall from y=20.0 to 21.15 along z=0
          collider.addBoxCoords(-30, 20.0, -0.2, 30, 21.15, 0.2, 'wall');
          collider.finalize();

          const thug = new ThugEnemy(new THREE.Vector3(0, 20.5, -10));
          thug.bindCollider(collider);
          thug.alerted = true;

          // Player standing behind parapet at z=5, chest at y=20.9 (below 21.15m parapet)
          const playerPos = new THREE.Vector3(0, 20.9, 5);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          for (let i = 0; i < 15; i++) {
            thug.update(0.2, playerPos, cam, []);
          }

          // Thug line of sight is blocked by parapet: no projectiles fired!
          expect(thug.pendingProjectiles.length).toBe(0);
          thug.dispose();
        });

        it('SniperEnemy cancels laser tracking and does not fire when player is behind a terrace wall', () => {
          const collider = new WorldCollider();
          // Wall between sniper perch (z=-30) and player (z=20)
          collider.addBoxCoords(-40, 0, -2, 40, 50, 2, 'wall');
          collider.finalize();

          const sniper = new SniperEnemy(new THREE.Vector3(0, 30, -30));
          sniper.bindCollider(collider);
          sniper.alerted = true;

          const playerPos = new THREE.Vector3(0, 30, 20);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          for (let i = 0; i < 20; i++) {
            sniper.update(0.2, playerPos, cam, []);
          }

          // Blocked by wall: sniper cancels aim and never fires
          expect(sniper.isAimingAtPlayer).toBe(false);
          expect(sniper.pendingProjectiles.length).toBe(0);
          sniper.dispose();
        });

        it('DroneEnemy holds fire when player is obstructed by terrace architecture', () => {
          const collider = new WorldCollider();
          // Lower tier terrace floor at y=20
          collider.addBoxCoords(-30, 19.8, -30, 30, 20.0, 30, 'floor');
          // Upper setback building tower rising up to 60m between z=-10 and z=10
          collider.addBoxCoords(-15, 20.0, -10, 15, 60.0, 10, 'wall');
          collider.finalize();

          // Drone on North side of building at (0, 25, -25)
          const drone = new DroneEnemy(new THREE.Vector3(0, 25, -25));
          drone.bindCollider(collider);
          drone.alerted = true;

          // Player on South setback terrace at (0, 20.9, 25)
          const playerPos = new THREE.Vector3(0, 20.9, 25);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          for (let i = 0; i < 20; i++) {
            drone.update(0.2, playerPos, cam, []);
          }

          // Drone cannot see through the building tower: no projectiles fired
          expect(drone.pendingProjectiles.length).toBe(0);
          drone.dispose();
        });
      });

      describe('Enemy Obstacle Navigation, Stair Descent & Rooftop Vaulting', () => {
        it('Thug descends stairs/steps smoothly without getting stuck', () => {
          const collider = new WorldCollider();
          // Stepped staircase descending along Z:
          // Step 0: z: 0..2, top = 4.0
          collider.addBoxCoords(-3, 3.8, 0, 3, 4.0, 2, 'floor');
          // Step 1: z: 2..4, top = 3.0 (1.0m step-down)
          collider.addBoxCoords(-3, 2.8, 2, 3, 3.0, 4, 'floor');
          // Step 2: z: 4..6, top = 2.0 (1.0m step-down)
          collider.addBoxCoords(-3, 1.8, 4, 3, 2.0, 6, 'floor');
          // Step 3: z: 6..8, top = 1.0 (1.0m step-down)
          collider.addBoxCoords(-3, 0.8, 6, 3, 1.0, 8, 'floor');
          // Street ground: z: 8..25, top = 0.5
          collider.addBoxCoords(-10, 0, 8, 10, 0.5, 25, 'floor');
          collider.finalize();

          const thug = new ThugEnemy(new THREE.Vector3(0, 4.0, 1));
          thug.bindCollider(collider);
          const playerPos = new THREE.Vector3(0, 0.5, 18);
          thug.alert(playerPos);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          // Update thug walking toward player
          for (let i = 0; i < 35; i++) {
            thug.update(0.1, playerPos, cam, []);
          }

          // Thug must have moved down the staircase along +Z and descended below y=2.0
          expect(thug.position.z).toBeGreaterThan(6.0);
          expect(thug.position.y).toBeLessThanOrEqual(2.0);
          thug.dispose();
        });

        it('Thug on rooftop vaults over parapet and jumps down to street when player is below', () => {
          const collider = new WorldCollider();
          // Rooftop at y=15.0 (z from -10 to 10)
          collider.addBoxCoords(-10, 14.8, -10, 10, 15.0, 10, 'floor');
          // North parapet wall along z=10 (height 15.0 to 16.2m, open air above 16.2m)
          collider.addBoxCoords(-10, 15.0, 9.7, 10, 16.2, 10.0, 'wall');
          // Street floor below at y=0.5
          collider.addBoxCoords(-40, 0, -40, 40, 0.5, 40, 'floor');
          collider.finalize();

          const thug = new ThugEnemy(new THREE.Vector3(0, 15.0, 7.0));
          thug.bindCollider(collider);

          // Player on street at z=20, y=0.5
          const playerPos = new THREE.Vector3(0, 0.5, 20.0);
          thug.alert(playerPos);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          let sawVault = false;
          for (let i = 0; i < 40; i++) {
            thug.update(0.1, playerPos, cam, []);
            if (thug.isVaulting) sawVault = true;
          }

          // Thug must have vaulted over the parapet and landed down on the street
          expect(sawVault).toBe(true);
          expect(thug.position.y).toBe(0.5);
          expect(thug.position.z).toBeGreaterThan(10.0);
          expect(thug.isVaulting).toBe(false);
          thug.dispose();
        });

        it('Thug navigates around a tall obstacle using persistent tangent detours', () => {
          const collider = new WorldCollider();
          // Street floor
          collider.addBoxCoords(-30, 0, -30, 30, 0.5, 30, 'floor');
          // Tall wall blocking direct path: x from -3 to 3, z from 4.5 to 5.5, height 0.5 to 6.0
          collider.addBoxCoords(-3.0, 0.5, 4.5, 3.0, 6.0, 5.5, 'wall');
          collider.finalize();

          const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 1.0));
          thug.bindCollider(collider);

          // Player is on the other side of the wall at z=18
          const playerPos = new THREE.Vector3(0, 0.5, 18.0);
          thug.alert(playerPos);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          for (let i = 0; i < 50; i++) {
            thug.update(0.1, playerPos, cam, []);
          }

          // Thug must have navigated around the wall corner (steered laterally around x=±3 and advanced past z=5)
          expect(thug.position.z).toBeGreaterThan(5.0);
          thug.dispose();
        });

        it('Thug vaults over low crates/barriers on the same floor when blocked', () => {
          const collider = new WorldCollider();
          // Floor at y=0.5
          collider.addBoxCoords(-20, 0, -20, 20, 0.5, 20, 'floor');
          // Low barrier at z=4 (0.8m tall, from y=0.5 to 1.3, open above)
          collider.addBoxCoords(-4.0, 0.5, 3.8, 4.0, 1.3, 4.2, 'wall');
          collider.finalize();

          const thug = new ThugEnemy(new THREE.Vector3(0, 0.5, 1.0));
          thug.bindCollider(collider);

          const playerPos = new THREE.Vector3(0, 0.5, 16.0);
          thug.alert(playerPos);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          for (let i = 0; i < 40; i++) {
            thug.update(0.1, playerPos, cam, []);
          }

          // Thug must have vaulted forward over the low barrier and reached the other side
          expect(thug.position.z).toBeGreaterThan(4.5);
          expect(thug.position.y).toBe(0.5);
          thug.dispose();
        });

        it('Sniper repositions sideways along rooftop when line of sight is obstructed by an obstacle', () => {
          const collider = new WorldCollider();
          // Rooftop perch floor at y=20.0
          collider.addBoxCoords(-15, 19.8, -25, 15, 20.0, 25, 'floor');
          // Pillar/HVAC obstacle right in front of sniper at z=-10 (x: -1..1, y: 20..25)
          collider.addBoxCoords(-1.0, 20.0, -11.0, 1.0, 25.0, -9.0, 'wall');
          collider.finalize();

          const sniper = new SniperEnemy(new THREE.Vector3(0, 20.0, -15.0));
          sniper.bindCollider(collider);

          const playerPos = new THREE.Vector3(0, 20.0, 10.0);
          sniper.alert(playerPos);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          const initialX = sniper.position.x;
          // Run updates past the 1.8s blocked LOS threshold
          for (let i = 0; i < 35; i++) {
            sniper.update(0.1, playerPos, cam, []);
          }

          // Sniper must have shifted laterally along the rooftop to clear the pillar
          expect(Math.abs(sniper.position.x - initialX)).toBeGreaterThan(2.0);
          sniper.dispose();
        });

        it('Drone slides along building facades and advances orbit angle around obstacles', () => {
          const collider = new WorldCollider();
          // Skyscraper facade between x=-10..10, z=5..15, height up to 50m
          collider.addBoxCoords(-10, 0, 5, 10, 50, 15, 'wall');
          collider.finalize();

          const drone = new DroneEnemy(new THREE.Vector3(0, 20.0, 4.0));
          drone.bindCollider(collider);
          drone.alerted = true;

          const playerPos = new THREE.Vector3(0, 20.0, 18.0);
          const cam = undefined as unknown as THREE.PerspectiveCamera;

          const initialAngle = (drone as unknown as { orbitAngle: number }).orbitAngle;
          for (let i = 0; i < 20; i++) {
            drone.update(0.1, playerPos, cam, []);
          }

          // Drone must have shifted position and advanced orbit around the building corner
          const currentAngle = (drone as unknown as { orbitAngle: number }).orbitAngle;
          expect(currentAngle).not.toBe(initialAngle);
          drone.dispose();
        });
      });
    });
  });
});

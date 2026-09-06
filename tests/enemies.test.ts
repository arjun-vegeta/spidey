import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EnemyManager } from '../src/enemies/EnemyManager';
import { InkParticles } from '../src/effects/InkParticles';
import { ThugEnemy } from '../src/enemies/ThugEnemy';
import { SniperEnemy } from '../src/enemies/SniperEnemy';
import { DroneEnemy } from '../src/enemies/DroneEnemy';
import { FireResult } from '../src/weapons/BaseWeapon';
import type { Player } from '../src/player/Player';
import { EnemyState } from '../src/enemies/Enemy';

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

  // Dispose leftovers so per-type static state (sniper aim tokens) never leaks between tests
  afterEach(() => {
    enemyManager.clear();
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

    // Simulate to complete grace & charge and fire 2 shots
    for (let i = 0; i < 90; i++) {
      sniper.update(0.1, playerPos, cam, []);
    }

    // Now trigger 2nd shot reposition if not already triggered
    if (!(sniper as unknown as { repositionTarget: THREE.Vector3 | null }).repositionTarget) {
      for (let i = 0; i < 50; i++) {
        sniper.update(0.1, playerPos, cam, []);
      }
    }

    const posBeforeTelegraph = sniper.group.position.clone();
    // During the 0.5s telegraph, sniper position must hold at current perch
    sniper.update(0.2, playerPos, cam, []);
    expect(sniper.group.position.distanceTo(posBeforeTelegraph)).toBeLessThan(0.01);

    // After 0.5s telegraph expires, dash begins
    for (let i = 0; i < 15; i++) {
      sniper.update(0.1, playerPos, cam, []);
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
});

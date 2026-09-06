import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EnemyManager, ProjectileSpawnRequest } from '../src/enemies/EnemyManager';
import { InkParticles } from '../src/effects/InkParticles';
import { CityBuilder } from '../src/world/CityBuilder';
import type { Player } from '../src/player/Player';

describe('Performance Ceilings & Scale Stress [19]', () => {
  let scene: THREE.Scene;
  let particles: InkParticles;
  let enemyManager: EnemyManager;
  let stubPlayer: Player;
  let stubCamera: THREE.PerspectiveCamera;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new InkParticles();
    enemyManager = new EnemyManager(scene, particles);
    stubPlayer = {
      position: new THREE.Vector3(0, 1, 10),
      isDead: false,
      takeDamage: () => false,
      health: 100,
    } as unknown as Player;
    stubCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  });

  afterEach(() => {
    enemyManager.clear();
  });

  it('spawns a wave-5-sized queue (20 enemies) and asserts alive never exceeds 12 while pumping', () => {
    // Wave 5 composition calculation:
    // thugs: 8 + (5 - 3) * 2 = 12
    // snipers: min(2 + floor(2/2), 5) = 3
    // drones: 3 + (5 - 3) = 5
    // Total queued = 20 enemies
    const comp = enemyManager.compositionFor(5);
    expect(comp).toEqual({ thugs: 12, snipers: 3, drones: 5 });
    expect(comp.thugs + comp.snipers + comp.drones).toBe(20);

    // Advance to wave 5
    enemyManager.currentWave = 4;
    enemyManager.startNextWave(100);

    expect(enemyManager.currentWave).toBe(5);
    expect(enemyManager.totalEnemiesInWave).toBe(20);
    expect(enemyManager.enemiesLeft).toBe(20);

    // Initial tick before trickle
    expect(enemyManager.enemies.length).toBe(0);

    // Pump simulation over 60 seconds in 0.1s steps, asserting alive count never exceeds 12
    let maxAliveSeen = 0;
    for (let t = 0; t < 60; t += 0.1) {
      enemyManager.update(0.1, stubPlayer, stubCamera);
      const alive = enemyManager.enemies.length;
      if (alive > maxAliveSeen) maxAliveSeen = alive;
      expect(alive).toBeLessThanOrEqual(12);
    }

    // Ceiling reached and maintained
    expect(maxAliveSeen).toBe(12);
    expect(enemyManager.enemies.length).toBe(12);

    // Kill one enemy and verify trickle brings alive count back up without exceeding 12
    const firstEnemy = enemyManager.enemies[0];
    firstEnemy.takeDamage(9999, false);
    enemyManager.update(0.1, stubPlayer, stubCamera);
    expect(enemyManager.enemies.length).toBeLessThanOrEqual(12);

    // Pump to allow queued reinforcement to spawn
    for (let t = 0; t < 5; t += 0.2) {
      enemyManager.update(0.2, stubPlayer, stubCamera);
      expect(enemyManager.enemies.length).toBeLessThanOrEqual(12);
    }
    expect(enemyManager.enemies.length).toBe(12);
  });

  it('fires 100 projectiles and asserts the live count never exceeds 60', () => {
    enemyManager.clear();
    expect(enemyManager.projectiles.length).toBe(0);

    // Fire 100 projectiles in various radial directions
    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * Math.PI * 2;
      const req: ProjectileSpawnRequest = {
        origin: new THREE.Vector3(0, 2, 0),
        direction: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize(),
        speed: 30,
        damage: 10,
        radius: 0.15,
        maxDistance: 60,
        kind: i % 2 === 0 ? 'thug' : 'sniper',
        isSniper: i % 2 !== 0,
      };

      enemyManager.spawnProjectile(req);
      expect(enemyManager.projectiles.length).toBeLessThanOrEqual(60);
    }

    // Cap holds strictly at 60
    expect(enemyManager.projectiles.length).toBe(60);

    // Pump simulation past maximum distance (60m / 30m/s = 2.0s) to verify clean culling
    for (let t = 0; t < 3.0; t += 0.5) {
      enemyManager.update(0.5, stubPlayer, stubCamera);
      expect(enemyManager.projectiles.length).toBeLessThanOrEqual(60);
    }

    // All expired projectiles removed without error
    expect(enemyManager.projectiles.length).toBe(0);
  });

  it('asserts a full CityBuilder + 12-enemy scene builds without throwing (pure three.js, no DOM needed)', () => {
    // CityBuilder is pure Three.js geometry/materials with zero DOM dependencies
    let city!: CityBuilder;
    expect(() => {
      city = new CityBuilder();
    }).not.toThrow();

    const testScene = new THREE.Scene();
    testScene.add(city.group);

    // Verify city assets built
    expect(city.group.children.length).toBeGreaterThan(0);
    const collidables = city.getCollidableMeshes();
    expect(collidables.length).toBeGreaterThan(0);
    const anchors = city.getWebAnchors();
    expect(anchors.length).toBeGreaterThan(0);

    // Add particle system
    const testParticles = new InkParticles();
    testScene.add(testParticles.getGroup());

    // Add EnemyManager wired with city collidables
    const testEnemyManager = new EnemyManager(testScene, testParticles, collidables);

    // Start wave 3 (requests 8 thugs + 2 snipers + 3 drones = 13 enemies, capped at 12 alive)
    testEnemyManager.currentWave = 2;
    expect(() => {
      testEnemyManager.startNextWave(100);
      for (let t = 0; t < 15; t += 0.5) {
        testEnemyManager.update(0.5, stubPlayer, stubCamera);
      }
    }).not.toThrow();

    // Exactly 12 active enemies in the combined scene
    expect(testEnemyManager.enemies.length).toBe(12);

    // Raycast targets exist and are queryable
    const targets = testEnemyManager.getRaycastTargets();
    expect(targets.length).toBeGreaterThan(0);

    // Simulation tick with full city + 12 enemies runs clean
    expect(() => {
      testEnemyManager.update(0.016, stubPlayer, stubCamera);
    }).not.toThrow();

    // Clean disposal
    testEnemyManager.dispose();
  });
});

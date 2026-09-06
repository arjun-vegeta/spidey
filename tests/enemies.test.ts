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
});

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EnemyManager } from '../src/enemies/EnemyManager';
import { InkParticles } from '../src/effects/InkParticles';
import { ThugEnemy } from '../src/enemies/ThugEnemy';
import { SniperEnemy } from '../src/enemies/SniperEnemy';
import { DroneEnemy } from '../src/enemies/DroneEnemy';
import { FireResult } from '../src/weapons/BaseWeapon';

describe('Enemy AI & Wave Combat Manager', () => {
  let scene: THREE.Scene;
  let particles: InkParticles;
  let enemyManager: EnemyManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new InkParticles();
    enemyManager = new EnemyManager(scene, particles);
  });

  it('spawns Wave 1 with 5 thugs', () => {
    enemyManager.startNextWave();
    expect(enemyManager.currentWave).toBe(1);
    expect(enemyManager.enemies.length).toBe(5);
    expect(enemyManager.enemiesLeft).toBe(5);
    enemyManager.enemies.forEach(e => expect(e.type).toBe('thug'));
  });

  it('spawns Wave 2 with thugs and drones', () => {
    enemyManager.currentWave = 1;
    enemyManager.startNextWave();
    expect(enemyManager.currentWave).toBe(2);
    expect(enemyManager.enemies.length).toBe(9); // 7 thugs + 2 drones
    const drones = enemyManager.enemies.filter(e => e.type === 'drone');
    expect(drones.length).toBe(2);
  });

  it('spawns Wave 3 with thugs, snipers, and drones', () => {
    enemyManager.currentWave = 2;
    enemyManager.startNextWave();
    expect(enemyManager.currentWave).toBe(3);
    const snipers = enemyManager.enemies.filter(e => e.type === 'sniper');
    const drones = enemyManager.enemies.filter(e => e.type === 'drone');
    expect(snipers.length).toBe(2);
    expect(drones.length).toBe(3);
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

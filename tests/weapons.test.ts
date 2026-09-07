import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Sword } from '../src/weapons/Sword';
import { Pistol } from '../src/weapons/Pistol';
import { SMG } from '../src/weapons/SMG';
import { Sniper } from '../src/weapons/Sniper';
import { WeaponManager } from '../src/player/WeaponManager';

describe('Weapons System - Swinging Restrictions & Combat Rules', () => {
  let wepManager: WeaponManager;
  let sword: Sword;
  let pistol: Pistol;
  let smg: SMG;
  let sniper: Sniper;

  beforeEach(() => {
    wepManager = new WeaponManager();
    sword = wepManager.weapons[0] as Sword;
    pistol = wepManager.weapons[1] as Pistol;
    smg = wepManager.weapons[2] as SMG;
    sniper = wepManager.weapons[3] as Sniper;
  });

  it('4-Slot layout: [Sword, Pistol, SMG/Rifle, Sniper] with swinging permissions', () => {
    expect(sword.type).toBe('sword');
    expect(pistol.type).toBe('pistol');
    expect(smg.type).toBe('smg');
    expect(sniper.type).toBe('sniper');

    expect(sword.usableWhileSwinging).toBe(true);
    expect(pistol.usableWhileSwinging).toBe(true);
    expect(smg.usableWhileSwinging).toBe(false);
    expect(sniper.usableWhileSwinging).toBe(false);
  });

  it('Sword can slash while swinging with infinite ammo', () => {
    wepManager.switchWeapon(0); // Sword
    const now = 10.0;
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const isSwinging = true;

    const result = wepManager.fire(now, origin, dir, isSwinging, []);
    expect(result).not.toBeNull();
    expect(sword.currentAmmo).toBe(1); // Infinite
  });

  it('Pistol can fire while swinging', () => {
    wepManager.switchWeapon(1); // Pistol
    wepManager.update(0.3, false, false, false, 0);
    const now = 10.0;
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const isSwinging = true;

    const result = wepManager.fire(now, origin, dir, isSwinging, []);
    expect(result).not.toBeNull();
    expect(pistol.currentAmmo).toBe(pistol.magazineSize - 1);
  });

  it('SMG CANNOT fire while swinging', () => {
    wepManager.switchWeapon(2); // SMG
    wepManager.update(0.3, false, false, false, 0);
    const now = 10.0;
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const isSwinging = true;

    const result = wepManager.fire(now, origin, dir, isSwinging, []);
    expect(result).toBeNull();
    expect(smg.currentAmmo).toBe(smg.magazineSize); // Ammo unchanged
  });

  it('Sniper CANNOT fire while swinging', () => {
    wepManager.switchWeapon(3); // Sniper
    wepManager.update(0.3, false, false, false, 0);
    const now = 10.0;
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const isSwinging = true;

    const result = wepManager.fire(now, origin, dir, isSwinging, []);
    expect(result).toBeNull();
    expect(sniper.currentAmmo).toBe(sniper.magazineSize);
  });

  it('SMG and Sniper CAN fire on the ground / when not swinging', () => {
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);

    // SMG (let the 0.25s swap raise finish first)
    wepManager.switchWeapon(2);
    wepManager.update(0.3, false, false, false, 0);
    const smgResult = wepManager.fire(10.0, origin, dir, false, []);
    expect(smgResult).not.toBeNull();
    expect(smg.currentAmmo).toBe(smg.magazineSize - 1);

    // Sniper
    wepManager.switchWeapon(3);
    wepManager.update(0.3, false, false, false, 0);
    const sniperResult = wepManager.fire(12.0, origin, dir, false, []);
    expect(sniperResult).not.toBeNull();
    expect(sniper.currentAmmo).toBe(sniper.magazineSize - 1);
  });

  it('freshly swapped weapon cannot fire mid-raise (0.25s swap weight)', () => {
    wepManager.switchWeapon(2);
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    expect(wepManager.fire(10.0, origin, dir, false, [])).toBeNull();
    wepManager.update(0.3, false, false, false, 0);
    expect(wepManager.fire(10.0, origin, dir, false, [])).not.toBeNull();
  });

  it('switching cancels an in-progress reload', () => {
    wepManager.switchWeapon(1);
    wepManager.update(0.3, false, false, false, 0);
    pistol.currentAmmo = 2;
    pistol.startReload();
    expect(pistol.isReloading).toBe(true);
    wepManager.switchWeapon(2);
    expect(pistol.isReloading).toBe(false);
  });

  it('Sniper does massive damage with high headshot multiplier', () => {
    expect(sniper.damage).toBeGreaterThanOrEqual(120);
    expect(sniper.headshotMultiplier).toBe(3.0);
  });

  it('Weapon reloading depletes reserve and refills current magazine', () => {
    pistol.currentAmmo = 2;
    pistol.startReload();
    expect(pistol.isReloading).toBe(true);

    pistol.updateReload(pistol.reloadTime + 0.1);
    expect(pistol.isReloading).toBe(false);
    expect(pistol.currentAmmo).toBe(pistol.magazineSize);
  });
});

describe('Damage Falloff Bands & Headshot Preservation [12.2, 24.2]', () => {
  let pistol: Pistol;
  let smg: SMG;
  let sniper: Sniper;

  beforeEach(() => {
    pistol = new Pistol();
    smg = new SMG();
    sniper = new Sniper();
  });

  it('Pistol has full damage inside start range, linear falloff to 60% floor', () => {
    // Inside falloff start (18m)
    expect(pistol.calculateDamage(5, false)).toBe(42);
    expect(pistol.calculateDamage(18, false)).toBe(42);

    // Beyond falloff end (60m): floored at 60% (42 * 0.6 = 25.2)
    expect(pistol.calculateDamage(60, false)).toBeCloseTo(25.2, 3);
    expect(pistol.calculateDamage(85, false)).toBeCloseTo(25.2, 3);

    // Halfway (39m): 42 * (1 - 0.5 * 0.4) = 42 * 0.8 = 33.6
    expect(pistol.calculateDamage(39, false)).toBeCloseTo(33.6, 3);

    // Never drops below floor at max range
    expect(pistol.calculateDamage(pistol.range, false)).toBeGreaterThanOrEqual(25.2);
  });

  it('SMG has full damage inside start range, linear falloff to 50% floor', () => {
    // Inside start range (10m)
    expect(smg.calculateDamage(5, false)).toBe(22);
    expect(smg.calculateDamage(10, false)).toBe(22);

    // Beyond end range (35m): floored at 50% (22 * 0.5 = 11.0)
    expect(smg.calculateDamage(35, false)).toBeCloseTo(11.0, 3);
    expect(smg.calculateDamage(60, false)).toBeCloseTo(11.0, 3);

    // Halfway (22.5m): 22 * 0.75 = 16.5
    expect(smg.calculateDamage(22.5, false)).toBeCloseTo(16.5, 3);

    // Floor maintained
    expect(smg.calculateDamage(smg.range, false)).toBeGreaterThanOrEqual(11.0);
  });

  it('Sniper is completely exempt from damage falloff across its full 400m range', () => {
    expect(sniper.falloffFloor).toBe(1.0);
    expect(sniper.calculateDamage(5, false)).toBe(145);
    expect(sniper.calculateDamage(100, false)).toBe(145);
    expect(sniper.calculateDamage(250, false)).toBe(145);
    expect(sniper.calculateDamage(400, false)).toBe(145);
  });

  it('Headshots bypass damage falloff to guarantee one-tap breakpoints at all ranges', () => {
    // Pistol headshot deals 105 (42 * 2.5) at 5m and at 80m
    expect(pistol.calculateDamage(5, true)).toBe(105);
    expect(pistol.calculateDamage(80, true)).toBe(105);

    // Sniper headshot deals 435 (145 * 3.0) at all distances
    expect(sniper.calculateDamage(5, true)).toBe(435);
    expect(sniper.calculateDamage(350, true)).toBe(435);
  });
});

describe('Forgiving Drone Headshot Radius [12.5]', () => {
  it('detects headshot when hit point is within 0.45m of enemy headMesh center', () => {
    const pistol = new Pistol();
    pistol.initAmmo();

    // Mock an enemy with a body mesh and a head mesh
    const enemyRoot = new THREE.Group();
    const bodyGeom = new THREE.BoxGeometry(0.8, 0.4, 0.8);
    const bodyMesh = new THREE.Mesh(bodyGeom);
    bodyMesh.position.set(0, 0, -5);

    const headGeom = new THREE.SphereGeometry(0.2, 8, 8);
    const headMesh = new THREE.Mesh(headGeom);
    headMesh.position.set(0, 0.25, -5);

    enemyRoot.add(bodyMesh);
    enemyRoot.add(headMesh);
    enemyRoot.updateMatrixWorld(true);

    const mockEnemy = {
      headMesh: headMesh,
      isDead: false
    };

    bodyMesh.userData = { enemy: mockEnemy, isHead: false };
    headMesh.userData = { enemy: mockEnemy, isHead: true };

    // Fire directly at the body mesh, but within 0.25m of headMesh center (0, 0.25, -5)
    // Ray from (0, 0.10, 0) straight to (0, 0.10, -5) hits bodyMesh at y=0.10.
    // Distance from (0, 0.10, -5) to headCenter (0, 0.25, -5) = 0.15m <= 0.45m!
    const origin = new THREE.Vector3(0, 0.10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const result = pistol.fire(1.0, origin, dir, false, [bodyMesh]);

    expect(result).not.toBeNull();
    expect(result?.hit).toBe(true);
    expect(result?.isHeadshot).toBe(true); // Forgiven to headshot!
    expect(result?.damage).toBe(105); // Full 2.5x headshot critical damage
  });

  it('does NOT trigger forgiven headshot if hit point is further than 0.45m from headMesh', () => {
    const pistol = new Pistol();
    pistol.initAmmo();

    const enemyRoot = new THREE.Group();
    const bodyGeom = new THREE.BoxGeometry(2.0, 0.4, 2.0);
    const bodyMesh = new THREE.Mesh(bodyGeom);
    bodyMesh.position.set(0, 0, -5);

    const headGeom = new THREE.SphereGeometry(0.2, 8, 8);
    const headMesh = new THREE.Mesh(headGeom);
    headMesh.position.set(0, 0.25, -5);

    enemyRoot.add(bodyMesh);
    enemyRoot.add(headMesh);
    enemyRoot.updateMatrixWorld(true);

    const mockEnemy = {
      headMesh: headMesh,
      isDead: false
    };

    bodyMesh.userData = { enemy: mockEnemy, isHead: false };
    headMesh.userData = { enemy: mockEnemy, isHead: true };

    // Ray from (0.7, 0, 0) straight to (0.7, 0, -5)
    // Distance from (0.7, 0, -5) to head center (0, 0.25, -5) = sqrt(0.7^2 + 0.25^2) = 0.74m > 0.45m!
    const origin = new THREE.Vector3(0.7, 0, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const result = pistol.fire(1.0, origin, dir, false, [bodyMesh]);

    expect(result).not.toBeNull();
    expect(result?.hit).toBe(true);
    expect(result?.isHeadshot).toBe(false); // Normal body hit
    expect(result?.damage).toBe(42);
  });
});

describe('Reload Dip & Tilt Animation Monotonicity [13, 32]', () => {
  let wepManager: WeaponManager;
  let pistol: Pistol;

  beforeEach(() => {
    wepManager = new WeaponManager();
    wepManager.switchWeapon(1); // Pistol
    // Clear initial switch weight
    wepManager.update(0.3, false, false, false, 0);
    pistol = wepManager.weapons[1] as Pistol;
  });

  it('dips downward monotonically during first half of reload (0.0 -> 0.5)', () => {
    pistol.currentAmmo = 1;
    pistol.startReload();
    expect(pistol.isReloading).toBe(true);

    // Sample progress values in first half
    pistol.reloadProgress = 0.1 * pistol.reloadTime;
    wepManager.update(0, false, false, false, 0);
    const y1 = pistol.modelGroup.position.y;

    pistol.reloadProgress = 0.3 * pistol.reloadTime;
    wepManager.update(0, false, false, false, 0);
    const y3 = pistol.modelGroup.position.y;

    pistol.reloadProgress = 0.5 * pistol.reloadTime;
    wepManager.update(0, false, false, false, 0);
    const y5 = pistol.modelGroup.position.y;

    // y position must be strictly decreasing (dipping deeper downward)
    expect(y1).toBeGreaterThan(y3);
    expect(y3).toBeGreaterThan(y5);
  });

  it('rises upward monotonically during second half of reload (0.5 -> 1.0)', () => {
    pistol.currentAmmo = 1;
    pistol.startReload();

    pistol.reloadProgress = 0.5 * pistol.reloadTime;
    wepManager.update(0, false, false, false, 0);
    const y5 = pistol.modelGroup.position.y;

    pistol.reloadProgress = 0.7 * pistol.reloadTime;
    wepManager.update(0, false, false, false, 0);
    const y7 = pistol.modelGroup.position.y;

    pistol.reloadProgress = 0.9 * pistol.reloadTime;
    wepManager.update(0, false, false, false, 0);
    const y9 = pistol.modelGroup.position.y;

    // y position must be strictly increasing (rising back to ready pose)
    expect(y5).toBeLessThan(y7);
    expect(y7).toBeLessThan(y9);
  });
});

describe('TTK Breakpoints vs 90 HP Thugs & SMG Math [14.2, 24.2]', () => {
  let pistol: Pistol;
  let smg: SMG;
  let sniper: Sniper;

  beforeEach(() => {
    pistol = new Pistol();
    smg = new SMG();
    sniper = new Sniper();
  });

  it('Pistol body against 90 HP thug takes exactly 3 shots at close range', () => {
    const thugHp = 90;
    const bodyDmg = pistol.calculateDamage(10, false); // 42 dmg
    expect(bodyDmg).toBe(42);

    // Shot 1: leaves 48 HP (alive)
    expect(thugHp - bodyDmg).toBe(48);
    // Shot 2: leaves 6 HP (alive)
    expect(thugHp - bodyDmg * 2).toBe(6);
    // Shot 3: kills thug (surplus 36 damage)
    expect(thugHp - bodyDmg * 3).toBeLessThanOrEqual(0);

    const shotsToKill = Math.ceil(thugHp / bodyDmg);
    expect(shotsToKill).toBe(3);
  });

  it('Pistol headshot one-taps a 90 HP thug at ALL ranges', () => {
    const thugHp = 90;
    // Close range (5m)
    const closeHeadDmg = pistol.calculateDamage(5, true);
    expect(closeHeadDmg).toBe(105);
    expect(Math.ceil(thugHp / closeHeadDmg)).toBe(1);

    // Far range (85m)
    const farHeadDmg = pistol.calculateDamage(85, true);
    expect(farHeadDmg).toBe(105);
    expect(Math.ceil(thugHp / farHeadDmg)).toBe(1);
  });

  it('Sniper body shot one-taps a 90 HP thug at all ranges', () => {
    const thugHp = 90;
    const bodyDmgClose = sniper.calculateDamage(10, false);
    expect(bodyDmgClose).toBe(145);
    expect(Math.ceil(thugHp / bodyDmgClose)).toBe(1);

    const bodyDmgFar = sniper.calculateDamage(350, false);
    expect(bodyDmgFar).toBe(145);
    expect(Math.ceil(thugHp / bodyDmgFar)).toBe(1);
  });

  it('SMG close TTK on 90 HP thug is under 1.0s (hose identity)', () => {
    const thugHp = 90;
    const closeDmg = smg.calculateDamage(5, false); // 22 dmg
    expect(closeDmg).toBe(22);

    const shotsToKill = Math.ceil(thugHp / closeDmg); // 5 shots: 22 * 5 = 110 >= 90
    expect(shotsToKill).toBe(5);

    // Time to fire 5 shots = 4 intervals / fireRate (12.5 rps)
    const timeToKill = (shotsToKill - 1) / smg.fireRate;
    expect(timeToKill).toBeCloseTo(0.32, 2);
    expect(timeToKill).toBeLessThan(1.0); // Strict target: < 1.0s
  });
});

describe('SMG Horizontal Drift & Muzzle Hand-Light Pulse [12.2, 13]', () => {
  let wepManager: WeaponManager;
  let smg: SMG;

  beforeEach(() => {
    wepManager = new WeaponManager();
    wepManager.switchWeapon(2); // SMG
    wepManager.update(0.3, false, false, false, 0);
    smg = wepManager.weapons[2] as SMG;
  });

  it('accumulates horizontal drift while held and resets on release or reload', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3(0, 0, -1);

    expect(wepManager.smgBurstShots).toBe(0);

    // Fire multiple rounds while holding trigger
    for (let i = 0; i < 5; i++) {
      const now = 10.0 + i * (1.0 / smg.fireRate);
      wepManager.fire(now, origin, dir, false, []);
    }

    expect(wepManager.smgBurstShots).toBe(5);

    // Release trigger for > 0.15s: drift resets
    wepManager.update(0.2, false, false, false, 0);
    expect(wepManager.smgBurstShots).toBe(0);
    expect(wepManager.smgHorizontalDrift).toBe(0);

    // Fire again and reload: drift resets immediately
    wepManager.fire(12.0, origin, dir, false, []);
    expect(wepManager.smgBurstShots).toBe(1);
    wepManager.reload();
    expect(wepManager.smgBurstShots).toBe(0);
    expect(wepManager.smgHorizontalDrift).toBe(0);
  });

  it('triggers a 1-frame muzzle pulse on weapon materials upon successful fire', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3(0, 0, -1);

    expect(wepManager.muzzleFlashTimer).toBe(0);
    wepManager.fire(10.0, origin, dir, false, []);
    expect(wepManager.muzzleFlashTimer).toBe(1);

    // Next update applies flash for this frame and decrements timer
    wepManager.update(0.016, false, false, false, 0);
    expect(wepManager.muzzleFlashTimer).toBe(0);

    // Following update turns off flash
    wepManager.update(0.016, false, false, false, 0);
    expect(wepManager.muzzleFlashTimer).toBe(0);
  });
});

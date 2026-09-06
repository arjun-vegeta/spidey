import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Pistol } from '../src/weapons/Pistol';
import { SMG } from '../src/weapons/SMG';
import { Sniper } from '../src/weapons/Sniper';
import { WeaponManager } from '../src/player/WeaponManager';

describe('Weapons System - Swinging Restrictions & Combat Rules', () => {
  let wepManager: WeaponManager;
  let pistol: Pistol;
  let smg: SMG;
  let sniper: Sniper;

  beforeEach(() => {
    wepManager = new WeaponManager();
    pistol = wepManager.weapons[0] as Pistol;
    smg = wepManager.weapons[1] as SMG;
    sniper = wepManager.weapons[2] as Sniper;
  });

  it('CRUCIAL RULE: Pistol is the ONLY weapon with usableWhileSwinging = true', () => {
    expect(pistol.usableWhileSwinging).toBe(true);
    expect(smg.usableWhileSwinging).toBe(false);
    expect(sniper.usableWhileSwinging).toBe(false);
  });

  it('Pistol can fire while swinging', () => {
    wepManager.switchWeapon(0); // Pistol
    const now = 10.0;
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const isSwinging = true;

    const result = wepManager.fire(now, origin, dir, isSwinging, []);
    expect(result).not.toBeNull();
    expect(pistol.currentAmmo).toBe(pistol.magazineSize - 1);
  });

  it('SMG CANNOT fire while swinging', () => {
    wepManager.switchWeapon(1); // SMG
    const now = 10.0;
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const isSwinging = true;

    const result = wepManager.fire(now, origin, dir, isSwinging, []);
    expect(result).toBeNull();
    expect(smg.currentAmmo).toBe(smg.magazineSize); // Ammo unchanged
  });

  it('Sniper CANNOT fire while swinging', () => {
    wepManager.switchWeapon(2); // Sniper
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
    wepManager.switchWeapon(1);
    wepManager.update(0.3, false, false, false, 0);
    const smgResult = wepManager.fire(10.0, origin, dir, false, []);
    expect(smgResult).not.toBeNull();
    expect(smg.currentAmmo).toBe(smg.magazineSize - 1);

    // Sniper
    wepManager.switchWeapon(2);
    wepManager.update(0.3, false, false, false, 0);
    const sniperResult = wepManager.fire(12.0, origin, dir, false, []);
    expect(sniperResult).not.toBeNull();
    expect(sniper.currentAmmo).toBe(sniper.magazineSize - 1);
  });

  it('freshly swapped weapon cannot fire mid-raise (0.25s swap weight)', () => {
    wepManager.switchWeapon(1);
    const origin = new THREE.Vector3(0, 10, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    expect(wepManager.fire(10.0, origin, dir, false, [])).toBeNull();
    wepManager.update(0.3, false, false, false, 0);
    expect(wepManager.fire(10.0, origin, dir, false, [])).not.toBeNull();
  });

  it('switching cancels an in-progress reload', () => {
    pistol.currentAmmo = 2;
    pistol.startReload();
    expect(pistol.isReloading).toBe(true);
    wepManager.switchWeapon(1);
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

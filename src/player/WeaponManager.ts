import * as THREE from 'three';
import { BaseWeapon, FireResult, FireOptions } from '../weapons/BaseWeapon';
import { Pistol } from '../weapons/Pistol';
import { SMG } from '../weapons/SMG';
import { Sniper } from '../weapons/Sniper';
import { soundManager } from '../core/SoundManager';

export class WeaponManager {
  public weapons: BaseWeapon[];
  public activeIndex: number = 0;

  // Recoil smoothing
  public recoilPos: THREE.Vector3 = new THREE.Vector3();
  public recoilRot: THREE.Euler = new THREE.Euler();
  private recoilRecoveryRate: number = 18.0;
  private tmpBaseOffset: THREE.Vector3 = new THREE.Vector3();
  private tmpZero: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private tmpAds: THREE.Vector3 = new THREE.Vector3();
  private tmpRot: THREE.Vector3 = new THREE.Vector3();

  // Root container attached to camera
  public weaponContainer: THREE.Group = new THREE.Group();

  // ADS / Aim smoothing factor (0 = hip, 1 = fully aimed)
  public aimProgress: number = 0;

  // Weapon swap raise/lower: brief weight, buffers the next shot
  public switchTimer: number = 0;
  public readonly switchTime: number = 0.25;

  constructor() {
    this.weapons = [
      new Pistol(),
      new SMG(),
      new Sniper()
    ];

    // Add all weapon models to container, hiding inactive ones
    this.weapons.forEach((w, idx) => {
      w.modelGroup.visible = idx === this.activeIndex;
      this.weaponContainer.add(w.modelGroup);
    });

    this.positionWeaponModel();
  }

  public get activeWeapon(): BaseWeapon {
    return this.weapons[this.activeIndex];
  }

  public switchWeapon(index: number): boolean {
    if (index < 0 || index >= this.weapons.length || index === this.activeIndex) {
      return false;
    }

    // Holster current (reload cancelled, scope dropped)
    const old = this.weapons[this.activeIndex];
    old.modelGroup.visible = false;
    old.isReloading = false;
    old.reloadProgress = 0;
    if (old.type === 'sniper') {
      (old as Sniper).isScoped = false;
    }

    this.activeIndex = index;
    const nextWep = this.weapons[this.activeIndex];
    nextWep.modelGroup.visible = true;
    nextWep.lastFireTime = -10;

    this.switchTimer = this.switchTime;
    soundManager.playWeaponSwitch();
    this.positionWeaponModel();
    return true;
  }

  public nextWeapon(): void {
    const nextIdx = (this.activeIndex + 1) % this.weapons.length;
    this.switchWeapon(nextIdx);
  }

  public prevWeapon(): void {
    const prevIdx = (this.activeIndex - 1 + this.weapons.length) % this.weapons.length;
    this.switchWeapon(prevIdx);
  }

  /**
   * Base hip-fire position of weapon models relative to first-person camera
   */
  private positionWeaponModel(): void {
    const wep = this.activeWeapon;
    switch (wep.type) {
      case 'pistol':
        wep.modelGroup.position.set(0.18, -0.15, -0.38);
        wep.modelGroup.rotation.set(0.04, -0.06, 0.04);
        break;
      case 'smg':
        wep.modelGroup.position.set(0.16, -0.13, -0.40);
        wep.modelGroup.rotation.set(0.03, -0.04, 0.02);
        break;
      case 'sniper':
        wep.modelGroup.position.set(0.18, -0.14, -0.46);
        wep.modelGroup.rotation.set(0.02, -0.04, 0.02);
        break;
    }
  }

  /**
   * Fires the active weapon. Blocked mid-swap (raise/lower weight).
   */
  public fire(
    currentTime: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    isSwinging: boolean,
    raycastTargets: THREE.Object3D[],
    opts?: FireOptions
  ): FireResult | null {
    if (this.switchTimer > 0) return null;
    const wep = this.activeWeapon;

    // NON-NEGOTIABLE RULE: ONLY PISTOL USABLE WHILE SWINGING!
    if (isSwinging && !wep.usableWhileSwinging) {
      soundManager.playEmptyClick();
      return null;
    }

    if (wep.currentAmmo <= 0) {
      soundManager.playEmptyClick();
      this.reload();
      return null;
    }

    const result = wep.fire(currentTime, origin, direction, isSwinging, raycastTargets, opts);
    if (result) {
      // Play weapon-specific audio
      switch (wep.type) {
        case 'pistol':
          soundManager.playPistolShot();
          break;
        case 'smg':
          soundManager.playSMGShot();
          break;
        case 'sniper':
          soundManager.playSniperShot();
          break;
      }

      // Add punchy physical recoil kick
      const kick = wep.recoilAmount * (this.aimProgress > 0.5 ? 0.65 : 1.0);
      this.recoilPos.z += kick * 0.4;
      this.recoilPos.y += kick * 0.12;
      this.recoilRot.x += kick * 0.75;
      this.recoilRot.y += (Math.random() - 0.5) * kick * 0.2;
    }

    return result;
  }

  public reload(): boolean {
    const wep = this.activeWeapon;
    const started = wep.startReload();
    if (started) {
      soundManager.playReload();
    }
    return started;
  }

  public resetAmmo(): void {
    for (const w of this.weapons) {
      w.currentAmmo = w.magazineSize;
      w.reserveAmmo = w.maxReserveAmmo;
      w.isReloading = false;
      w.reloadProgress = 0;
    }
    this.switchTimer = 0;
    this.recoilPos.set(0, 0, 0);
    this.recoilRot.set(0, 0, 0);
    this.aimProgress = 0;
  }

  public update(
    dt: number,
    isSwinging: boolean,
    isAiming: boolean,
    isMoving: boolean,
    moveSpeed: number
  ): void {
    const wep = this.activeWeapon;
    wep.updateReload(dt);
    if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt);

    // Smoothly recover from recoil kick
    this.recoilPos.lerp(this.tmpZero, Math.min(1, dt * this.recoilRecoveryRate));
    this.recoilRot.x = THREE.MathUtils.lerp(this.recoilRot.x, 0, dt * this.recoilRecoveryRate);
    this.recoilRot.y = THREE.MathUtils.lerp(this.recoilRot.y, 0, dt * this.recoilRecoveryRate);

    // Aiming cannot occur while web-swinging
    const canAim = isAiming && !isSwinging;
    const targetAim = canAim ? 1.0 : 0.0;
    this.aimProgress = THREE.MathUtils.lerp(this.aimProgress, targetAim, dt * 14.0);

    // Sniper scope toggle
    if (wep.type === 'sniper') {
      const sniper = wep as Sniper;
      const wasScoped = sniper.isScoped;
      sniper.isScoped = this.aimProgress > 0.65;
      if (sniper.isScoped !== wasScoped && sniper.isScoped) {
        soundManager.playSniperScope();
      }
    }

    // Calculate base pose offsets
    const baseOffset = this.tmpBaseOffset.set(0, 0, 0);
    const baseRot = this.tmpRot.set(0, 0, 0);

    if (isSwinging && !wep.usableWhileSwinging) {
      // Tucked away at hip while one hand is on the web line
      baseOffset.set(0.10, -0.28, -0.30);
      baseRot.set(-0.55, 0.35, -0.15);
    } else if (isSwinging && wep.usableWhileSwinging) {
      // Pistol pointed forward dynamically during aerial swing
      baseOffset.set(0.14, -0.12, -0.40);
      baseRot.set(0.04, -0.04, 0.06);
    } else if (this.aimProgress > 0.05) {
      // ADS / Aim Down Sights Pose
      if (wep.type === 'smg') {
        // Center the holographic sight directly with camera center!
        this.tmpAds.set(-0.16, 0.028, 0.08);
        baseOffset.lerp(this.tmpAds, this.aimProgress);
        baseRot.set(
          THREE.MathUtils.lerp(0.03, -0.01, this.aimProgress),
          THREE.MathUtils.lerp(-0.04, 0.0, this.aimProgress),
          0.0
        );
      } else if (wep.type === 'sniper') {
        // Lower weapon model out of the way so full blueprint scope is unobstructed
        this.tmpAds.set(0.0, -0.35, 0.1);
        baseOffset.lerp(this.tmpAds, this.aimProgress);
      } else {
        // Pistol tactical point
        this.tmpAds.set(-0.10, 0.035, 0.05);
        baseOffset.lerp(this.tmpAds, this.aimProgress);
      }
    } else {
      // Natural walking breathing bob
      const time = performance.now() * 0.003;
      const bobMagnitude = isMoving ? Math.min(moveSpeed * 0.003, 0.018) : 0.003;
      baseOffset.y = Math.sin(time * 2) * bobMagnitude;
      baseOffset.x = Math.cos(time) * (bobMagnitude * 0.5);
    }

    // Apply base positions and add offsets + recoil
    this.positionWeaponModel();
    // Swap dip: gun lowers and rises across the switch window
    if (this.switchTimer > 0) {
      const k = this.switchTimer / this.switchTime;
      baseOffset.y -= Math.sin(k * Math.PI) * 0.12;
      baseRot.x -= Math.sin(k * Math.PI) * 0.35;
    }
    wep.modelGroup.position.add(baseOffset).add(this.recoilPos);
    wep.modelGroup.rotation.set(
      wep.modelGroup.rotation.x + baseRot.x + this.recoilRot.x,
      wep.modelGroup.rotation.y + baseRot.y + this.recoilRot.y,
      wep.modelGroup.rotation.z + baseRot.z
    );
  }
}

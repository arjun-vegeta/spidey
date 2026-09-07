import * as THREE from 'three';
import { BaseWeapon, FireResult, FireOptions } from '../weapons/BaseWeapon';
import { Sword } from '../weapons/Sword';
import { Pistol } from '../weapons/Pistol';
import { SMG } from '../weapons/SMG';
import { Sniper } from '../weapons/Sniper';
import { soundManager } from '../core/SoundManager';
import { Spring3 } from '../core/Spring';

export class WeaponManager {
  public weapons: BaseWeapon[];
  public activeIndex: number = 0;

  // Physical 3D recoil springs (damped harmonic oscillators for punchy weapon kick)
  public recoilSpringPos: Spring3 = new Spring3(260, 18);
  public recoilSpringRot: Spring3 = new Spring3(220, 16);

  // Recoil output vectors (retained for backward compatibility and camera offsets)
  public recoilPos: THREE.Vector3 = new THREE.Vector3();
  public recoilRot: THREE.Euler = new THREE.Euler();
  private tmpBaseOffset: THREE.Vector3 = new THREE.Vector3();
  private tmpAds: THREE.Vector3 = new THREE.Vector3();
  private tmpRot: THREE.Vector3 = new THREE.Vector3();

  // Root container attached to camera
  public weaponContainer: THREE.Group = new THREE.Group();

  // ADS / Aim smoothing factor (0 = hip, 1 = fully aimed)
  public aimProgress: number = 0;

  // Weapon swap raise/lower: brief weight, buffers the next shot
  public switchTimer: number = 0;
  public readonly switchTime: number = 0.25;

  // 1-frame muzzle hand-light pulse timer
  public muzzleFlashTimer: number = 0;

  // SMG horizontal drift: random walk that accumulates while trigger is held
  public smgBurstShots: number = 0;
  public smgHorizontalDrift: number = 0;
  public timeSinceLastFire: number = 0;

  constructor() {
    this.weapons = [
      new Sword(),
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

    // Holster current (reload cancelled, scope dropped, muzzle flash reset)
    const old = this.weapons[this.activeIndex];
    old.modelGroup.visible = false;
    old.isReloading = false;
    old.reloadProgress = 0;
    old.setMuzzleFlash(false);
    if (old.type === 'sniper') {
      (old as Sniper).isScoped = false;
    }

    this.activeIndex = index;
    const nextWep = this.weapons[this.activeIndex];
    nextWep.modelGroup.visible = true;
    nextWep.lastFireTime = -10;

    this.switchTimer = this.switchTime;
    this.muzzleFlashTimer = 0;
    this.smgBurstShots = 0;
    this.smgHorizontalDrift = 0;
    this.recoilSpringPos.reset();
    this.recoilSpringRot.reset();
    this.recoilPos.set(0, 0, 0);
    this.recoilRot.set(0, 0, 0);
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
      case 'sword':
        wep.modelGroup.position.set(0.24, -0.22, -0.38);
        wep.modelGroup.rotation.set(0.65, 0.15, -0.30);
        break;
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

    if (wep.type !== 'sword' && wep.currentAmmo <= 0) {
      soundManager.playEmptyClick();
      this.reload();
      return null;
    }

    const result = wep.fire(currentTime, origin, direction, isSwinging, raycastTargets, opts);
    if (result) {
      this.timeSinceLastFire = 0;
      this.muzzleFlashTimer = 1; // 1-frame muzzle pulse on weapon materials

      // Play weapon-specific audio
      switch (wep.type) {
        case 'sword':
          soundManager.playKatanaSwing();
          break;
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

      // Add punchy physical recoil kick via 3D damped harmonic springs (inspired by inspiration)
      const adsMultiplier = this.aimProgress > 0.5 ? 0.65 : 1.0;
      const kick = wep.recoilAmount * adsMultiplier;

      const kickZ = kick * 1.8;
      const kickY = kick * 0.45;
      const kickX = (Math.random() - 0.5) * kick * 0.25;
      const rotX = kick * 3.4;
      let rotY = (Math.random() - 0.5) * kick * 0.6;
      const rotZ = (Math.random() - 0.5) * kick * 0.4;

      // Mission 2 [12.2]: SMG horizontal drift: random walk that grows while held, keeps ADS 0.65x
      if (wep.type === 'smg') {
        this.smgBurstShots++;
        const driftStep = (Math.random() - 0.5) * 0.0035 * Math.min(this.smgBurstShots, 20);
        this.smgHorizontalDrift += driftStep;
        rotY += this.smgHorizontalDrift * adsMultiplier;
      }

      this.recoilSpringPos.kick(kickX, kickY, kickZ);
      this.recoilSpringRot.kick(rotX, rotY, rotZ);
      this.recoilPos.copy(this.recoilSpringPos.value);
      this.recoilRot.set(
        this.recoilSpringRot.value.x,
        this.recoilSpringRot.value.y,
        this.recoilSpringRot.value.z
      );
    }

    return result;
  }

  public reload(): boolean {
    const wep = this.activeWeapon;
    const started = wep.startReload();
    if (started) {
      soundManager.playReload();
      this.smgBurstShots = 0;
      this.smgHorizontalDrift = 0;
    }
    return started;
  }

  public resetAmmo(): void {
    for (const w of this.weapons) {
      w.currentAmmo = w.magazineSize;
      w.reserveAmmo = w.maxReserveAmmo;
      w.isReloading = false;
      w.reloadProgress = 0;
      w.setMuzzleFlash(false);
      if (w.flashMesh) w.flashMesh.visible = false;
      w.flashTimer = 0;
    }
    this.switchTimer = 0;
    this.muzzleFlashTimer = 0;
    this.smgBurstShots = 0;
    this.smgHorizontalDrift = 0;
    this.timeSinceLastFire = 0;
    this.recoilSpringPos.reset();
    this.recoilSpringRot.reset();
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
    wep.updateFlash(dt);
    if (wep.type === 'sword') {
      (wep as Sword).updateSword(dt);
    }
    if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt);

    // Track firing release to reset SMG horizontal drift
    this.timeSinceLastFire += dt;
    if (this.timeSinceLastFire > 0.15) {
      this.smgBurstShots = 0;
      this.smgHorizontalDrift = 0;
    }

    // 1-frame muzzle flash handling
    if (this.muzzleFlashTimer > 0) {
      wep.setMuzzleFlash(true);
      this.muzzleFlashTimer--;
    } else {
      wep.setMuzzleFlash(false);
    }

    // Smoothly recover from recoil kick via physical spring dynamics
    this.recoilSpringPos.update(dt);
    this.recoilSpringRot.update(dt);
    this.recoilPos.copy(this.recoilSpringPos.value);
    this.recoilRot.set(
      this.recoilSpringRot.value.x,
      this.recoilSpringRot.value.y,
      this.recoilSpringRot.value.z
    );

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

    const effectiveAim = wep.type === 'sword' && (wep as Sword).slashTime > 0
      ? 0
      : this.aimProgress;

    if (isSwinging && !wep.usableWhileSwinging) {
      // Tucked away at hip while one hand is on the web line
      baseOffset.set(0.10, -0.28, -0.30);
      baseRot.set(-0.55, 0.35, -0.15);
    } else if (isSwinging && wep.usableWhileSwinging) {
      if (wep.type === 'sword') {
        // Sword ready to slash dynamically in aerial swing
        baseOffset.set(0.18, -0.16, -0.38);
        baseRot.set(0.55, 0.10, -0.20);
      } else {
        // Pistol pointed forward dynamically during aerial swing
        baseOffset.set(0.14, -0.12, -0.40);
        baseRot.set(0.04, -0.04, 0.06);
      }
    } else if (effectiveAim > 0.05) {
      // ADS / Aim Down Sights Pose
      if (wep.type === 'sword') {
        // Guard / Block Stance (sword held upright across chest, inspired by inspiration)
        this.tmpAds.set(-0.06, 0.06, 0.04);
        baseOffset.lerp(this.tmpAds, effectiveAim);
        baseRot.set(
          THREE.MathUtils.lerp(0, 0.65, effectiveAim),
          THREE.MathUtils.lerp(0, 0.15, effectiveAim),
          THREE.MathUtils.lerp(0, 0.85, effectiveAim)
        );
      } else if (wep.type === 'smg') {
        // Center the optical reflex red dot sight directly with camera center!
        this.tmpAds.set(-0.16, -0.0086, 0.08);
        baseOffset.lerp(this.tmpAds, effectiveAim);
        baseRot.set(
          THREE.MathUtils.lerp(0.03, 0.0, effectiveAim),
          THREE.MathUtils.lerp(-0.04, 0.0, effectiveAim),
          0.0
        );
      } else if (wep.type === 'sniper') {
        // Lower weapon model out of the way so full blueprint scope is unobstructed
        this.tmpAds.set(0.0, -0.35, 0.1);
        baseOffset.lerp(this.tmpAds, effectiveAim);
      } else {
        // Pistol tactical point
        this.tmpAds.set(-0.10, 0.035, 0.05);
        baseOffset.lerp(this.tmpAds, effectiveAim);
      }
    } else {
      // Natural walking breathing bob
      const time = performance.now() * 0.003;
      const bobMagnitude = isMoving ? Math.min(moveSpeed * 0.003, 0.018) : 0.003;
      baseOffset.y = Math.sin(time * 2) * bobMagnitude;
      baseOffset.x = Math.cos(time) * (bobMagnitude * 0.5);
    }

    // Dynamic sword slash animation (sweeping diagonal cut across screen with 3-phase smooth return)
    if (wep.type === 'sword') {
      const sword = wep as Sword;
      if (sword.slashTime > 0) {
        const t = Math.max(0, Math.min(1, 1 - sword.slashTime / sword.slashDuration));
        const s = sword.slashDir;

        if (t < 0.12) {
          // Phase 1: Rapid anticipation / windup (0.00 -> 0.12)
          const p = t / 0.12;
          const e = 1 - Math.pow(1 - p, 3);
          baseRot.x += 0.20 * e;
          baseRot.y -= s * 0.10 * e;
          baseRot.z += s * 0.25 * e;
          baseOffset.x += s * 0.04 * e;
          baseOffset.y += 0.03 * e;
          baseOffset.z -= 0.04 * e;
        } else if (t < 0.54) {
          // Phase 2: Explosive cutting arc through target (0.12 -> 0.54)
          const p = (t - 0.12) / 0.42;
          // Quintic ease in-out for blistering cutting speed
          const e = p < 0.5 ? 16 * Math.pow(p, 5) : 1 - Math.pow(-2 * p + 2, 5) / 2;
          baseRot.x += 0.20 - 0.70 * e;
          baseRot.y += s * (-0.10 + 0.40 * e);
          baseRot.z += s * (0.25 - 1.35 * e);
          baseOffset.x += s * (0.04 - 0.26 * e);
          baseOffset.y += 0.03 - 0.11 * e;
          baseOffset.z -= 0.04 + 0.06 * Math.sin(p * Math.PI);
        } else {
          // Phase 3: Fluid follow-through and seamless recovery to ready stance (0.54 -> 1.00)
          const p = (t - 0.54) / 0.46;
          // Cubic ease-out deceleration arriving smoothly at exact zero
          const k = Math.pow(1 - p, 3);
          baseRot.x += -0.50 * k;
          baseRot.y += s * 0.30 * k;
          baseRot.z += s * -1.10 * k;
          baseOffset.x += s * -0.22 * k;
          baseOffset.y += -0.08 * k;
          baseOffset.z -= 0.04 * k;
        }
      }
    }

    // Mission 4 [13]: Reload performance: while isReloading, tilt + dip weapon
    // Progress-driven: dip down first half (0 -> 0.5), rise second half (0.5 -> 1.0)
    // Monotonically dips on [0, 0.5] and monotonically rises on [0.5, 1.0].
    if (wep.isReloading && wep.reloadTime > 0) {
      const progress = Math.min(1.0, Math.max(0.0, wep.reloadProgress / wep.reloadTime));
      const dipFactor = Math.sin(progress * Math.PI);
      baseOffset.y -= 0.14 * dipFactor;
      baseOffset.z -= 0.04 * dipFactor;
      baseRot.x -= 0.28 * dipFactor;
      baseRot.z += 0.22 * dipFactor;
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

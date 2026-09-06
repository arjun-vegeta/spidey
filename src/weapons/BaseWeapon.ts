import * as THREE from 'three';
import type { Enemy } from '../enemies/Enemy';

export interface FireResult {
  hit: boolean;
  point?: THREE.Vector3;
  normal?: THREE.Vector3;
  distance?: number;
  damage: number;
  isHeadshot: boolean;
  target?: any;
  ray: THREE.Ray;
}

export interface FireOptions {
  moving?: boolean;
  aiming?: boolean;
}

export abstract class BaseWeapon {
  public abstract readonly name: string;
  public abstract readonly type: 'pistol' | 'smg' | 'sniper';
  public abstract readonly usableWhileSwinging: boolean;
  public abstract readonly magazineSize: number;
  public abstract readonly maxReserveAmmo: number;
  public abstract readonly fireRate: number; // Rounds per second
  public abstract readonly damage: number;
  public abstract readonly headshotMultiplier: number;
  public abstract readonly range: number;
  public abstract readonly spread: number; // Spread in radians
  public abstract readonly recoilAmount: number;
  public abstract readonly reloadTime: number; // Seconds
  public abstract readonly flavorText: string;

  // Falloff bands: full damage within falloffStart, linear drop to falloffFloor at falloffEnd
  public abstract readonly falloffStart: number;
  public abstract readonly falloffEnd: number;
  public abstract readonly falloffFloor: number; // Multiplier floor (e.g. 0.6 = 60%, 1.0 = exempt)

  public currentAmmo: number = 0;
  public reserveAmmo: number = 0;
  public isReloading: boolean = false;
  public reloadProgress: number = 0;
  public lastFireTime: number = 0;

  // Visual 3D model container
  public modelGroup: THREE.Group = new THREE.Group();

  // Barrel-tip socket: muzzle flash + tracer origin. Subclasses place it.
  public muzzleTip: THREE.Object3D = new THREE.Object3D();

  // Muzzle hand-light flash materials cache (zero allocations during firing)
  protected flashMaterials: Array<{
    material: THREE.Material;
    origColor: THREE.Color;
    flashColor: THREE.Color;
  }> = [];

  constructor() {}

  /**
   * Register a weapon material to receive the 1-frame muzzle flash emissive pulse.
   */
  public registerFlashMaterial(
    material: THREE.Material,
    origColor: THREE.Color,
    flashColor: THREE.Color
  ): void {
    this.flashMaterials.push({
      material,
      origColor: origColor.clone(),
      flashColor: flashColor.clone()
    });
  }

  /**
   * Set 1-frame muzzle flash state on registered materials (in-place copy, zero allocations).
   */
  public setMuzzleFlash(active: boolean): void {
    for (let i = 0; i < this.flashMaterials.length; i++) {
      const entry = this.flashMaterials[i];
      const mat = entry.material;
      if ('uniforms' in mat && (mat as THREE.ShaderMaterial).uniforms?.uInkColor) {
        const uColor = (mat as THREE.ShaderMaterial).uniforms.uInkColor.value as THREE.Color;
        uColor.copy(active ? entry.flashColor : entry.origColor);
      }
      if ('emissive' in mat && (mat as any).emissive) {
        (mat as any).emissive.copy(active ? entry.flashColor : entry.origColor);
      }
    }
  }

  /** Effective spread in radians for a body state. ADS tightens, motion widens. */
  public spreadFor(moving: boolean, aiming: boolean, swinging: boolean): number {
    let s = this.spread;
    if (aiming) s *= 0.55;
    if (moving) s *= 1.6;
    if (swinging) s *= 1.25;
    return s;
  }

  public initAmmo(): void {
    this.currentAmmo = this.magazineSize;
    this.reserveAmmo = this.maxReserveAmmo;
  }

  public canFire(currentTime: number, isSwinging: boolean): boolean {
    if (this.isReloading) return false;
    if (this.currentAmmo <= 0) return false;
    if (isSwinging && !this.usableWhileSwinging) return false;

    const interval = 1.0 / this.fireRate;
    return (currentTime - this.lastFireTime) >= interval;
  }

  private static sharedRaycaster: THREE.Raycaster = new THREE.Raycaster();
  private static tmpRight: THREE.Vector3 = new THREE.Vector3();
  private static tmpUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  private static tmpHeadCenter: THREE.Vector3 = new THREE.Vector3();

  /**
   * Calculates final damage based on distance falloff bands and headshot multiplier.
   *
   * @param distance Distance in meters from firing origin to hit point.
   * @param isHeadshot Whether the shot hit an enemy weakpoint / head.
   * @returns Final damage value.
   *
   * TUNING:
   * - Inside falloffStart: 100% full damage.
   * - Between falloffStart and falloffEnd: linear decay down to falloffFloor.
   * - At or beyond falloffEnd: floored at falloffFloor (e.g. Pistol 60%, SMG 50%, Sniper exempt at 100%).
   * - Headshots bypass distance falloff to preserve core skill breakpoints (e.g. Pistol headshot 42 * 2.5 = 105
   *   one-taps a 90 HP thug at all ranges; Sniper body one-taps thugs at all ranges).
   */
  public calculateDamage(distance: number, isHeadshot: boolean): number {
    if (isHeadshot) {
      return this.damage * this.headshotMultiplier;
    }

    if (this.falloffStart >= this.falloffEnd || distance <= this.falloffStart) {
      return this.damage;
    }

    if (distance >= this.falloffEnd) {
      return this.damage * this.falloffFloor;
    }

    const t = (distance - this.falloffStart) / (this.falloffEnd - this.falloffStart);
    const falloffFactor = 1.0 - t * (1.0 - this.falloffFloor);
    return this.damage * falloffFactor;
  }

  public fire(
    currentTime: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    isSwinging: boolean,
    raycastTargets: THREE.Object3D[],
    opts?: FireOptions
  ): FireResult | null {
    if (!this.canFire(currentTime, isSwinging)) return null;

    this.currentAmmo--;
    this.lastFireTime = currentTime;

    // Apply state-driven bullet spread (ADS tightens, motion/swing widens)
    const effSpread = this.spreadFor(!!opts?.moving, !!opts?.aiming, isSwinging);
    const spreadAngle = (Math.random() - 0.5) * effSpread;
    const spreadAngleY = (Math.random() - 0.5) * effSpread;
    const shootDir = direction.clone();
    
    // Slight random deviation
    const right = BaseWeapon.tmpRight.crossVectors(direction, BaseWeapon.tmpUp);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    else right.normalize();
    shootDir.addScaledVector(right, spreadAngle);
    shootDir.addScaledVector(BaseWeapon.tmpUp, spreadAngleY);
    shootDir.normalize();

    const raycaster = BaseWeapon.sharedRaycaster;
    raycaster.set(origin, shootDir);
    raycaster.near = 0.1;
    raycaster.far = this.range;
    const intersects = raycaster.intersectObjects(raycastTargets, false);

    const ray = new THREE.Ray(origin.clone(), shootDir.clone());

    if (intersects.length > 0) {
      const hit = intersects[0];
      let isHeadshot = (hit.object.userData && hit.object.userData.isHead) === true;

      // Mission 3 [12.5]: Forgiving drone heads
      // After a non-head hit, if target belongs to an enemy with a headMesh,
      // accept as headshot when hit point is within 0.45m of the head center.
      if (!isHeadshot) {
        let enemy: Enemy | undefined = hit.object.userData?.enemy;
        let curr: THREE.Object3D | null = hit.object;
        while (!enemy && curr) {
          if (curr.userData?.enemy) {
            enemy = curr.userData.enemy as Enemy;
            break;
          }
          curr = curr.parent;
        }
        if (enemy && enemy.headMesh) {
          enemy.headMesh.getWorldPosition(BaseWeapon.tmpHeadCenter);
          if (hit.point.distanceTo(BaseWeapon.tmpHeadCenter) <= 0.45) {
            isHeadshot = true;
          }
        }
      }

      const dist = hit.distance !== undefined ? hit.distance : 0;
      const finalDamage = this.calculateDamage(dist, isHeadshot);

      let worldNormal: THREE.Vector3 | undefined;
      if (hit.face) {
        worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      }

      return {
        hit: true,
        point: hit.point.clone(),
        normal: worldNormal,
        distance: hit.distance,
        damage: finalDamage,
        isHeadshot,
        target: hit.object,
        ray
      };
    }

    return {
      hit: false,
      damage: 0,
      isHeadshot: false,
      ray
    };
  }

  public startReload(): boolean {
    if (this.isReloading) return false;
    if (this.currentAmmo >= this.magazineSize) return false;
    if (this.reserveAmmo <= 0) return false;

    this.isReloading = true;
    this.reloadProgress = 0;
    return true;
  }

  public updateReload(dt: number): boolean {
    if (!this.isReloading) return false;

    this.reloadProgress += dt;
    if (this.reloadProgress >= this.reloadTime) {
      this.finishReload();
      return true;
    }
    return false;
  }

  protected finishReload(): void {
    const needed = this.magazineSize - this.currentAmmo;
    const toLoad = Math.min(needed, this.reserveAmmo);
    this.currentAmmo += toLoad;
    this.reserveAmmo -= toLoad;
    this.isReloading = false;
    this.reloadProgress = 0;
  }
}

import * as THREE from 'three';

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

  public currentAmmo: number = 0;
  public reserveAmmo: number = 0;
  public isReloading: boolean = false;
  public reloadProgress: number = 0;
  public lastFireTime: number = 0;

  // Visual 3D model container
  public modelGroup: THREE.Group = new THREE.Group();

  constructor() {}

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

  public fire(
    currentTime: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    isSwinging: boolean,
    raycastTargets: THREE.Object3D[]
  ): FireResult | null {
    if (!this.canFire(currentTime, isSwinging)) return null;

    this.currentAmmo--;
    this.lastFireTime = currentTime;

    // Apply random bullet spread
    const spreadAngle = (Math.random() - 0.5) * this.spread;
    const spreadAngleY = (Math.random() - 0.5) * this.spread;
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
      const isHeadshot = (hit.object.userData && hit.object.userData.isHead) === true;
      const finalDamage = isHeadshot ? this.damage * this.headshotMultiplier : this.damage;

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

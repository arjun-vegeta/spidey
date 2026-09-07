import * as THREE from 'three';
import { BaseWeapon, FireResult, FireOptions } from './BaseWeapon';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import type { Enemy } from '../enemies/Enemy';

/**
 * ====================================================================
 * WEAPON TUNING SPECIFICATION: SWORD (KATANA)
 * --------------------------------------------------------------------
 * Weapon:                  Sword (Forged Ink Katana)
 * Damage:                  75
 * Headshot Multiplier:     1.5x (112.5 dmg)
 * Range:                   3.8m (melee sweep arc)
 * Rate of Fire:            3.2 swings/s (0.31s cycle)
 * Magazine / Reserve:      Infinite (melee, no reload needed)
 * Usability:               Ground and aerial web-swinging ready!
 * ====================================================================
 */
export class Sword extends BaseWeapon {
  public readonly name = 'SWORD';
  public readonly type = 'sword' as const;
  public readonly usableWhileSwinging = true;
  public readonly magazineSize = 1;
  public readonly maxReserveAmmo = 1;
  public readonly fireRate = 3.4;
  public readonly damage = 75;
  public readonly headshotMultiplier = 1.5;
  public readonly range = 3.8;
  public readonly falloffStart = 3.8;
  public readonly falloffEnd = 3.8;
  public readonly falloffFloor = 1.0;
  public readonly spread = 0.0;
  public readonly recoilAmount = 0.05;
  public readonly reloadTime = 0.0;
  public readonly flavorText = 'single forged steel sword · razor-sharp needle tip · quick slash combo · block to guard';

  // Kinetic feel: heavy visceral camera impulse and high trauma screen shake
  public override camKick: [number, number] = [0.035, 0.015];
  public override fovKick: number = 2.0;
  public override shakeAmount: number = 0.12;
  public override tracerThickness: number = 0.035;
  public override tracerColor: THREE.Color = new THREE.Color(0xdfe6e9);
  public override flashScale: number = 0.8;
  public override flashColorHex: number = 0xdfe6e9;

  // Combo & slash state
  public combo: number = 0;
  public comboTimer: number = 0;
  public slashTime: number = 0;
  public readonly slashDuration: number = 0.28;
  public isSlashing: boolean = false;
  public slashDir: number = 1; // 1 = right-to-left, -1 = left-to-right

  // Zero-allocation scratch vectors
  private static tmpTargetPos: THREE.Vector3 = new THREE.Vector3();
  private static tmpDirToTarget: THREE.Vector3 = new THREE.Vector3();

  constructor() {
    super();
    this.initAmmo();
    this.buildModel();
  }

  public updateSword(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
      }
    }

    if (this.slashTime > 0) {
      this.slashTime -= dt;
      if (this.slashTime <= 0) {
        this.isSlashing = false;
      }
    }
  }

  /**
   * Creates a single-metal forged blade geometry with a razor-sharp needle point tip.
   * Constructed with exact vertex normals and zero gaps.
   */
  public static createSharpBladeGeometry(): THREE.BufferGeometry {
    const geom = new THREE.BufferGeometry();

    // Stations along the blade from guard (z = -0.04) to start of kissaki taper (z = -0.84)
    const stations = [
      { z: -0.04, spineY: 0.016, ridgeY: 0.002, ridgeX: 0.0055, edgeY: -0.016 },
      { z: -0.25, spineY: 0.016, ridgeY: 0.002, ridgeX: 0.0052, edgeY: -0.016 },
      { z: -0.55, spineY: 0.015, ridgeY: 0.002, ridgeX: 0.0048, edgeY: -0.015 },
      { z: -0.74, spineY: 0.014, ridgeY: 0.002, ridgeX: 0.0042, edgeY: -0.014 },
      { z: -0.84, spineY: 0.011, ridgeY: 0.004, ridgeX: 0.0024, edgeY: -0.004 }
    ];

    const positions: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      const v = (s.z + 0.90) / 0.86;
      // 0: top spine
      positions.push(0, s.spineY, s.z);
      uvs.push(0.5, v);
      // 1: left ridge
      positions.push(-s.ridgeX, s.ridgeY, s.z);
      uvs.push(0.0, v);
      // 2: right ridge
      positions.push(s.ridgeX, s.ridgeY, s.z);
      uvs.push(1.0, v);
      // 3: bottom edge
      positions.push(0, s.edgeY, s.z);
      uvs.push(0.5, v);
    }

    // Needle-sharp tip vertex: width and thickness converge to zero at [0, 0.007, -0.90]!
    const tipZ = -0.90;
    const tipY = 0.007;
    positions.push(0, tipY, tipZ);
    uvs.push(0.5, 0.0);
    const tipIndex = stations.length * 4;

    const indices: number[] = [];

    for (let i = 0; i < stations.length - 1; i++) {
      const t0 = i * 4 + 0;
      const l0 = i * 4 + 1;
      const r0 = i * 4 + 2;
      const b0 = i * 4 + 3;

      const t1 = (i + 1) * 4 + 0;
      const l1 = (i + 1) * 4 + 1;
      const r1 = (i + 1) * 4 + 2;
      const b1 = (i + 1) * 4 + 3;

      // Top-Left facet (normal points outward -X, +Y)
      indices.push(t0, l1, l0);
      indices.push(t0, t1, l1);

      // Top-Right facet (normal points outward +X, +Y)
      indices.push(t0, r0, r1);
      indices.push(t0, r1, t1);

      // Bottom-Left facet (normal points outward -X, -Y)
      indices.push(l0, b1, b0);
      indices.push(l0, l1, b1);

      // Bottom-Right facet (normal points outward +X, -Y)
      indices.push(r0, b0, b1);
      indices.push(r0, b1, r1);
    }

    // Converge the last station facets into the needle-sharp tip vertex
    const last = stations.length - 1;
    const lt = last * 4 + 0;
    const ll = last * 4 + 1;
    const lr = last * 4 + 2;
    const lb = last * 4 + 3;

    // Top-Left to sharp tip
    indices.push(lt, tipIndex, ll);
    // Top-Right to sharp tip
    indices.push(lt, lr, tipIndex);
    // Bottom-Left to sharp tip
    indices.push(ll, tipIndex, lb);
    // Bottom-Right to sharp tip
    indices.push(lr, lb, tipIndex);

    // Back cap at guard (Z = -0.04, normal points +Z)
    indices.push(0, 1, 3);
    indices.push(0, 3, 2);

    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    return geom;
  }

  private buildModel(): void {
    // 1. Polished Chrome Steel for primary blade
    const steelMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0xdce6e9),
      useUv: true,
      uvScale: 1.5
    });

    // 2. Brushed Solid Steel for crossguard & collar
    const guardSteelMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x95a5a6),
      useUv: true,
      uvScale: 2.0
    });

    // 3. Gunmetal Turned Steel for grip core & fuller groove
    const gunmetalMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x57606f),
      useUv: true,
      uvScale: 2.2
    });

    // 4. Machined Steel Rings for hilt grip texture
    const gripRingMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x747d8c),
      useUv: true,
      uvScale: 2.0
    });

    // Register single metal materials for flash pulse on swing
    this.registerFlashMaterial(steelMat, new THREE.Color(0xdce6e9), new THREE.Color(0xffffff));
    this.registerFlashMaterial(guardSteelMat, new THREE.Color(0x95a5a6), new THREE.Color(0xdfe6e9));

    // 1. Primary Blade with Needle-Sharp Tip (Continuous single forged metal geometry)
    const bladeGeom = Sword.createSharpBladeGeometry();
    const bladeMesh = new THREE.Mesh(bladeGeom, steelMat);
    bladeMesh.add(InkShaderMaterial.createEdgeLines(bladeGeom, InkShaderMaterial.defaultInkColor, 14));
    this.modelGroup.add(bladeMesh);

    // 2. Inset Fuller / Blood Groove down the flat of the metal blade (left and right)
    const fullerGeom = new THREE.BoxGeometry(0.002, 0.004, 0.58);
    const leftFuller = new THREE.Mesh(fullerGeom, gunmetalMat);
    leftFuller.position.set(-0.005, 0.002, -0.40);
    this.modelGroup.add(leftFuller);

    const rightFuller = new THREE.Mesh(fullerGeom, gunmetalMat);
    rightFuller.position.set(0.005, 0.002, -0.40);
    this.modelGroup.add(rightFuller);

    // 3. Solid Metal Crossguard (Brushed steel forged with the blade)
    const guardGeom = new THREE.BoxGeometry(0.024, 0.076, 0.016);
    const guardMesh = new THREE.Mesh(guardGeom, guardSteelMat);
    guardMesh.position.set(0, 0, -0.02);
    guardMesh.add(InkShaderMaterial.createEdgeLines(guardGeom));
    this.modelGroup.add(guardMesh);

    // Steel blade collar
    const collarGeom = new THREE.BoxGeometry(0.014, 0.038, 0.024);
    const collarMesh = new THREE.Mesh(collarGeom, guardSteelMat);
    collarMesh.position.set(0, 0, -0.032);
    collarMesh.add(InkShaderMaterial.createEdgeLines(collarGeom));
    this.modelGroup.add(collarMesh);

    // 4. Solid Metal Hilt (Turned gunmetal steel)
    const hiltGeom = new THREE.CylinderGeometry(0.013, 0.014, 0.22, 12);
    const hiltMesh = new THREE.Mesh(hiltGeom, gunmetalMat);
    hiltMesh.rotation.x = Math.PI / 2;
    hiltMesh.position.set(0, 0, 0.10);
    hiltMesh.add(InkShaderMaterial.createEdgeLines(hiltGeom));
    this.modelGroup.add(hiltMesh);

    // Machined metallic grip rings for textured steel handling
    for (let i = 0; i < 5; i++) {
      const ringGeom = new THREE.CylinderGeometry(0.0148, 0.0148, 0.016, 12);
      const ringMesh = new THREE.Mesh(ringGeom, gripRingMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.set(0, 0, 0.026 + i * 0.038);
      ringMesh.add(InkShaderMaterial.createEdgeLines(ringGeom));
      this.modelGroup.add(ringMesh);
    }

    // 5. Solid Steel Pommel (Faceted steel counterweight)
    const pommelGeom = new THREE.CylinderGeometry(0.018, 0.013, 0.030, 8);
    const pommelMesh = new THREE.Mesh(pommelGeom, guardSteelMat);
    pommelMesh.rotation.x = Math.PI / 2;
    pommelMesh.position.set(0, 0, 0.225);
    pommelMesh.add(InkShaderMaterial.createEdgeLines(pommelGeom));
    this.modelGroup.add(pommelMesh);

    // Tip socket located precisely at the sharp needle tip (z = -0.90)
    this.muzzleTip.position.set(0, 0.007, -0.90);
    this.modelGroup.add(this.muzzleTip);
    this.initMuzzleFlash();

    this.modelGroup.scale.set(1.0, 1.0, 1.0);
  }

  public override fire(
    currentTime: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    isSwinging: boolean,
    raycastTargets: THREE.Object3D[],
    _opts?: FireOptions
  ): FireResult | null {
    if (!this.canFire(currentTime, isSwinging)) return null;

    this.lastFireTime = currentTime;
    this.combo++;
    this.comboTimer = 0.85;
    this.slashTime = this.slashDuration;
    this.isSlashing = true;
    this.slashDir = this.combo % 2 === 0 ? -1 : 1;
    this.triggerFlash();

    // 1. Direct forward raycast (up to melee range)
    const raycaster = (BaseWeapon as any).sharedRaycaster as THREE.Raycaster;
    raycaster.set(origin, direction);
    raycaster.near = 0.1;
    raycaster.far = this.range;
    const directHits = raycaster.intersectObjects(raycastTargets, false);

    let bestHitObject: THREE.Object3D | null = null;
    let bestDistance = this.range + 1;
    let bestPoint: THREE.Vector3 | null = null;
    let bestNormal: THREE.Vector3 | undefined = undefined;
    let isHead = false;

    if (directHits.length > 0) {
      const h0 = directHits[0];
      bestHitObject = h0.object;
      bestDistance = h0.distance ?? 0;
      bestPoint = h0.point.clone();
      if (h0.face) {
        bestNormal = h0.face.normal.clone().transformDirection(h0.object.matrixWorld);
      }
      isHead = (h0.object.userData && h0.object.userData.isHead) === true;
    }

    // 2. Wide forward arc check: sweeps melee cone (~53° cone, 3.8m range)
    // Ensures fast diagonal slashes connect reliably even when slightly off center
    for (let i = 0; i < raycastTargets.length; i++) {
      const obj = raycastTargets[i];
      let enemy: Enemy | undefined = obj.userData?.enemy;
      let curr: THREE.Object3D | null = obj;
      while (!enemy && curr) {
        if (curr.userData?.enemy) {
          enemy = curr.userData.enemy as Enemy;
          break;
        }
        curr = curr.parent;
      }

      if (enemy && !enemy.isDead) {
        obj.getWorldPosition(Sword.tmpTargetPos);
        const dist = origin.distanceTo(Sword.tmpTargetPos);
        if (dist <= this.range && dist < bestDistance) {
          Sword.tmpDirToTarget.subVectors(Sword.tmpTargetPos, origin).normalize();
          const dot = direction.dot(Sword.tmpDirToTarget);
          if (dot >= 0.60) {
            bestHitObject = obj;
            bestDistance = dist;
            bestPoint = Sword.tmpTargetPos.clone();
            isHead = (obj.userData && obj.userData.isHead) === true;
          }
        }
      }
    }

    const ray = new THREE.Ray(origin.clone(), direction.clone());

    if (bestHitObject && bestPoint) {
      const finalDamage = this.calculateDamage(bestDistance, isHead);
      return {
        hit: true,
        point: bestPoint,
        normal: bestNormal,
        distance: bestDistance,
        damage: finalDamage,
        isHeadshot: isHead,
        target: bestHitObject,
        ray,
        weapon: this
      };
    }

    return {
      hit: false,
      damage: 0,
      isHeadshot: false,
      ray,
      weapon: this
    };
  }
}

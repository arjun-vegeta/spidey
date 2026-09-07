import * as THREE from 'three';
import { Enemy, EnemyState } from './Enemy';
import { soundManager } from '../core/SoundManager';

/**
 * High-vantage marksman perched on construction cranes, rooftops, and catwalk beams.
 * Projects a visible red laser sight line tracking Spider-Man.
 * Charges for 2.0 seconds with intensifying visual pulse before unleashing a high-damage sniper tracer.
 */
export class SniperEnemy extends Enemy {
  // Sniper combat parameters
  private maxSniperRange: number = 95.0;
  private minSniperRange: number = 6.0;
  private chargeDuration: number = 2.0;
  private chargeTimer: number = 0;
  private shotCooldownTimer: number = 1.0;
  private readonly shotCooldown: number = 2.8;

  // Visual rig parts
  private rifleGroup!: THREE.Group;
  private muzzleSocket!: THREE.Object3D;
  private glintMesh!: THREE.Mesh;

  // Red laser sight tracking line
  private laserLine!: THREE.Line;
  private laserGeometry!: THREE.BufferGeometry;
  private laserMaterial!: THREE.LineBasicMaterial;
  private laserPositions!: Float32Array;
  private isAimingAtPlayer: boolean = false;
  private currentAimTarget: THREE.Vector3 = new THREE.Vector3();

  // Raycaster for line-of-sight checks against architecture
  private losRaycaster: THREE.Raycaster = new THREE.Raycaster();
  private tmpMyPos: THREE.Vector3 = new THREE.Vector3();
  private tmpMuzzle: THREE.Vector3 = new THREE.Vector3();
  private tmpTarget: THREE.Vector3 = new THREE.Vector3();
  private tmpDir: THREE.Vector3 = new THREE.Vector3();
  private tmpFlat: THREE.Vector3 = new THREE.Vector3();
  private tmpDown: THREE.Vector3 = new THREE.Vector3();
  private losTimer: number = 0;
  private losClear: boolean = false;

  // Fairness gates: max 2 concurrent chargers, pre-charge glint, late-wave reposition
  private static activeChargers: number = 0;
  private chargingToken: boolean = false;
  private preCharge: number = 0;
  private shotsFired: number = 0;
  private repositionTarget: THREE.Vector3 | null = null;
  private repositionTelegraphTimer: number = 0;
  private hasChargeSound: boolean = false;
  private blockedLosTimer: number = 0;
  private tmpCandidatePerch: THREE.Vector3 = new THREE.Vector3();

  public static resetStaticState(): void {
    SniperEnemy.activeChargers = 0;
  }

  constructor(position: THREE.Vector3) {
    // 70 HP: high damage glass cannon (1 sniper headshot or 3 pistol shots)
    super('sniper', 70, position);
    this.scoreValue = 200;
    this.xpValue = 50;
    this.eyeHeight = 1.6;

    this.buildModel();
    this.initLaserSight();
  }

  protected buildModel(): void {
    const root = new THREE.Group();
    root.name = 'SniperModel';

    // 1. Torso (Braced marksman stance)
    const torsoGroup = new THREE.Group();
    torsoGroup.position.set(0, 0.95, 0);

    const torsoGeom = new THREE.BoxGeometry(0.48, 0.6, 0.32);
    const torsoMesh = this.createMesh(torsoGeom, this.primaryEnemyMat, false, true);
    torsoGroup.add(torsoMesh);

    // Cape / hooded cloak shoulder mantle
    const mantleGeom = new THREE.BoxGeometry(0.56, 0.25, 0.36);
    const mantleMesh = this.createMesh(mantleGeom, this.accentRedMat, false, true);
    mantleMesh.position.set(0, 0.22, 0);
    torsoGroup.add(mantleMesh);

    // Long coat skirt: tall still silhouette vs the bulky thug, flares over the perch.
    const coatGeom = new THREE.BoxGeometry(0.5, 0.5, 0.34);
    const coat = this.createMesh(coatGeom, this.primaryEnemyMat, false, false);
    coat.position.set(0, -0.42, -0.02);
    torsoGroup.add(coat);
    // Hood peak: triangular read from the side so the head never confuses with a thug (red ink).
    const peakGeom = new THREE.BoxGeometry(0.16, 0.1, 0.22);
    const peak = this.createMesh(peakGeom, this.accentRedMat, false, false);
    peak.position.set(0, 0.62, 0.1);
    torsoGroup.add(peak);

    // 2. Distinct Head / Hooded Sniper Mask Weakpoint (Red Ink Accent!)
    const headGeom = new THREE.BoxGeometry(0.3, 0.32, 0.3);
    const headMesh = this.createMesh(headGeom, this.accentRedMat, true, true);
    headMesh.position.set(0, 0.48, 0);
    torsoGroup.add(headMesh);

    // Sniper ocular scope monocle (bright red ink eye)
    const ocularGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8);
    ocularGeom.rotateX(Math.PI * 0.5);
    const ocularMesh = this.createMesh(ocularGeom, this.accentRedMat, true, false);
    ocularMesh.position.set(0.08, 0.5, 0.16);
    torsoGroup.add(ocularMesh);

    // 3. Braced Legs (Narrow beam crouch)
    const legWidth = 0.16;
    const legHeight = 0.75;
    const legGeom = new THREE.BoxGeometry(legWidth, legHeight, 0.22);
    const kneeGeom = new THREE.BoxGeometry(0.18, 0.16, 0.14);

    const leftLeg = this.createMesh(legGeom, this.primaryEnemyMat, false, true);
    leftLeg.position.set(-0.16, 0.38, 0.05);
    leftLeg.rotation.x = -0.15;
    const leftKnee = this.createMesh(kneeGeom, this.accentRedMat, false, false);
    leftKnee.position.set(0, -0.05, 0.12);
    leftLeg.add(leftKnee);
    root.add(leftLeg);

    const rightLeg = this.createMesh(legGeom, this.primaryEnemyMat, false, true);
    rightLeg.position.set(0.16, 0.38, -0.05);
    rightLeg.rotation.x = 0.15;
    const rightKnee = this.createMesh(kneeGeom, this.accentRedMat, false, false);
    rightKnee.position.set(0, -0.05, 0.12);
    rightLeg.add(rightKnee);
    root.add(rightLeg);

    // 4. Heavy Anti-Materiel Sketch Sniper Rifle
    this.rifleGroup = new THREE.Group();
    this.rifleGroup.position.set(0.2, 0.1, 0.15);

    // Rifle Receiver
    const receiverGeom = new THREE.BoxGeometry(0.1, 0.14, 0.6);
    const receiver = this.createMesh(receiverGeom, this.primaryEnemyMat, false, false);
    receiver.position.set(0, 0, 0.15);
    this.rifleGroup.add(receiver);

    // Long Sniper Barrel (crimson red ink)
    const barrelGeom = new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6);
    barrelGeom.rotateX(Math.PI * 0.5);
    const barrel = this.createMesh(barrelGeom, this.accentRedMat, false, false);
    barrel.position.set(0, 0.02, 0.95);
    this.rifleGroup.add(barrel);

    // Red ink Muzzle Brake
    const brakeGeom = new THREE.BoxGeometry(0.07, 0.07, 0.16);
    const brake = this.createMesh(brakeGeom, this.accentRedMat, false, false);
    brake.position.set(0, 0.02, 1.58);
    this.rifleGroup.add(brake);

    // High-magnification Scope (red ink)
    const scopeTubeGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8);
    scopeTubeGeom.rotateX(Math.PI * 0.5);
    const scopeTube = this.createMesh(scopeTubeGeom, this.accentRedMat, false, false);
    scopeTube.position.set(0, 0.12, 0.2);
    this.rifleGroup.add(scopeTube);

    // Scope Red Lens
    const lensGeom = new THREE.CircleGeometry(0.038, 8);
    const lens = this.createMesh(lensGeom, this.accentRedMat, false, false);
    lens.position.set(0, 0.12, 0.43);
    this.rifleGroup.add(lens);

    // Reposition telegraph glint star (visible during 0.5s pre-dash at current perch)
    const glintGeom = new THREE.OctahedronGeometry(0.18, 0);
    this.glintMesh = new THREE.Mesh(glintGeom, this.accentRedMat);
    this.glintMesh.position.set(0, 0.12, 0.44);
    this.glintMesh.visible = false;
    this.glintMesh.userData = { isDecor: true };
    this.rifleGroup.add(this.glintMesh);

    // Muzzle Socket
    this.muzzleSocket = new THREE.Object3D();
    this.muzzleSocket.position.set(0, 0.02, 1.66);
    this.rifleGroup.add(this.muzzleSocket);

    torsoGroup.add(this.rifleGroup);
    root.add(torsoGroup);
    this.group.add(root);
  }

  /**
   * Initializes the red laser sight tracking line
   */
  private initLaserSight(): void {
    this.laserPositions = new Float32Array(6); // 2 points x 3 coords
    this.laserGeometry = new THREE.BufferGeometry();
    this.laserGeometry.setAttribute('position', new THREE.BufferAttribute(this.laserPositions, 3));

    this.laserMaterial = new THREE.LineBasicMaterial({
      color: 0xd63031, // Red ink
      linewidth: 2,
      transparent: true,
      opacity: 0.0
    });

    this.laserLine = new THREE.Line(this.laserGeometry, this.laserMaterial);
    this.laserLine.frustumCulled = false;
    this.laserLine.visible = false;
    this.group.add(this.laserLine);
  }

  protected updateAI(dt: number, playerPos: THREE.Vector3, collidables: THREE.Mesh[]): void {
    this.tmpMyPos.copy(this.group.position);
    this.group.updateMatrixWorld(true);

    const distToPlayer = this.tmpMyPos.distanceTo(playerPos);

    // Laser aim recovery if rifle kicked back
    this.rifleGroup.position.z = THREE.MathUtils.lerp(this.rifleGroup.position.z, 0.15, dt * 10.0);
    this.rifleGroup.rotation.x = THREE.MathUtils.lerp(this.rifleGroup.rotation.x, 0, dt * 10.0);

    // Check if player is within sniper range (unless completing a reposition dash)
    if ((distToPlayer > this.maxSniperRange || distToPlayer < this.minSniperRange) && !this.repositionTarget) {
      this.cancelAim();
      return;
    }

    // Line of sight check (throttled to every 0.15s, non-recursive for perf)
    this.muzzleSocket.getWorldPosition(this.tmpMuzzle);

    // Chest aim: above a half-height rail standing, below it crouched.
    this.tmpTarget.copy(playerPos);
    this.tmpTarget.y = this.resolveAimY(playerPos);
    this.tmpDir.copy(this.tmpTarget).sub(this.tmpMuzzle);
    const targetDist = this.tmpDir.length();

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.15;
      if (this.worldCollider) {
        this.losClear = this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.tmpTarget);
      } else {
        if (targetDist > 1e-4) {
          this.tmpDir.multiplyScalar(1.0 / targetDist);
          this.losRaycaster.set(this.tmpMuzzle, this.tmpDir);
          this.losRaycaster.far = targetDist;
          const hits = this.losRaycaster.intersectObjects(collidables, false);
          this.losClear = hits.length === 0 || hits[0].distance >= targetDist - 0.5;
        } else {
          this.losClear = true;
        }
      }
    }

    if (!this.losClear) {
      this.cancelAim();
      if (this.alerted && !this.repositionTarget) {
        this.blockedLosTimer += dt;
        if (this.blockedLosTimer > 1.8) {
          this.blockedLosTimer = 0;
          this.tryRepositionAroundObstacle(playerPos, collidables);
        }
      }
      // If repositioning around an obstacle, let the dash execute below
      if (!this.repositionTarget) {
        return;
      }
    } else {
      this.blockedLosTimer = 0;
    }

    // Alert sniper
    if (!this.alerted) {
      this.alert(playerPos);
    }

    // Face player
    this.facePosition(playerPos);

    // Perch lock: snipers never drift, sink, or hover — Y is the perch floor.
    if (this.worldCollider) {
      const perchGround = this.worldCollider.groundAt(
        this.group.position.x, this.group.position.y, this.group.position.z, 0.6
      );
      if (perchGround !== null && Math.abs(perchGround - this.group.position.y) < 1.0) {
        this.group.position.y = perchGround;
      }
    }

    // Reposition dash (late waves): telegraph at CURRENT perch for 0.5s with glint, then dash
    if (this.repositionTarget) {
      if (this.repositionTelegraphTimer > 0) {
        this.repositionTelegraphTimer -= dt;
        this.glintMesh.visible = true;
        const progress = Math.max(0, this.repositionTelegraphTimer / 0.5);
        const pulse = 1.0 + Math.sin(progress * Math.PI) * 1.5;
        this.glintMesh.scale.set(pulse, pulse, pulse);

        if (this.repositionTelegraphTimer <= 0) {
          this.glintMesh.visible = false;
          // Re-validate the perch at dash time: floor gone or wall raised = stay.
          if (!this.validatePerch(this.repositionTarget, collidables)) {
            this.repositionTarget = null;
            this.facePosition(playerPos);
            return;
          }
        }
        this.facePosition(playerPos);
        return;
      }

      this.tmpDir.copy(this.repositionTarget).sub(this.group.position);
      this.tmpDir.y = 0;
      const rd = this.tmpDir.length();
      if (rd < 0.6) {
        this.repositionTarget = null;
      } else {
        this.tmpDir.normalize();
        const step = Math.min(9.0 * this.speedMultiplier * dt, rd);
        const nx = this.group.position.x + this.tmpDir.x * step;
        const nz = this.group.position.z + this.tmpDir.z * step;
        if (this.worldCollider) {
          // Wall in the dash lane: abort, keep the known-good perch.
          this.worldCollider.pushOut(nx, nz, 0.55, this.group.position.y, this.group.position.y + 1.8, this.pushScratch);
          const bx = this.pushScratch.pushed ? this.pushScratch.x : nx;
          const bz = this.pushScratch.pushed ? this.pushScratch.z : nz;
          const fg = this.worldCollider.groundAt(bx, this.group.position.y, bz, 0.6);
          if (this.pushScratch.pushed || fg === null || Math.abs(fg - this.group.position.y) > 1.0) {
            this.repositionTarget = null;
            this.facePosition(playerPos);
            return;
          }
          this.group.position.x = bx;
          this.group.position.z = bz;
          this.group.position.y = fg;
        } else {
          this.group.position.addScaledVector(this.tmpDir, step);
        }
        this.facePosition(playerPos);
        return;
      }
    }

    if (!this.losClear) {
      this.cancelAim();
      return;
    }

    // Spawn grace: track but never shoot during sketch-in (cooldown runs under it)
    if (this.shotCooldownTimer > 0) this.shotCooldownTimer -= dt;
    if (this.spawnGrace > 0) {
      this.cancelAim();
      return;
    }

    // Check shot cooldown
    if (this.shotCooldownTimer > 0) {
      this.cancelAim();
      return;
    }

    // Pre-charge glint: 0.5s faint tracking beam before the real charge (fairness)
    if (!this.chargingToken) {
      this.preCharge += dt;
      this.currentAimTarget.lerp(this.tmpTarget, Math.min(1, dt * 8.0));
      this.updateLaserSight(this.tmpMuzzle, this.currentAimTarget, 0.25);
      if (this.preCharge < 0.5) return;
      // Max 2 concurrent chargers — extras hold at glint until a slot frees
      if (SniperEnemy.activeChargers >= 2) return;
      SniperEnemy.activeChargers++;
      this.chargingToken = true;
      this.preCharge = 0;
    }

    // Charge Sniper Laser! (Smoothly chases player like inspiration, letting athletic players dodge)
    this.state = EnemyState.ATTACK;
    this.isAimingAtPlayer = true;
    if (!this.hasChargeSound) {
      this.hasChargeSound = true;
      soundManager.startSniperCharge();
    }
    const trackSpeed = 1 - Math.exp(-3.2 * dt);
    this.currentAimTarget.lerp(this.tmpTarget, trackSpeed);
    this.chargeTimer += dt;
    soundManager.updateSniperCharge(this.chargeTimer / this.chargeDuration);

    // Update laser visual
    this.updateLaserSight(this.tmpMuzzle, this.currentAimTarget);

    // 2.0s charge complete: FIRE!
    if (this.chargeTimer >= this.chargeDuration) {
      // Abort firing if player stepped behind a wall or obstacle
      if (this.worldCollider && !this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.currentAimTarget)) {
        this.cancelAim();
        return;
      }
      if (this.hasChargeSound) {
        this.hasChargeSound = false;
        soundManager.stopSniperCharge();
      }
      this.fireSniperShot(this.tmpMuzzle, this.currentAimTarget, collidables);
      this.chargeTimer = 0;
      this.shotCooldownTimer = this.shotCooldown;
      this.cancelAim();
    }
  }

  /**
   * Updates red laser beam geometry and tension pulse
   */
  private tmpStartLocal: THREE.Vector3 = new THREE.Vector3();
  private tmpEndLocal: THREE.Vector3 = new THREE.Vector3();

  private updateLaserSight(startWorld: THREE.Vector3, endWorld: THREE.Vector3, opacityCap: number = 1.0): void {
    this.laserLine.visible = true;

    // Clamp laser beam to solid obstacles/walls if world collider is present
    let beamEnd = endWorld;
    if (this.worldCollider) {
      this.tmpDir.copy(endWorld).sub(startWorld);
      const beamDist = this.tmpDir.length();
      if (beamDist > 1e-4) {
        this.tmpDir.multiplyScalar(1.0 / beamDist);
        const wallHit = this.worldCollider.raycast(startWorld, this.tmpDir, beamDist);
        if (wallHit && wallHit.dist < beamDist) {
          beamEnd = wallHit.point;
        }
      }
    }

    // Transform points into local sniper space (reused temps)
    const startLocal = this.tmpStartLocal.copy(startWorld);
    this.group.worldToLocal(startLocal);

    // Pull beam back slightly before the target so it doesn't clip directly into the camera (inspiration)
    const dist = beamEnd.distanceTo(startWorld);
    if (dist > 2.0) {
      this.tmpEndLocal.copy(startWorld).lerp(beamEnd, (dist - 1.5) / dist);
    } else {
      this.tmpEndLocal.copy(beamEnd);
    }
    const endLocal = this.tmpEndLocal;
    this.group.worldToLocal(endLocal);

    const posAttr = this.laserGeometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, startLocal.x, startLocal.y, startLocal.z);
    posAttr.setXYZ(1, endLocal.x, endLocal.y, endLocal.z);
    posAttr.needsUpdate = true;

    // Laser pulse effect: opacity increases and strobes rapidly near 2.0s charge
    const chargeProgress = Math.min(1.0, this.chargeTimer / this.chargeDuration);
    const strobeFreq = 8.0 + chargeProgress * 24.0;
    const strobe = 0.6 + Math.sin(this.elapsed * strobeFreq) * 0.4;
    const baseOpacity = THREE.MathUtils.lerp(0.3, 0.95, chargeProgress);

    this.laserMaterial.opacity = Math.min(baseOpacity * strobe, opacityCap);
  }

  /**
   * Cancels laser tracking and resets charge
   */
  private releaseToken(): void {
    if (this.chargingToken) {
      this.chargingToken = false;
      SniperEnemy.activeChargers = Math.max(0, SniperEnemy.activeChargers - 1);
    }
  }

  private cancelAim(): void {
    if (this.hasChargeSound) {
      this.hasChargeSound = false;
      soundManager.stopSniperCharge();
    }
    this.releaseToken();
    this.isAimingAtPlayer = false;
    this.laserLine.visible = false;
    this.laserMaterial.opacity = 0;
    this.chargeTimer = 0;
    this.preCharge = 0;
  }

  private validatePerch(candidate: THREE.Vector3, collidables: THREE.Mesh[]): boolean {
    if (this.worldCollider) {
      this.worldCollider.pushOut(candidate.x, candidate.z, 0.55, candidate.y, candidate.y + 1.8, this.pushScratch);
      if (this.pushScratch.pushed) return false;
      const g = this.worldCollider.groundAt(candidate.x, candidate.y, candidate.z, 0.8);
      if (g === null || Math.abs(g - candidate.y) > 1.0) return false;
      candidate.y = g;
      return true;
    }
    this.tmpDown.copy(candidate);
    this.tmpDown.y += 1.0;
    this.tmpDir.set(0, -1, 0);
    this.losRaycaster.set(this.tmpDown, this.tmpDir);
    this.losRaycaster.far = 5.0;
    return this.losRaycaster.intersectObjects(collidables, false).length > 0;
  }

  /**
   * Fires the high-powered red sniper shot.
   * Late-wave repositioning only targets real footing: a down-ray from the
   * candidate perch must find a floor within 4m, so snipers never hover-dash
   * off the crane jib into thin air.
   */
  private fireSniperShot(origin: THREE.Vector3, target: THREE.Vector3, collidables: THREE.Mesh[]): void {
    this.tmpDir.copy(target).sub(origin).normalize();

    // Spread scales with player speed (inspired by inspiration's const sp = spread * (1 + P.speed * 0.06))
    const pSpeed = this.playerSpeed || 0;
    const spread = 0.006 * (1.0 + pSpeed * 0.06);
    this.tmpDir.x += (Math.random() - 0.5) * spread;
    this.tmpDir.y += (Math.random() - 0.5) * spread;
    this.tmpDir.z += (Math.random() - 0.5) * spread;
    this.tmpDir.normalize();

    this.pendingProjectiles.push({
      origin: origin.clone(),
      direction: this.tmpDir.clone(),
      speed: 130.0, // High-velocity tracer
      damage: Math.max(1, Math.round(22 * this.damageMultiplier)),
      radius: 0.28,
      maxDistance: 130.0,
      isSniper: true,
      kind: 'sniper'
    });

    // Rifle recoil kick
    this.rifleGroup.position.z -= 0.35;
    this.rifleGroup.rotation.x += 0.3;

    // Late waves: relocate after every 2nd shot so the perch never feels free
    this.shotsFired++;
    if (this.shotsFired >= 2 && this.waveNumber >= 4 && !this.repositionTarget) {
      this.tmpFlat.set(target.x - origin.x, 0, target.z - origin.z);
      const side = this.tmpFlat.lengthSq() > 1e-4 ? this.tmpFlat.normalize() : this.tmpFlat.set(1, 0, 0);
      // Perpendicular sidestep 5-8m at the same height
      const dist = 5 + Math.random() * 3;
      const dir = Math.random() > 0.5 ? 1 : -1;
      const candidate = this.group.position.clone().add(
        new THREE.Vector3(-side.z * dir * dist, 0, side.x * dir * dist)
      );
      if (this.validatePerch(candidate, collidables)) {
        this.repositionTarget = candidate;
        this.repositionTelegraphTimer = 0.5;
        soundManager.playSniperRelocate();
      }
      this.shotsFired = 0;
    }
  }

  /**
   * Shifts perch position along rooftop or vantage beam when line of sight is obstructed by an obstacle
   */
  private tryRepositionAroundObstacle(playerPos: THREE.Vector3, collidables: THREE.Mesh[]): boolean {
    const myPos = this.group.position;
    this.tmpFlat.set(playerPos.x - myPos.x, 0, playerPos.z - myPos.z);
    const len = this.tmpFlat.length();
    if (len < 0.01) return false;
    const sideX = -this.tmpFlat.z / len;
    const sideZ = this.tmpFlat.x / len;

    // Test lateral offsets on current roof/beam (left and right)
    const offsets = [4.5, -4.5, 7.0, -7.0];
    for (let i = 0; i < offsets.length; i++) {
      const d = offsets[i];
      this.tmpCandidatePerch.set(
        myPos.x + sideX * d,
        myPos.y,
        myPos.z + sideZ * d
      );
      if (this.validatePerch(this.tmpCandidatePerch, collidables)) {
        this.repositionTarget = this.tmpCandidatePerch.clone();
        this.repositionTelegraphTimer = 0.4;
        soundManager.playSniperRelocate();
        return true;
      }
    }
    return false;
  }

  private facePosition(target: THREE.Vector3): void {
    this.tmpFlat.set(target.x, this.group.position.y, target.z).sub(this.group.position);
    if (this.tmpFlat.lengthSq() > 0.001) {
      const targetAngle = Math.atan2(this.tmpFlat.x, this.tmpFlat.z);
      this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetAngle, 0.12);
    }
  }

  public override stagger(duration?: number, impulse?: THREE.Vector3): void {
    super.stagger(duration, impulse);
    if (this.glintMesh) this.glintMesh.visible = false;
    this.repositionTelegraphTimer = 0;
    // Stagger disrupts sniper lock-on
    this.cancelAim();
  }

  public override die(hitPoint?: THREE.Vector3, isHeadshot?: boolean, hitDirection?: THREE.Vector3): void {
    if (this.glintMesh) this.glintMesh.visible = false;
    this.repositionTelegraphTimer = 0;
    super.die(hitPoint, isHeadshot, hitDirection);
    this.cancelAim();
  }

  public override dispose(): void {
    if (this.glintMesh) this.glintMesh.visible = false;
    this.repositionTelegraphTimer = 0;
    this.cancelAim();
    super.dispose();
    this.laserGeometry.dispose();
    this.laserMaterial.dispose();
  }
}

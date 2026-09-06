import * as THREE from 'three';
import { Enemy, EnemyState } from './Enemy';
import { soundManager } from '../core/SoundManager';

/**
 * Ground/floor patrolling ink mercenary.
 * Armed with a sketched submachine gun, patrols floor slabs,
 * alerts when detecting Spider-Man, and fires controlled 3-round bursts of red ink.
 */
export class ThugEnemy extends Enemy {
  // Waypoint navigation
  public waypoints: THREE.Vector3[] = [];
  public currentWaypointIndex: number = 0;
  private patrolSpeed: number = 2.4;
  private chaseSpeed: number = 4.0;
  private stopRange: number = 9.0;
  private attackRange: number = 18.0;
  private visionRange: number = 28.0;

  // Burst firing state
  private burstCount: number = 3;
  private burstIndex: number = 0;
  private burstIntervalTimer: number = 0;
  private burstCooldownTimer: number = 1.0;
  private readonly burstShotDelay: number = 0.13;
  private readonly burstCooldown: number = 1.9;

  // Visual rig parts for procedural walking animation
  private leftLegGroup!: THREE.Group;
  private rightLegGroup!: THREE.Group;
  private torsoGroup!: THREE.Group;
  private gunGroup!: THREE.Group;
  private muzzleSocket!: THREE.Object3D;
  private walkCycle: number = 0;
  private tmpMuzzle: THREE.Vector3 = new THREE.Vector3();
  private tmpAim: THREE.Vector3 = new THREE.Vector3();
  private tmpDir: THREE.Vector3 = new THREE.Vector3();
  private tmpFlat: THREE.Vector3 = new THREE.Vector3();
  private losRaycaster: THREE.Raycaster = new THREE.Raycaster();
  private losTimer: number = 0;
  private losClear: boolean = true;
  // Pre-burst aim pause: 0.4s gun-raise warning before the first bullet
  private aimPause: number = 0;
  private aimArmed: boolean = false;
  // Thugs never leave their floor (no stair climbing, no knockback lift)
  private homeFloorY: number = 0;

  // Combat strafe state: sidestep perpendicular every 2-3s when farther than stopRange
  private strafeDir: number = Math.random() > 0.5 ? 1 : -1;
  private strafeTimer: number = 2.0 + Math.random();

  /**
   * TUNING — Wave-1 TTK (Time-To-Kill) Audit:
   * Target: Player survives >= 4.0s of continuous exposure against 5 Wave-1 Thugs.
   * Parameters:
   * - 5 Thugs, 9 dmg/shot, 3-round bursts (0.13s delay, 1.9s cooldown), 0.4s aim pause, 1.5s grace.
   * - Player: 100 HP with 0.4s i-frames per hit taken.
   * - Mathematical bound: ceil(100 / 9) = 12 damaging hits.
   * - With 0.4s i-frames, 12 hits require at least 11 * 0.4s = 4.40s of pure combat exposure.
   * - Simulated exposure TTK with spawn grace (1.5s) and aim pause (0.4s) is ~5.9s - 6.3s,
   *   exceeding the >= 4.0s minimum requirement.
   */
  constructor(position: THREE.Vector3, customWaypoints?: THREE.Vector3[]) {
    // 90 HP: dies to 1 sniper headshot (300) or 4 pistol shots (112)
    super('thug', 90, position);
    this.scoreValue = 100;
    this.xpValue = 25;
    this.eyeHeight = 1.65;
    this.homeFloorY = position.y;

    // Setup waypoints
    if (customWaypoints && customWaypoints.length > 0) {
      this.waypoints = customWaypoints.map((p) => p.clone());
    } else {
      // Default patrol loop around spawn position on the same floor level
      const px = position.x;
      const py = position.y;
      const pz = position.z;
      this.waypoints = [
        new THREE.Vector3(px - 4, py, pz - 3),
        new THREE.Vector3(px + 4, py, pz - 3),
        new THREE.Vector3(px + 4, py, pz + 3),
        new THREE.Vector3(px - 4, py, pz + 3)
      ];
    }

    this.buildModel();
  }

  protected buildModel(): void {
    const root = new THREE.Group();
    root.name = 'ThugModel';

    // 1. Torso / Combat Trench Vest
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 1.05, 0);

    const torsoGeom = new THREE.BoxGeometry(0.55, 0.65, 0.35);
    const torsoMesh = this.createMesh(torsoGeom, this.primaryEnemyMat, false, true);
    this.torsoGroup.add(torsoMesh);

    // Collar / tactical vest armor plate
    const vestGeom = new THREE.BoxGeometry(0.58, 0.4, 0.38);
    const vestMesh = this.createMesh(vestGeom, this.primaryEnemyMat, false, true);
    vestMesh.position.set(0, 0.05, 0);
    this.torsoGroup.add(vestMesh);

    // 2. Distinct Head / Helmet Weakpoint (Red Ink Accent!)
    const headGeom = new THREE.BoxGeometry(0.32, 0.34, 0.32);
    // Head has red accent ink material for weakpoint visual clarity
    const headMesh = this.createMesh(headGeom, this.accentRedMat, true, true);
    headMesh.position.set(0, 0.52, 0);
    this.torsoGroup.add(headMesh);

    // Helmet visor band (bright red ink weakpoint indicator)
    const visorGeom = new THREE.BoxGeometry(0.34, 0.1, 0.16);
    const visorMesh = this.createMesh(visorGeom, this.accentRedMat, true, false);
    visorMesh.position.set(0, 0.52, 0.12);
    this.torsoGroup.add(visorMesh);

    // 3. Legs
    const legWidth = 0.18;
    const legDepth = 0.2;
    const legHeight = 0.8;
    const legGeom = new THREE.BoxGeometry(legWidth, legHeight, legDepth);
    legGeom.translate(0, -legHeight * 0.5, 0); // Pivot at hip joint

    // Left leg
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.16, 0.8, 0);
    const leftLegMesh = this.createMesh(legGeom, this.primaryEnemyMat, false, true);
    this.leftLegGroup.add(leftLegMesh);
    root.add(this.leftLegGroup);

    // Right leg
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.16, 0.8, 0);
    const rightLegMesh = this.createMesh(legGeom, this.primaryEnemyMat, false, true);
    this.rightLegGroup.add(rightLegMesh);
    root.add(this.rightLegGroup);

    // 4. Arms and Submachine Gun
    this.gunGroup = new THREE.Group();
    this.gunGroup.position.set(0.24, 0.1, 0.2);

    // Right arm
    const armGeom = new THREE.BoxGeometry(0.14, 0.45, 0.14);
    armGeom.translate(0, -0.15, 0);
    const rightArm = this.createMesh(armGeom, this.primaryEnemyMat, false, true);
    rightArm.rotation.x = Math.PI * 0.4;
    this.gunGroup.add(rightArm);

    // Submachine gun body
    const gunBodyGeom = new THREE.BoxGeometry(0.12, 0.16, 0.5);
    const gunBody = this.createMesh(gunBodyGeom, this.primaryEnemyMat, false, false);
    gunBody.position.set(0, -0.05, 0.25);
    this.gunGroup.add(gunBody);

    // Gun magazine
    const magGeom = new THREE.BoxGeometry(0.08, 0.22, 0.1);
    const mag = this.createMesh(magGeom, this.primaryEnemyMat, false, false);
    mag.position.set(0, -0.18, 0.2);
    this.gunGroup.add(mag);

    // Red ink gun barrel tip
    const barrelGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6);
    barrelGeom.rotateX(Math.PI * 0.5);
    const barrel = this.createMesh(barrelGeom, this.accentRedMat, false, false);
    barrel.position.set(0, -0.02, 0.55);
    this.gunGroup.add(barrel);

    // Muzzle socket for projectile spawning
    this.muzzleSocket = new THREE.Object3D();
    this.muzzleSocket.position.set(0, -0.02, 0.65);
    this.gunGroup.add(this.muzzleSocket);

    this.torsoGroup.add(this.gunGroup);
    root.add(this.torsoGroup);
    this.group.add(root);
  }

  protected updateAI(dt: number, playerPos: THREE.Vector3, _collidables: THREE.Mesh[]): void {
    const myPos = this.group.position;
    // Floor clamp first: stagger impulses and drift never change levels
    myPos.y = this.homeFloorY;
    const distToPlayer = myPos.distanceTo(playerPos);
    const yDiff = Math.abs(myPos.y - playerPos.y);

    // Visual animation damping
    let isMoving = false;

    // Check player detection (same floor + range — thugs don't see through floors)
    if (!this.alerted && distToPlayer <= this.visionRange && yDiff < 6.0) {
      this.alert(playerPos);
    }

    // State machine logic
    switch (this.state) {
      case EnemyState.IDLE: {
        // Patrol between floor waypoints
        if (this.waypoints.length > 0) {
          const targetWp = this.waypoints[this.currentWaypointIndex];
          const distToWp = myPos.distanceTo(targetWp);

          if (distToWp < 1.2) {
            this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
          } else {
            this.moveToward(targetWp, this.patrolSpeed, dt);
            isMoving = true;
          }
        }
        break;
      }

      case EnemyState.CHASE: {
        // Face player
        this.facePosition(playerPos);

        if (distToPlayer > this.stopRange) {
          this.moveToward(playerPos, this.chaseSpeed, dt);
          isMoving = true;
        }

        // Transition to ATTACK when in comfortable range
        if (distToPlayer <= this.attackRange) {
          this.state = EnemyState.ATTACK;
        }
        break;
      }

      case EnemyState.ATTACK: {
        this.facePosition(playerPos);

        // If player fled too far, chase again
        if (distToPlayer > this.attackRange * 1.3) {
          this.state = EnemyState.CHASE;
          break;
        }

        // Alternate strafe direction every 2-3s
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeDir = -this.strafeDir;
          this.strafeTimer = 2.0 + Math.random();
        }

        // Perpendicular sidestep while farther than stopRange instead of standing turret-still
        if (distToPlayer > this.stopRange) {
          this.tmpFlat.set(playerPos.x - myPos.x, 0, playerPos.z - myPos.z);
          const len = this.tmpFlat.length();
          if (len > 0.01) {
            // Perpendicular vector in XZ plane: (-dz, dx) * strafeDir
            this.tmpDir.set(
              (-this.tmpFlat.z / len) * this.strafeDir,
              0,
              (this.tmpFlat.x / len) * this.strafeDir
            );
            this.group.position.addScaledVector(this.tmpDir, 2.0 * dt);
            myPos.y = this.homeFloorY; // Never leave home floor (clamp stays)
            isMoving = true;
          }
        }

        // Handle 3-round burst firing logic (cadence never blocked, gated on same-floor LOS)
        this.updateBurstFiring(dt, playerPos, _collidables, myPos);
        break;
      }
    }

    // Procedural walk animation
    this.updateWalkAnimation(dt, isMoving);
  }

  /**
   * Handles 3-round burst weapon cycle (throttled LOS so thugs don't shoot through walls)
   */
  private updateBurstFiring(dt: number, playerPos: THREE.Vector3, collidables: THREE.Mesh[], _myPos: THREE.Vector3): void {
    // Cooldown runs even during grace so the first burst lands ~1.9s after spawn, not 2.5s+
    if (this.burstCooldownTimer > 0) this.burstCooldownTimer -= dt;
    if (this.spawnGrace > 0) return;
    if (this.burstCooldownTimer > 0) return;

    // Throttled line-of-sight: don't waste bullets through concrete
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.25;
      this.muzzleSocket.getWorldPosition(this.tmpMuzzle);
      this.tmpAim.copy(playerPos);
      this.tmpAim.y += 0.9;
      this.tmpDir.copy(this.tmpAim).sub(this.tmpMuzzle);
      const d = this.tmpDir.length();
      this.tmpDir.normalize();
      this.losRaycaster.set(this.tmpMuzzle, this.tmpDir);
      this.losRaycaster.far = d;
      const hits = this.losRaycaster.intersectObjects(collidables, false);
      this.losClear = hits.length === 0 || hits[0].distance >= d - 0.6;
    }
    if (!this.losClear) return;

    // Fresh burst starts with a readable 0.4s aim pause (gun-raise click).
    // Armed once per burst: without the flag the expiry re-triggers the pause forever.
    if (this.burstIndex === 0 && !this.aimArmed && this.burstIntervalTimer <= 0) {
      this.aimArmed = true;
      this.aimPause = 0.4;
      this.gunGroup.position.z += 0.1;
      soundManager.playThugAimClick();
    }
    if (this.aimPause > 0) {
      this.aimPause -= dt;
      return;
    }

    // Currently firing a burst
    this.burstIntervalTimer -= dt;
    if (this.burstIntervalTimer <= 0) {
      this.fireBullet(playerPos);
      this.burstIndex++;
      this.burstIntervalTimer = this.burstShotDelay;

      if (this.burstIndex >= this.burstCount) {
        // Burst finished, reset cooldown
        this.burstIndex = 0;
        this.aimArmed = false;
        this.burstCooldownTimer = this.burstCooldown + (Math.random() - 0.5) * 0.4;
      }
    }
  }

  /**
   * Fires a single red ink projectile toward the player
   */
  private fireBullet(playerPos: THREE.Vector3): void {
    this.muzzleSocket.getWorldPosition(this.tmpMuzzle);

    // Aim toward player center/chest (approx playerPos + 0.9m)
    this.tmpAim.copy(playerPos);
    this.tmpAim.y += 0.9;

    // Slight combat spread
    const spread = 0.045;
    const dist = this.tmpAim.distanceTo(this.tmpMuzzle);
    this.tmpAim.x += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.y += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.z += (Math.random() - 0.5) * spread * dist;

    this.tmpAim.sub(this.tmpMuzzle).normalize();

    this.pendingProjectiles.push({
      origin: this.tmpMuzzle.clone(),
      direction: this.tmpAim.clone(),
      speed: 36.0,
      damage: 9,
      radius: 0.16,
      maxDistance: 60.0,
      isSniper: false,
      kind: 'thug'
    });

    // Weapon recoil kick
    this.gunGroup.position.z -= 0.08;
  }

  /**
   * Smoothly rotates the thug to face a target point (ignoring Y difference)
   */
  private facePosition(target: THREE.Vector3): void {
    this.tmpFlat.set(target.x, this.group.position.y, target.z).sub(this.group.position);
    if (this.tmpFlat.lengthSq() > 0.001) {
      const targetAngle = Math.atan2(this.tmpFlat.x, this.tmpFlat.z);
      this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetAngle, 0.15);
    }
  }

  /**
   * Moves toward target along XZ plane
   */
  private moveToward(target: THREE.Vector3, speed: number, dt: number): void {
    this.facePosition(target);
    this.tmpDir.set(target.x - this.group.position.x, 0, target.z - this.group.position.z);
    if (this.tmpDir.lengthSq() < 1e-6) return;
    this.tmpDir.normalize();
    this.group.position.addScaledVector(this.tmpDir, speed * dt);
  }

  /**
   * Procedural pendulum walk cycle for legs and torso
   */
  private updateWalkAnimation(dt: number, isMoving: boolean): void {
    if (isMoving) {
      this.walkCycle += dt * 8.0;
      const legSwing = Math.sin(this.walkCycle) * 0.45;
      this.leftLegGroup.rotation.x = legSwing;
      this.rightLegGroup.rotation.x = -legSwing;
      this.torsoGroup.position.y = 1.05 + Math.abs(Math.cos(this.walkCycle)) * 0.05;
    } else {
      // Return to neutral standing stance
      this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(this.leftLegGroup.rotation.x, 0, dt * 6.0);
      this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(this.rightLegGroup.rotation.x, 0, dt * 6.0);
      this.torsoGroup.position.y = THREE.MathUtils.lerp(this.torsoGroup.position.y, 1.05, dt * 6.0);
    }

    // Recover gun recoil
    this.gunGroup.position.z = THREE.MathUtils.lerp(this.gunGroup.position.z, 0.2, dt * 14.0);
  }
}

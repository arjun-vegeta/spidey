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
  private patrolSpeed: number = 2.8;
  private chaseSpeed: number = 5.2;
  private stopRange: number = 9.0;
  private keepRange: number = 4.5;
  private attackRange: number = 20.0;
  private visionRange: number = 60.0;

  // Golden ratio slotting & fanning out (inspired by inspiration's _approachPoint)
  private static slotCounter: number = 0;
  private appAng: number = 0;
  private appR: number = 5.5;
  private appTimer: number = 0;
  private keepMul: number = 1.0;

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
  // Current floor altitude reference
  private homeFloorY: number = 0;

  // Vaulting / Jump-down state machine (descending ledges, parapets, and stairs)
  public isVaulting: boolean = false;
  private vaultVelocity: THREE.Vector3 = new THREE.Vector3();
  private vaultTargetY: number = 0;
  private vaultDuration: number = 0;
  private readonly vaultMaxTime: number = 2.5;
  private lastTargetPlayerY: number = 0;

  // Obstacle detour steering (prevents vibrating against corners and walls)
  private detourTimer: number = 0;
  private detourDir: THREE.Vector3 = new THREE.Vector3();
  private lastCheckPos: THREE.Vector3 = new THREE.Vector3();
  private positionStuckTimer: number = 0;

  // Reused scratch objects (zero garbage in hot loops)
  private pushScratchHigh: { x: number; z: number; nx: number; nz: number; pushed: boolean } = {
    x: 0, z: 0, nx: 0, nz: 0, pushed: false
  };
  private tmpVaultDir: THREE.Vector3 = new THREE.Vector3();
  private tmpProbe: THREE.Vector3 = new THREE.Vector3();

  // Combat strafe state: sidestep perpendicular every 1.5-2.5s
  private strafeDir: number = Math.random() > 0.5 ? 1 : -1;
  private strafeTimer: number = 2.0 + Math.random();
  // Anti-blob / anti-wall-chase state
  private spawnHome: THREE.Vector3 = new THREE.Vector3();
  private chaseOffsetAngle: number = Math.random() * Math.PI * 2;
  private chaseLosTimer: number = 0;
  private chaseLosClear: boolean = true;
  private stuckTimer: number = 0;
  private tmpChase: THREE.Vector3 = new THREE.Vector3();
  private leftArmGroup: THREE.Group | null = null;

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
    // 90 HP: dies to 1 sniper headshot (300) or 3 pistol body shots (126)
    super('thug', 90, position);
    this.scoreValue = 100;
    this.xpValue = 25;
    this.eyeHeight = 1.65;
    this.homeFloorY = position.y;
    this.spawnHome.copy(position);

    // Golden ratio slot angle around player and personal keep/approach radius
    this.slotAngle = (ThugEnemy.slotCounter++) * 2.39996;
    this.appAng = this.slotAngle;
    this.keepMul = 0.85 + Math.random() * 0.35;
    this.appR = 4.5 + Math.random() * 4.0;

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

    // Collar / tactical vest armor plate (bright red combat vest)
    const vestGeom = new THREE.BoxGeometry(0.58, 0.4, 0.38);
    const vestMesh = this.createMesh(vestGeom, this.accentRedMat, false, true);
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

    // Knee armor pad geometry (bold red ink)
    const kneeGeom = new THREE.BoxGeometry(0.2, 0.18, 0.12);

    // Left leg
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.16, 0.8, 0);
    const leftLegMesh = this.createMesh(legGeom, this.primaryEnemyMat, false, true);
    this.leftLegGroup.add(leftLegMesh);
    const leftKnee = this.createMesh(kneeGeom, this.accentRedMat, false, false);
    leftKnee.position.set(0, -0.4, 0.1);
    this.leftLegGroup.add(leftKnee);
    root.add(this.leftLegGroup);

    // Right leg
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.16, 0.8, 0);
    const rightLegMesh = this.createMesh(legGeom, this.primaryEnemyMat, false, true);
    this.rightLegGroup.add(rightLegMesh);
    const rightKnee = this.createMesh(kneeGeom, this.accentRedMat, false, false);
    rightKnee.position.set(0, -0.4, 0.1);
    this.rightLegGroup.add(rightKnee);
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

    // Gun magazine (red ink)
    const magGeom = new THREE.BoxGeometry(0.08, 0.22, 0.1);
    const mag = this.createMesh(magGeom, this.accentRedMat, false, false);
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

    // Free left arm: counter-swings the legs so patrol reads as a walk, not a glide.
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.34, 0.22, 0);
    const leftArmGeom = new THREE.BoxGeometry(0.13, 0.5, 0.13);
    leftArmGeom.translate(0, -0.18, 0);
    const leftArm = this.createMesh(leftArmGeom, this.primaryEnemyMat, false, false);
    this.leftArmGroup.add(leftArm);
    // Red ink fist wrap: the off-hand reads at distance.
    const fistGeom = new THREE.BoxGeometry(0.14, 0.12, 0.14);
    const fist = this.createMesh(fistGeom, this.accentRedMat, false, false);
    fist.position.set(0, -0.44, 0);
    this.leftArmGroup.add(fist);
    this.torsoGroup.add(this.leftArmGroup);

    // Shoulder pads: bulky grunt silhouette with bright red pauldrons
    const padGeom = new THREE.BoxGeometry(0.22, 0.14, 0.26);
    const padL = this.createMesh(padGeom, this.accentRedMat, false, false);
    padL.position.set(-0.36, 0.32, 0);
    this.torsoGroup.add(padL);
    const padR = this.createMesh(padGeom, this.accentRedMat, false, false);
    padR.position.set(0.36, 0.32, 0);
    this.torsoGroup.add(padR);

    // Backpack + bedroll: ground-troop bulk from behind with red accent roll
    const packGeom = new THREE.BoxGeometry(0.4, 0.45, 0.18);
    const pack = this.createMesh(packGeom, this.accentRedMat, false, false);
    pack.position.set(0, 0.05, -0.26);
    this.torsoGroup.add(pack);

    root.add(this.torsoGroup);
    this.group.add(root);
  }

  protected updateAI(dt: number, playerPos: THREE.Vector3, _collidables: THREE.Mesh[]): void {
    if (this.chaseLosTimer > 0) this.chaseLosTimer -= dt;
    const myPos = this.group.position;
    this.lastTargetPlayerY = playerPos.y;

    // 1. Vault update: when airborne, gravity and parabolic flight take over
    if (this.isVaulting) {
      this.updateVault(dt);
      return;
    }

    // Ground snap: thugs stand ON floors, allow stairs/step-down up to 2.2m.
    if (this.worldCollider) {
      const ground = this.worldCollider.groundAt(myPos.x, myPos.y, myPos.z, 0.6);
      if (ground !== null && myPos.y - ground <= 2.2 && ground - myPos.y <= 0.6) {
        myPos.y = ground;
        this.homeFloorY = ground;
      } else if (ground !== null && myPos.y - ground > 2.2) {
        // Off footing drop: fall down to valid floor below
        this.startVault(this.tmpVaultDir.set(0, 0, 0), ground, 0, 0);
        return;
      } else {
        myPos.y = this.homeFloorY;
      }
    } else {
      myPos.y = this.homeFloorY;
    }

    // Track position progress to detect being stuck
    const movedDistSq = myPos.distanceToSquared(this.lastCheckPos);
    if (movedDistSq < 0.001) {
      this.positionStuckTimer += dt;
    } else {
      this.positionStuckTimer = 0;
      this.lastCheckPos.copy(myPos);
    }

    // Dynamic unsticking:
    // A. Stuck on elevated floor while player is below -> find ledge/parapet and vault down!
    if (playerPos.y < myPos.y - 1.5 && this.worldCollider) {
      if (this.pushScratch.pushed || this.positionStuckTimer > 0.8) {
        if (this.tryFindAndVaultLedge(playerPos)) {
          this.positionStuckTimer = 0;
          return;
        }
      }
    }
    // B. Blocked by a low barrier / crate / low HVAC on same floor -> vault over it!
    if (this.positionStuckTimer > 0.35 && this.pushScratch.pushed && this.worldCollider) {
      this.worldCollider.pushOut(myPos.x, myPos.z, 0.55, myPos.y + 1.4, myPos.y + 2.0, this.pushScratchHigh);
      if (!this.pushScratchHigh.pushed) {
        this.tmpFlat.set(playerPos.x - myPos.x, 0, playerPos.z - myPos.z);
        if (this.tmpFlat.lengthSq() > 0.01) {
          this.tmpFlat.normalize();
          this.startVault(this.tmpFlat, myPos.y, 6.0, 6.5);
          this.positionStuckTimer = 0;
          return;
        }
      }
    }

    const distToPlayer = myPos.distanceTo(playerPos);
    const yDiff = Math.abs(myPos.y - playerPos.y);

    const currentChaseSpeed = this.chaseSpeed * this.speedMultiplier;
    const currentPatrolSpeed = this.patrolSpeed * this.speedMultiplier;

    // Visual animation damping
    let isMoving = false;

    // Check player detection (combat awareness across district + hearing within 18m)
    if (!this.alerted) {
      const hasLos = _collidables.length === 0 || distToPlayer < 18 || this.checkChaseLos(playerPos, _collidables);
      if (distToPlayer <= this.visionRange && hasLos) {
        this.alert(playerPos);
      }
    }

    // Active detour around an obstacle corner: commit to rounding the obstacle corner
    if (this.alerted && this.detourTimer > 0) {
      this.detourTimer -= dt;
      // Test if forward progress toward target is now unobstructed
      this.tmpFlat.set(playerPos.x - myPos.x, 0, playerPos.z - myPos.z);
      let clearedCorner = false;
      if (this.tmpFlat.lengthSq() > 0.01) {
        this.tmpFlat.normalize();
        const probeX = myPos.x + this.tmpFlat.x * 0.6;
        const probeZ = myPos.z + this.tmpFlat.z * 0.6;
        if (this.worldCollider) {
          this.worldCollider.pushOut(probeX, probeZ, 0.55, myPos.y, myPos.y + 1.8, this.pushScratch);
          if (!this.pushScratch.pushed) {
            clearedCorner = true;
            this.detourTimer = 0;
          }
        }
      }

      let moved: boolean;
      if (!clearedCorner && this.detourTimer > 0) {
        moved = this.tryStep(this.detourDir, currentChaseSpeed, dt);
        if (!moved) {
          this.detourTimer = 0;
          moved = this.trySlideAroundObstacle(playerPos, currentChaseSpeed, dt);
        }
      } else {
        moved = this.tryStep(this.tmpFlat, currentChaseSpeed, dt);
      }
      this.updateWalkAnimation(dt, moved);
      return;
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
            this.stuckTimer = 0;
          } else {
            const moved = this.moveToward(targetWp, currentPatrolSpeed, dt);
            isMoving = moved;
            // Waypoint behind a wall (bad node): skip it instead of grinding forever.
            if (!moved) {
              this.stuckTimer += dt;
              if (this.stuckTimer > 1.2) {
                this.currentWaypointIndex = (this.currentWaypointIndex + 1) % this.waypoints.length;
                this.stuckTimer = 0;
              }
            } else {
              this.stuckTimer = 0;
            }
          }
        }
        break;
      }

      case EnemyState.CHASE: {
        // Face player
        this.facePosition(playerPos);

        // Slotted approach point: group fans out around player instead of single-filing (inspiration)
        this.getApproachPoint(playerPos, dt, this.tmpChase);

        let moved: boolean;
        // If actively detouring around an obstacle, follow detour direction
        if (this.detourTimer > 0) {
          this.detourTimer -= dt;
          moved = this.tryStep(this.detourDir, currentChaseSpeed, dt);
          if (!moved) {
            this.detourTimer = 0;
            moved = this.trySlideAroundObstacle(this.tmpChase, currentChaseSpeed, dt);
          } else {
            // Test if direct route to chase target cleared
            this.tmpFlat.set(this.tmpChase.x - myPos.x, 0, this.tmpChase.z - myPos.z);
            if (this.tmpFlat.lengthSq() > 0.01) {
              this.tmpFlat.normalize();
              if (this.tryStep(this.tmpFlat, currentChaseSpeed * 0.1, 0.005)) {
                this.detourTimer = 0;
              }
            }
          }
        } else {
          // Direct pursuit
          moved = this.moveToward(this.tmpChase, currentChaseSpeed, dt);
          if (!moved) {
            moved = this.trySlideAroundObstacle(this.tmpChase, currentChaseSpeed, dt);
          }
        }
        isMoving = moved;

        // Advance while firing if within attack range and LOS clear (inspiration)
        if (distToPlayer <= this.attackRange && this.chaseLosClear) {
          this.updateBurstFiring(dt, playerPos, _collidables, myPos);
        }

        // Transition to ATTACK when in comfortable range, LOS clear, and not elevated far above player
        if (distToPlayer <= this.attackRange && this.chaseLosClear && playerPos.y >= myPos.y - 1.5) {
          this.state = EnemyState.ATTACK;
        }
        break;
      }

      case EnemyState.ATTACK: {
        this.facePosition(playerPos);

        // If player fled too far or is on ground below roof, chase again
        if (distToPlayer > this.attackRange * 1.35 || playerPos.y < myPos.y - 1.8) {
          this.state = EnemyState.CHASE;
          break;
        }

        // If line of sight is lost to an obstacle, chase to flank around it
        if (this.worldCollider && !this.chaseLosClear) {
          this.state = EnemyState.CHASE;
          break;
        }

        // Alternate strafe direction every 1.5-2.5s
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeDir = -this.strafeDir;
          this.strafeTimer = 1.5 + Math.random() * 1.5;
        }

        // Tactical 3-zone positioning (inspiration):
        if (distToPlayer > this.stopRange) {
          // Farther than stopRange (e.g. 9m - 20m): aggressively advance towards player with diagonal strafe flank
          this.tmpFlat.set(playerPos.x - myPos.x, 0, playerPos.z - myPos.z);
          const len = this.tmpFlat.length();
          if (len > 0.01) {
            const nx = this.tmpFlat.x / len;
            const nz = this.tmpFlat.z / len;
            // 75% forward toward player + 55% lateral strafe flank
            this.tmpDir.set(
              nx * 0.75 - nz * this.strafeDir * 0.55,
              0,
              nz * 0.75 + nx * this.strafeDir * 0.55
            ).normalize();

            const ok = this.tryStep(this.tmpDir, currentChaseSpeed * 0.85, dt);
            if (!ok) {
              isMoving = this.trySlideAroundObstacle(playerPos, currentChaseSpeed * 0.85, dt);
            } else {
              isMoving = true;
            }
          }
        } else if (yDiff > 1.2) {
          // Elevated player: push towards player's ground column (inspiration line 585)
          this.getApproachPoint(playerPos, dt, this.tmpChase);
          isMoving = this.moveToward(this.tmpChase, currentChaseSpeed * 0.85, dt) ||
            this.trySlideAroundObstacle(this.tmpChase, currentChaseSpeed * 0.85, dt);
        } else if (distToPlayer < this.keepRange * this.keepMul) {
          // Too close: actively back away to maintain tactical standoff (inspiration)
          this.tmpFlat.set(myPos.x - playerPos.x, 0, myPos.z - playerPos.z);
          const len = this.tmpFlat.length();
          if (len > 0.01) {
            this.tmpDir.set(this.tmpFlat.x / len, 0, this.tmpFlat.z / len);
            const ok = this.tryStep(this.tmpDir, currentChaseSpeed * 0.5, dt);
            if (ok) isMoving = true;
          }
        } else {
          // Sweet spot: circular strafe around the player (inspiration)
          this.tmpFlat.set(playerPos.x - myPos.x, 0, playerPos.z - myPos.z);
          const len = this.tmpFlat.length();
          if (len > 0.01) {
            this.tmpDir.set(
              (-this.tmpFlat.z / len) * this.strafeDir,
              0,
              (this.tmpFlat.x / len) * this.strafeDir
            );
            const ok = this.tryStep(this.tmpDir, currentChaseSpeed * 0.5, dt);
            if (!ok) this.strafeDir = -this.strafeDir;
            else isMoving = true;
          }
        }

        // Handle 3-round burst firing logic (cadence never blocked, gated on LOS)
        this.updateBurstFiring(dt, playerPos, _collidables, myPos);
        break;
      }
    }

    // Procedural walk animation
    this.updateWalkAnimation(dt, isMoving);
  }

  /**
   * Slotted surround point around player (inspired by inspiration's _approachPoint).
   * Prevents conga-lining by giving each thug its own perimeter angle and distance.
   */
  private getApproachPoint(playerPos: THREE.Vector3, dt: number, out: THREE.Vector3): THREE.Vector3 {
    this.appTimer -= dt;
    if (this.appTimer <= 0) {
      this.appTimer = 2.5 + Math.random() * 2.5;
      this.appAng += (Math.random() - 0.5) * 1.2;
      this.appR = 4.5 + Math.random() * 4.0;
    }
    const myPos = this.group.position;
    const d = Math.hypot(playerPos.x - myPos.x, playerPos.z - myPos.z);
    let r = THREE.MathUtils.clamp(d * 0.55, Math.min(2.0, d * 0.9), this.appR);
    if (Math.abs(playerPos.y - myPos.y) > 1.5) r = Math.min(r, 1.2);
    return out.set(
      playerPos.x + Math.cos(this.appAng) * r,
      myPos.y,
      playerPos.z + Math.sin(this.appAng) * r
    );
  }

  /**
   * Smoothly slides along wall surfaces or deflects around obstacles when direct step fails,
   * setting a persistent detour direction so the enemy navigates around corners rather than oscillating.
   */
  private trySlideAroundObstacle(target: THREE.Vector3, speed: number, dt: number): boolean {
    const myPos = this.group.position;
    this.tmpFlat.set(target.x - myPos.x, 0, target.z - myPos.z);
    const len = this.tmpFlat.length();
    if (len < 0.01) return false;

    // 1. If we have a push normal from WorldCollider, slide along wall tangent biased around the corner
    if (this.pushScratch.pushed && (Math.abs(this.pushScratch.nx) > 0.01 || Math.abs(this.pushScratch.nz) > 0.01)) {
      const tx = -this.pushScratch.nz;
      const tz = this.pushScratch.nx;
      const dot = tx * this.tmpFlat.x + tz * this.tmpFlat.z;
      const sign = dot !== 0 ? (dot > 0 ? 1 : -1) : this.strafeDir;

      this.detourDir.set(tx * sign, 0, tz * sign).normalize();
      this.detourTimer = 1.5;

      if (this.tryStep(this.detourDir, speed, dt)) {
        return true;
      }
    }

    // 2. Fallback: try deflecting around obstacle left or right
    const nx = this.tmpFlat.x / len;
    const nz = this.tmpFlat.z / len;
    const perpX = -nz;
    const perpZ = nx;

    this.detourDir.set(nx * 0.4 + perpX * 0.9 * this.strafeDir, 0, nz * 0.4 + perpZ * 0.9 * this.strafeDir).normalize();
    this.detourTimer = 1.2;
    if (this.tryStep(this.detourDir, speed, dt)) {
      return true;
    }

    this.detourDir.set(nx * 0.4 - perpX * 0.9 * this.strafeDir, 0, nz * 0.4 - perpZ * 0.9 * this.strafeDir).normalize();
    if (this.tryStep(this.detourDir, speed, dt)) {
      return true;
    }

    this.detourTimer = 0;
    return false;
  }

  private checkChaseLos(playerPos: THREE.Vector3, collidables: THREE.Mesh[]): boolean {
    if (this.chaseLosTimer <= 0) {
      this.chaseLosTimer = 0.25;
      this.tmpMuzzle.set(this.group.position.x, this.group.position.y + 1.2, this.group.position.z);
      this.tmpAim.copy(playerPos);
      this.tmpAim.y = this.resolveAimY(playerPos);
      if (this.worldCollider) {
        this.chaseLosClear = this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.tmpAim);
      } else {
        this.tmpDir.copy(this.tmpAim).sub(this.tmpMuzzle);
        const d = this.tmpDir.length();
        if (d < 1e-4) {
          this.chaseLosClear = true;
        } else {
          this.tmpDir.normalize();
          this.losRaycaster.set(this.tmpMuzzle, this.tmpDir);
          this.losRaycaster.far = d;
          const hits = this.losRaycaster.intersectObjects(collidables, false);
          this.chaseLosClear = hits.length === 0 || hits[0].distance >= d - 0.6;
        }
      }
    }
    return this.chaseLosClear;
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
      this.tmpMuzzle.set(this.group.position.x, this.group.position.y + 1.2, this.group.position.z);
      this.tmpAim.copy(playerPos);
      this.tmpAim.y = this.resolveAimY(playerPos);
      if (this.worldCollider) {
        this.losClear = this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.tmpAim);
      } else {
        this.tmpDir.copy(this.tmpAim).sub(this.tmpMuzzle);
        const d = this.tmpDir.length();
        this.tmpDir.normalize();
        this.losRaycaster.set(this.tmpMuzzle, this.tmpDir);
        this.losRaycaster.far = d;
        const hits = this.losRaycaster.intersectObjects(collidables, false);
        this.losClear = hits.length === 0 || hits[0].distance >= d - 0.6;
      }
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
      // Abort firing if line of sight to player is blocked by a wall
      if (this.worldCollider && !this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.tmpAim)) {
        this.losClear = false;
        this.burstIndex = 0;
        this.aimArmed = false;
        return;
      }
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

    // Aim at the chest: above a half-height rail when the player stands,
    // below it when they crouch (see core/CoverMetrics.ts).
    this.tmpAim.copy(playerPos);
    this.tmpAim.y = this.resolveAimY(playerPos);

    // Dynamic combat spread scaled with player speed (inspired by inspiration's const sp = spread * (1 + P.speed * 0.06))
    const pSpeed = this.playerSpeed || 0;
    const spread = 0.045 * (1.0 + pSpeed * 0.05);
    const dist = this.tmpAim.distanceTo(this.tmpMuzzle);
    this.tmpAim.x += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.y += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.z += (Math.random() - 0.5) * spread * dist;

    this.tmpAim.sub(this.tmpMuzzle).normalize();

    this.pendingProjectiles.push({
      origin: this.tmpMuzzle.clone(),
      direction: this.tmpAim.clone(),
      speed: 36.0,
      damage: Math.max(1, Math.round(9 * this.damageMultiplier)),
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
   * Moves toward target along XZ plane. Returns false when a wall or ledge blocks.
   * With collision shells: swept push-out + footing check, so thugs slide along
   * walls and stop at ledges instead of clipping through or hovering in air.
   */
  private moveToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    this.facePosition(target);
    this.tmpDir.set(target.x - this.group.position.x, 0, target.z - this.group.position.z);
    if (this.tmpDir.lengthSq() < 1e-6) return false;
    this.tmpDir.normalize();
    return this.tryStep(this.tmpDir, speed, dt);
  }

  /**
   * Single collision-guarded step along a normalized XZ direction.
   * Swept in small sub-steps so fast chase speeds can't tunnel thin parapets.
   */
  /**
   * Single collision-guarded step along a normalized XZ direction.
   * Swept in small sub-steps so fast chase speeds can't tunnel thin parapets.
   * Enables stair descent, ledge drops, and low parapet vaulting when chasing.
   */
  private tryStep(dir: THREE.Vector3, speed: number, dt: number): boolean {
    const p = this.group.position;
    if (!this.worldCollider) {
      p.addScaledVector(dir, speed * dt);
      return true;
    }
    const total = speed * dt;
    const sub = Math.max(1, Math.ceil(total / 0.3));
    const h = total / sub;
    let advanced = 0;
    for (let i = 0; i < sub; i++) {
      const nx = p.x + dir.x * h;
      const nz = p.z + dir.z * h;
      // 1. Wall shell: slide, don't enter.
      this.worldCollider.pushOut(nx, nz, 0.55, p.y, p.y + 1.8, this.pushScratch);
      const rx = this.pushScratch.pushed ? this.pushScratch.x : nx;
      const rz = this.pushScratch.pushed ? this.pushScratch.z : nz;
      if (this.pushScratch.pushed) {
        const intoWall = dir.x * this.pushScratch.nx + dir.z * this.pushScratch.nz;
        if (intoWall < -0.15) {
          // Forward direction is blocked by wall. Check if this is a low barrier/parapet:
          this.worldCollider.pushOut(nx, nz, 0.55, p.y + 1.4, p.y + 2.0, this.pushScratchHigh);
          if (!this.pushScratchHigh.pushed) {
            // Barrier is low (<= 1.4m)!
            const probeX = p.x + dir.x * 2.2;
            const probeZ = p.z + dir.z * 2.2;
            this.worldCollider.pushOut(probeX, probeZ, 0.55, p.y + 1.4, p.y + 2.0, this.pushScratchHigh);
            if (!this.pushScratchHigh.pushed) {
              const dropGround = this.worldCollider.groundAt(probeX, p.y + 0.4, probeZ, 80);
              // Case A: Ledge/rooftop drop down to street or lower level
              if (dropGround !== null && dropGround < p.y - 1.0 && this.lastTargetPlayerY < p.y - 0.8) {
                this.startVault(dir, dropGround, 6.5, 4.5);
                return true;
              }
              // Case B: Low crate/barrier vault over on same floor
              if (dropGround !== null && Math.abs(dropGround - p.y) <= 0.8) {
                this.startVault(dir, dropGround, 6.0, 6.5);
                return true;
              }
            }
          }
        }
        // Head-on into a wall:
        const movedX = rx - p.x;
        const movedZ = rz - p.z;
        if (movedX * movedX + movedZ * movedZ < 1e-8) {
          return advanced > 0;
        }
      }
      // 2. Footing: check floor under next step
      const ground = this.worldCollider.groundAt(rx, p.y, rz, 0.6);
      const stepDown = ground !== null ? p.y - ground : 999;
      const stepUp = ground !== null ? ground - p.y : 999;

      // Allow climbing up to 0.6m and walking down steps/slopes up to 2.2m
      if (ground !== null && stepUp <= 0.6 && stepDown <= 2.2) {
        p.x = rx;
        p.z = rz;
        p.y = ground;
        this.homeFloorY = ground;
        advanced += h;
        continue;
      }

      // Footing drop > 2.2m (ledge/roof edge drop):
      if (this.lastTargetPlayerY < p.y - 1.0) {
        const dropGround = this.worldCollider.groundAt(rx, p.y - 0.4, rz, 80);
        if (dropGround !== null && dropGround < p.y - 1.5) {
          this.startVault(dir, dropGround, 5.5, 2.2);
          return true;
        }
      }

      // Try sliding on each axis before giving up (corners + door frames)
      let slid = false;
      const ax = p.x + dir.x * h;
      const gx = this.worldCollider.groundAt(ax, p.y, p.z, 0.6);
      if (gx !== null && gx - p.y <= 0.6 && p.y - gx <= 2.2) {
        this.worldCollider.pushOut(ax, p.z, 0.55, p.y, p.y + 1.8, this.pushScratch);
        if (!this.pushScratch.pushed || Math.abs(this.pushScratch.x - p.x) > 1e-4) {
          p.x = this.pushScratch.pushed ? this.pushScratch.x : ax;
          p.y = gx;
          this.homeFloorY = gx;
          advanced += h * 0.7;
          slid = true;
        }
      }
      if (!slid) {
        const az = p.z + dir.z * h;
        const gz = this.worldCollider.groundAt(p.x, p.y, az, 0.6);
        if (gz !== null && gz - p.y <= 0.6 && p.y - gz <= 2.2) {
          this.worldCollider.pushOut(p.x, az, 0.55, p.y, p.y + 1.8, this.pushScratch);
          if (!this.pushScratch.pushed || Math.abs(this.pushScratch.z - p.z) > 1e-4) {
            p.z = this.pushScratch.pushed ? this.pushScratch.z : az;
            p.y = gz;
            this.homeFloorY = gz;
            advanced += h * 0.7;
            slid = true;
          }
        }
      }
      return slid || advanced > 0;
    }
    return advanced > 0;
  }

  /**
   * Initiates a parabolic vault or jump-down off a ledge, roof, or over a low parapet.
   */
  public startVault(dir: THREE.Vector3, targetFloorY: number, horizSpeed: number = 6.0, upwardVel: number = 4.2): void {
    this.isVaulting = true;
    this.vaultTargetY = targetFloorY;
    this.vaultDuration = 0;
    this.vaultVelocity.set(dir.x * horizSpeed, upwardVel, dir.z * horizSpeed);
    soundManager.playThugAimClick();
  }

  /**
   * Simulates ballistic airborne vault physics with gravity and ground touchdown.
   */
  private updateVault(dt: number): void {
    this.vaultDuration += dt;
    // Gravity: -22.0 m/s^2
    this.vaultVelocity.y -= 22.0 * dt;

    const p = this.group.position;
    const nextX = p.x + this.vaultVelocity.x * dt;
    const nextZ = p.z + this.vaultVelocity.z * dt;
    const nextY = p.y + this.vaultVelocity.y * dt;

    // Mid-air collision against tall walls (do not penetrate building facades while falling)
    if (this.worldCollider) {
      // Only tall building facades extending high above the vault arc block mid-air travel
      const checkY = Math.max(p.y, this.vaultTargetY) + 2.0;
      this.worldCollider.pushOut(nextX, nextZ, 0.55, checkY, checkY + 1.5, this.pushScratch);
      if (this.pushScratch.pushed) {
        p.x = this.pushScratch.x;
        p.z = this.pushScratch.z;
        const dot = this.vaultVelocity.x * this.pushScratch.nx + this.vaultVelocity.z * this.pushScratch.nz;
        if (dot < 0) {
          this.vaultVelocity.x -= this.pushScratch.nx * dot;
          this.vaultVelocity.z -= this.pushScratch.nz * dot;
        }
      } else {
        p.x = nextX;
        p.z = nextZ;
      }
    } else {
      p.x = nextX;
      p.z = nextZ;
    }
    p.y = nextY;

    // Face airborne trajectory (reusing tmpAim, zero garbage)
    this.tmpVaultDir.set(this.vaultVelocity.x, 0, this.vaultVelocity.z);
    if (this.tmpVaultDir.lengthSq() > 0.01) {
      this.tmpAim.copy(p).add(this.tmpVaultDir);
      this.facePosition(this.tmpAim);
    }

    // Touchdown detection: when descending, check for solid floor matching target landing level
    if (this.worldCollider && this.vaultVelocity.y <= 0) {
      const ground = this.worldCollider.groundAt(p.x, p.y + 0.3, p.z, 0.8);
      if (ground !== null && Math.abs(ground - this.vaultTargetY) <= 1.5 && p.y <= ground + 0.4) {
        p.y = ground;
        this.homeFloorY = ground;
        this.isVaulting = false;
        this.vaultVelocity.set(0, 0, 0);
        return;
      }
    } else if (!this.worldCollider && p.y <= this.vaultTargetY) {
      p.y = this.vaultTargetY;
      this.homeFloorY = this.vaultTargetY;
      this.isVaulting = false;
      this.vaultVelocity.set(0, 0, 0);
      return;
    }

    // Street level failsafe clamp
    if (p.y <= 0.5) {
      p.y = 0.5;
      this.homeFloorY = 0.5;
      this.isVaulting = false;
      this.vaultVelocity.set(0, 0, 0);
      return;
    }

    // Timeout failsafe
    if (this.vaultDuration > this.vaultMaxTime) {
      this.isVaulting = false;
      this.vaultVelocity.set(0, 0, 0);
      if (this.worldCollider) {
        const g = this.worldCollider.groundAt(p.x, p.y, p.z, 50);
        if (g !== null) {
          p.y = g;
          this.homeFloorY = g;
        }
      }
      return;
    }

    // Procedural airborne animation (legs tucked, slight athletic lean)
    this.leftLegGroup.rotation.x = -0.5;
    this.rightLegGroup.rotation.x = -0.3;
    this.torsoGroup.rotation.x = 0.25;
  }

  /**
   * Sweeps radial directions to find the closest ledge/parapet dropping down towards player.
   */
  private tryFindAndVaultLedge(playerPos: THREE.Vector3): boolean {
    if (!this.worldCollider) return false;
    const myPos = this.group.position;
    const baseAngle = Math.atan2(playerPos.x - myPos.x, playerPos.z - myPos.z);
    const offsets = [0, 0.785, -0.785, 1.57, -1.57, 2.356, -2.356, Math.PI];
    for (let i = 0; i < offsets.length; i++) {
      const ang = baseAngle + offsets[i];
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      const probeX = myPos.x + dx * 2.2;
      const probeZ = myPos.z + dz * 2.2;
      this.worldCollider.pushOut(probeX, probeZ, 0.55, myPos.y + 1.4, myPos.y + 2.0, this.pushScratchHigh);
      if (!this.pushScratchHigh.pushed) {
        const dropGround = this.worldCollider.groundAt(probeX, myPos.y + 0.4, probeZ, 80);
        if (dropGround !== null && dropGround < myPos.y - 1.0) {
          this.tmpVaultDir.set(dx, 0, dz);
          this.startVault(this.tmpVaultDir, dropGround, 6.5, 4.5);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Procedural pendulum walk cycle for legs and torso
   */
  private updateWalkAnimation(dt: number, isMoving: boolean): void {
    if (isMoving) {
      this.walkCycle += dt * 8.0 * this.speedMultiplier;
      const legSwing = Math.sin(this.walkCycle) * 0.45;
      this.leftLegGroup.rotation.x = legSwing;
      this.rightLegGroup.rotation.x = -legSwing;
      if (this.leftArmGroup) this.leftArmGroup.rotation.x = -legSwing * 0.8;
      this.torsoGroup.position.y = 1.05 + Math.abs(Math.cos(this.walkCycle)) * 0.05;
      // Lean into the stride; idle stays upright.
      this.torsoGroup.rotation.x = THREE.MathUtils.lerp(this.torsoGroup.rotation.x, 0.08, dt * 6.0);
    } else {
      // Return to neutral standing stance
      this.leftLegGroup.rotation.x = THREE.MathUtils.lerp(this.leftLegGroup.rotation.x, 0, dt * 6.0);
      this.rightLegGroup.rotation.x = THREE.MathUtils.lerp(this.rightLegGroup.rotation.x, 0, dt * 6.0);
      if (this.leftArmGroup) this.leftArmGroup.rotation.x = THREE.MathUtils.lerp(this.leftArmGroup.rotation.x, 0, dt * 6.0);
      this.torsoGroup.position.y = THREE.MathUtils.lerp(this.torsoGroup.position.y, 1.05, dt * 6.0);
      this.torsoGroup.rotation.x = THREE.MathUtils.lerp(this.torsoGroup.rotation.x, 0, dt * 6.0);
    }

    // Recover gun recoil
    this.gunGroup.position.z = THREE.MathUtils.lerp(this.gunGroup.position.z, 0.2, dt * 14.0);
  }
}

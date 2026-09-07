import * as THREE from 'three';
import { Enemy, EnemyState } from './Enemy';
import { soundManager } from '../core/SoundManager';
import { InkParticles } from '../effects/InkParticles';

/**
 * Flying octagonal sketch drone with rotating rotors.
 * Maneuvers in 3D airspace around the construction site, strafes and orbits,
 * and fires twin red ink darts from underslung blasters.
 */
export class DroneEnemy extends Enemy {
  // Flight dynamics (inspired by inspiration's _thinkFlyer with orbit, dive, climb)
  private flightSpeed: number = 7.5;
  private preferredDistance: number = 17.0;
  private orbitSpeed: number = 0.5; // Radians per second
  private orbitAngle: number = Math.random() * Math.PI * 2;
  private targetAltitude: number = 16.0;
  private strafeDir: number = Math.random() > 0.5 ? 1 : -1;
  private strafeSwitchTimer: number = 3.0;

  // 3D Aerial state machine: orbit -> dive -> climb -> orbit
  private flightState: 'orbit' | 'dive' | 'climb' = 'orbit';
  private diveTimer: number = 0;
  private climbTimer: number = 0;
  private diveTarget: THREE.Vector3 = new THREE.Vector3();

  // Attack parameters
  private attackCooldownTimer: number = 1.2;
  private readonly attackCooldown: number = 1.5;
  private alternateBlaster: boolean = false;
  // Pre-dive telegraph: 0.5s dip + whine before darts (fairness)
  private telegraphTimer: number = -1;

  // Concurrency gate: max 3 drones in firing telegraph at once
  private static activeFiringTelegraphs: number = 0;
  private firingToken: boolean = false;

  public static resetConcurrency(): void {
    DroneEnemy.activeFiringTelegraphs = 0;
  }

  private releaseFiringToken(): void {
    if (this.firingToken) {
      this.firingToken = false;
      DroneEnemy.activeFiringTelegraphs = Math.max(0, DroneEnemy.activeFiringTelegraphs - 1);
    }
  }

  // Tumbling wreck falling death state (1.2s before paper/ink burst)
  private wreckTimer: number = 1.2;
  private wreckVelocityY: number = 0;

  // Visual rig parts
  private rotorBlades: THREE.Group[] = [];
  private droneBodyGroup!: THREE.Group;
  private leftMuzzleSocket!: THREE.Object3D;
  private rightMuzzleSocket!: THREE.Object3D;
  private bellyLight: THREE.Mesh | null = null;
  private tailFin: THREE.Mesh | null = null;
  private tmpTarget: THREE.Vector3 = new THREE.Vector3();
  private tmpMove: THREE.Vector3 = new THREE.Vector3();
  private tmpToPlayer: THREE.Vector3 = new THREE.Vector3();
  private tmpMuzzle: THREE.Vector3 = new THREE.Vector3();
  private tmpAim: THREE.Vector3 = new THREE.Vector3();
  private tmpMeshPos: THREE.Vector3 = new THREE.Vector3();
  private losRaycaster: THREE.Raycaster = new THREE.Raycaster();
  private losTimer: number = 0;
  private losClear: boolean = true;

  constructor(position: THREE.Vector3) {
    // 60 HP: fast and agile aerial target (1 sniper shot or 2-3 pistol shots)
    super('drone', 60, position);
    this.scoreValue = 150;
    this.xpValue = 35;
    this.eyeHeight = 0.6;
    this.corpseLifetime = 1.2;
    this.wreckTimer = 1.2;
    this.targetAltitude = position.y;

    this.buildModel();
  }

  protected buildModel(): void {
    this.droneBodyGroup = new THREE.Group();
    this.droneBodyGroup.name = 'DroneBody';

    // 1. Octagonal Fuselage Chassis
    const chassisGeom = new THREE.CylinderGeometry(0.65, 0.7, 0.25, 8);
    const chassisMesh = this.createMesh(chassisGeom, this.primaryEnemyMat, false, true);
    this.droneBodyGroup.add(chassisMesh);

    // Chassis top armor plate (bold red dome)
    const topPlateGeom = new THREE.CylinderGeometry(0.45, 0.6, 0.1, 8);
    const topPlate = this.createMesh(topPlateGeom, this.accentRedMat, false, true);
    topPlate.position.set(0, 0.16, 0);
    this.droneBodyGroup.add(topPlate);

    // 2. Central Weakpoint Core / Red Sensor Dome (Head weakpoint!)
    const coreGeom = new THREE.SphereGeometry(0.24, 8, 8);
    const coreMesh = this.createMesh(coreGeom, this.accentRedMat, true, true);
    coreMesh.position.set(0, 0.12, 0);
    this.droneBodyGroup.add(coreMesh);

    // Front glowing red optic eye
    const eyeGeom = new THREE.SphereGeometry(0.12, 6, 6);
    const eyeMesh = this.createMesh(eyeGeom, this.accentRedMat, true, false);
    eyeMesh.position.set(0, 0.05, 0.62);
    this.droneBodyGroup.add(eyeMesh);

    // 3. 4 Outrigger Motor Arms & Rotating Rotor Assemblies
    const armRadius = 0.85;
    const armAngles = [
      Math.PI * 0.25,
      Math.PI * 0.75,
      Math.PI * 1.25,
      Math.PI * 1.75
    ];

    const rotorArmGeom = new THREE.BoxGeometry(0.12, 0.06, 0.55);
    const motorPodGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.14, 6);
    const bladeGeom = new THREE.BoxGeometry(0.65, 0.02, 0.07);

    armAngles.forEach((angle) => {
      const armGroup = new THREE.Group();
      armGroup.rotation.y = angle;

      // Arm strut
      const arm = this.createMesh(rotorArmGeom, this.primaryEnemyMat, false, true);
      arm.position.set(0, 0.05, armRadius * 0.55);
      armGroup.add(arm);

      // Motor pod (red ink)
      const pod = this.createMesh(motorPodGeom, this.accentRedMat, false, true);
      pod.position.set(0, 0.1, armRadius);
      armGroup.add(pod);

      // Rotor Blades
      const rotorGroup = new THREE.Group();
      rotorGroup.position.set(0, 0.18, armRadius);

      const blade1 = this.createMesh(bladeGeom, this.primaryEnemyMat, false, false);
      rotorGroup.add(blade1);

      const blade2 = this.createMesh(bladeGeom, this.primaryEnemyMat, false, false);
      blade2.rotation.y = Math.PI * 0.5;
      rotorGroup.add(blade2);

      // Red ink center spinner hub
      const hubGeom = new THREE.SphereGeometry(0.05, 6, 6);
      const hub = this.createMesh(hubGeom, this.accentRedMat, false, false);
      rotorGroup.add(hub);

      armGroup.add(rotorGroup);
      this.droneBodyGroup.add(armGroup);
      this.rotorBlades.push(rotorGroup);
    });

    // 4. Underslung Twin Red Ink Cannons
    const blasterGeom = new THREE.BoxGeometry(0.08, 0.08, 0.38);
    const barrelGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.15, 6);
    barrelGeom.rotateX(Math.PI * 0.5);

    // Left cannon (red ink)
    const leftBlaster = this.createMesh(blasterGeom, this.accentRedMat, false, false);
    leftBlaster.position.set(-0.35, -0.16, 0.2);
    const leftBarrel = this.createMesh(barrelGeom, this.accentRedMat, false, false);
    leftBarrel.position.set(-0.35, -0.16, 0.45);
    this.droneBodyGroup.add(leftBlaster, leftBarrel);

    this.leftMuzzleSocket = new THREE.Object3D();
    this.leftMuzzleSocket.position.set(-0.35, -0.16, 0.55);
    this.droneBodyGroup.add(this.leftMuzzleSocket);

    // Right cannon (red ink)
    const rightBlaster = this.createMesh(blasterGeom, this.accentRedMat, false, false);
    rightBlaster.position.set(0.35, -0.16, 0.2);
    const rightBarrel = this.createMesh(barrelGeom, this.accentRedMat, false, false);
    rightBarrel.position.set(0.35, -0.16, 0.45);
    this.droneBodyGroup.add(rightBlaster, rightBarrel);

    this.rightMuzzleSocket = new THREE.Object3D();
    this.rightMuzzleSocket.position.set(0.35, -0.16, 0.55);
    this.droneBodyGroup.add(this.rightMuzzleSocket);

    // 5. Tail fin + sensor antenna + blinking belly light: round-flyer reads
    // instantly vs the humanoid thug/sniper, and the dive telegraph has a light cue.
    const finGeom = new THREE.BoxGeometry(0.06, 0.35, 0.3);
    this.tailFin = this.createMesh(finGeom, this.primaryEnemyMat, false, false);
    this.tailFin.position.set(0, 0.3, -0.55);
    this.tailFin.rotation.x = -0.25;
    this.droneBodyGroup.add(this.tailFin);

    const antGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5);
    const antenna = this.createMesh(antGeom, this.primaryEnemyMat, false, false);
    antenna.position.set(0.2, -0.3, -0.3);
    this.droneBodyGroup.add(antenna);
    const tipGeom = new THREE.SphereGeometry(0.045, 6, 6);
    this.bellyLight = this.createMesh(tipGeom, this.accentRedMat, false, false);
    this.bellyLight.position.set(0.2, -0.52, -0.3);
    this.droneBodyGroup.add(this.bellyLight);

    this.group.add(this.droneBodyGroup);
  }

  protected updateAI(dt: number, playerPos: THREE.Vector3, collidables: THREE.Mesh[]): void {
    // 1. High-speed propeller rotation + belly-light blink
    for (const rotor of this.rotorBlades) {
      rotor.rotation.y += dt * 38.0;
    }
    if (this.bellyLight) {
      const blink = 1.0 + Math.sin(this.elapsed * 6.0) * 0.35;
      this.bellyLight.scale.set(blink, blink, blink);
    }

    const myPos = this.group.position;
    const distToPlayer = myPos.distanceTo(playerPos);

    if (!this.alerted && distToPlayer < 65.0) {
      this.alert(playerPos);
    }

    // 2. Aerial movement & flight state machine (inspired by inspiration's _thinkFlyer)
    const currentFlightSpeed = this.flightSpeed * this.speedMultiplier;
    const diveSpeed = Math.max(14.0, currentFlightSpeed * 1.6);
    const climbSpeed = Math.max(9.5, currentFlightSpeed * 1.2);

    this.orbitAngle += dt * this.orbitSpeed * this.strafeDir;
    this.strafeSwitchTimer -= dt;
    if (this.strafeSwitchTimer <= 0) {
      this.strafeDir = Math.random() > 0.5 ? 1 : -1;
      this.strafeSwitchTimer = 3.0 + Math.random() * 3.0;
    }

    let speedToUse = currentFlightSpeed;

    if (this.flightState === 'dive') {
      this.tmpTarget.copy(this.diveTarget);
      speedToUse = diveSpeed;
      this.diveTimer -= dt;
      if (this.diveTimer <= 0 || myPos.distanceTo(this.diveTarget) < 3.0) {
        this.flightState = 'climb';
        this.climbTimer = 1.0;
      }
    } else if (this.flightState === 'climb') {
      const exitX = playerPos.x + Math.cos(this.orbitAngle + 1.0) * (this.preferredDistance * 1.2);
      const exitZ = playerPos.z + Math.sin(this.orbitAngle + 1.0) * (this.preferredDistance * 1.2);
      this.tmpTarget.set(exitX, playerPos.y + 8.0, exitZ);
      speedToUse = climbSpeed;
      this.climbTimer -= dt;
      if (this.climbTimer <= 0) {
        this.flightState = 'orbit';
      }
    } else {
      // Standard ORBIT state
      const targetX = playerPos.x + Math.cos(this.orbitAngle) * this.preferredDistance;
      const targetZ = playerPos.z + Math.sin(this.orbitAngle) * this.preferredDistance;
      // Hover slightly above player altitude with organic breathing bob (inspiration line 694)
      const targetY = playerPos.y + 4.5 + Math.sin(this.elapsed * 1.8) * 1.5;
      this.tmpTarget.set(targetX, targetY, targetZ);
    }

    // Orbit/flight lane must be flyable: clamp target out of walls/floors
    if (this.worldCollider) {
      this.worldCollider.pushOut(this.tmpTarget.x, this.tmpTarget.z, 1.6, this.tmpTarget.y - 1.0, this.tmpTarget.y + 1.0, this.pushScratch);
      if (this.pushScratch.pushed) {
        this.tmpTarget.x = this.pushScratch.x;
        this.tmpTarget.z = this.pushScratch.z;
      }
      const tg = this.worldCollider.groundAt(this.tmpTarget.x, this.tmpTarget.y, this.tmpTarget.z, 50);
      if (tg !== null && this.tmpTarget.y < tg + 1.8) this.tmpTarget.y = tg + 1.8;
    }
    this.tmpMove.copy(this.tmpTarget).sub(myPos);
    const moveDist = this.tmpMove.length();

    if (moveDist > 0.1) {
      this.tmpMove.normalize();
      const currentSpeed = Math.min(speedToUse, moveDist * 2.5);
      // Swept flight: small sub-steps so high speeds cannot tunnel thin parapets
      const steps = Math.max(1, Math.ceil((currentSpeed * dt) / 0.5));
      const h = (currentSpeed * dt) / steps;
      for (let s = 0; s < steps; s++) {
        myPos.addScaledVector(this.tmpMove, h);
        if (this.worldCollider) {
          this.worldCollider.pushOut(myPos.x, myPos.z, 1.2, myPos.y - 0.8, myPos.y + 0.8, this.pushScratch);
          if (this.pushScratch.pushed) {
            myPos.x = this.pushScratch.x;
            myPos.z = this.pushScratch.z;
            // Smoothly slide along wall tangent and rotate orbit around obstacle corner
            const tx = -this.pushScratch.nz;
            const tz = this.pushScratch.nx;
            myPos.x += tx * this.strafeDir * 2.5 * h;
            myPos.z += tz * this.strafeDir * 2.5 * h;
            this.orbitAngle += this.strafeDir * 2.0 * dt;
            myPos.y += 2.0 * dt;
          }
        }
      }
    }

    // 2b. Shell-first building avoidance; mesh spheres stay as the headless-test fallback
    if (this.worldCollider) {
      this.worldCollider.pushOut(myPos.x, myPos.z, 1.2, myPos.y - 0.8, myPos.y + 0.8, this.pushScratch);
      if (this.pushScratch.pushed) {
        myPos.x = this.pushScratch.x;
        myPos.z = this.pushScratch.z;
      }
      const ground = this.worldCollider.groundAt(myPos.x, myPos.y, myPos.z, 50);
      if (ground !== null && myPos.y < ground + 1.2) myPos.y = ground + 1.2;
      // Rooftop clearance: never hover inside a slab the orbit lane clipped
      const ceil = this.worldCollider.ceilingAt(myPos.x, myPos.y - 1.0, myPos.z);
      if (ceil !== null && myPos.y > ceil - 0.8) myPos.y = ceil - 0.8;
    } else if (collidables.length > 0) {
      for (let i = 0; i < collidables.length; i += 3) {
        const mesh = collidables[i];
        if (!mesh.geometry.boundingSphere) {
          mesh.geometry.computeBoundingSphere();
        }
        const sphereRadius = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius : 3.0;
        mesh.getWorldPosition(this.tmpMeshPos);

        // Check vertical proximity
        if (Math.abs(myPos.y - this.tmpMeshPos.y) > sphereRadius + 4.0) continue;

        const dx = myPos.x - this.tmpMeshPos.x;
        const dz = myPos.z - this.tmpMeshPos.z;
        const dist = Math.hypot(dx, dz);
        const avoidThreshold = sphereRadius + 6.0;

        if (dist < avoidThreshold && dist > 1e-4) {
          const minSafeDist = sphereRadius + 1.5;
          if (dist < minSafeDist) {
            const overlap = minSafeDist - dist;
            myPos.x += (dx / dist) * overlap;
            myPos.z += (dz / dist) * overlap;
          } else {
            const pushFactor = (avoidThreshold - dist) / 6.0;
            const pushSpeed = 6.0 * pushFactor * dt;
            myPos.x += (dx / dist) * pushSpeed;
            myPos.z += (dz / dist) * pushSpeed;
          }
        }
      }
    }

    // Organic hover vertical bobbing (absolute sine around the lane, never accumulates)
    if (this.flightState === 'orbit') {
      myPos.y += Math.sin(this.elapsed * 4.0) * 0.15 * dt;
    }

    // 3. Aim at Spider-Man
    this.tmpToPlayer.copy(playerPos).sub(myPos);
    const flatAngle = Math.atan2(this.tmpToPlayer.x, this.tmpToPlayer.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, flatAngle, 0.16);

    // Dynamic flight tilt (banking into movement and pitch)
    const bankZ = -this.tmpMove.x * 0.35 * this.strafeDir;
    let bankX = this.tmpMove.z * 0.25;
    if (this.flightState === 'dive') bankX += 0.35;
    else if (this.flightState === 'climb') bankX -= 0.3;
    this.droneBodyGroup.rotation.z = THREE.MathUtils.lerp(this.droneBodyGroup.rotation.z, bankZ, dt * 6.0);
    this.droneBodyGroup.rotation.x = THREE.MathUtils.lerp(this.droneBodyGroup.rotation.x, bankX, dt * 6.0);

    // Throttled LOS: drones hold fire through concrete, they reposition instead.
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.25;
      this.rightMuzzleSocket.getWorldPosition(this.tmpMuzzle);
      this.tmpAim.copy(playerPos); // Center chest
      if (this.worldCollider) {
        this.losClear = this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.tmpAim);
      } else {
        this.tmpToPlayer.copy(this.tmpAim).sub(this.tmpMuzzle);
        const d = this.tmpToPlayer.length();
        if (d < 1e-4 || collidables.length === 0) {
          this.losClear = true;
        } else {
          this.tmpToPlayer.normalize();
          this.losRaycaster.set(this.tmpMuzzle, this.tmpToPlayer);
          this.losRaycaster.far = d;
          const hits = this.losRaycaster.intersectObjects(collidables, false);
          this.losClear = hits.length === 0 || hits[0].distance >= d - 0.6;
        }
      }
    }

    // 4. Attack: Twin red ink dart burst (telegraphed dive first, max 3 drones telegraphing)
    if (this.telegraphTimer >= 0) {
      this.telegraphTimer -= dt;
      // Telegraph dip never dives through the floor it is hovering over.
      let dip = 1.2 * dt;
      if (this.worldCollider) {
        const g = this.worldCollider.groundAt(myPos.x, myPos.y, myPos.z, 50);
        if (g !== null) dip = Math.min(dip, Math.max(0, myPos.y - (g + 1.0)));
      }
      myPos.y -= dip;
      if (this.telegraphTimer <= 0) {
        this.telegraphTimer = -1;
        this.releaseFiringToken();
        // Wall slid between dip and release: swallow the shot, keep the cooldown.
        if (this.worldCollider) {
          this.rightMuzzleSocket.getWorldPosition(this.tmpMuzzle);
          this.tmpAim.copy(playerPos);
          this.losClear = this.worldCollider.hasLineOfSight(this.tmpMuzzle, this.tmpAim);
        }
        if (this.losClear) {
          this.fireTwinDarts(playerPos);
          // Initiate fast dive pass (inspiration)
          this.flightState = 'dive';
          this.diveTimer = 0.9;
          this.diveTarget.copy(playerPos).add(
            new THREE.Vector3(Math.cos(this.orbitAngle) * 4.0, 1.5, Math.sin(this.orbitAngle) * 4.0)
          );
        }
        this.attackCooldownTimer = this.attackCooldown + (Math.random() - 0.5) * 0.3;
      }
    } else {
      this.attackCooldownTimer -= dt;
      if (this.flightState === 'orbit' && this.attackCooldownTimer <= 0 && distToPlayer < 32.0 && this.spawnGrace <= 0 && this.losClear) {
        if (DroneEnemy.activeFiringTelegraphs < 3) {
          DroneEnemy.activeFiringTelegraphs++;
          this.firingToken = true;
          this.telegraphTimer = 0.5;
          soundManager.playPredive();
        }
      }
    }
  }

  /**
   * Fires alternating or twin red ink darts toward the player
   */
  private fireTwinDarts(playerPos: THREE.Vector3): void {
    const muzzle = this.alternateBlaster ? this.leftMuzzleSocket : this.rightMuzzleSocket;
    this.alternateBlaster = !this.alternateBlaster;

    muzzle.getWorldPosition(this.tmpMuzzle);

    // Aim toward player chest
    this.tmpAim.copy(playerPos);

    // Dynamic combat spread scaled with player speed (inspired by inspiration's const sp = spread * (1 + P.speed * 0.06))
    const pSpeed = this.playerSpeed || 0;
    const spread = 0.035 * (1.0 + pSpeed * 0.05);
    const dist = this.tmpAim.distanceTo(this.tmpMuzzle);
    this.tmpAim.x += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.y += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.z += (Math.random() - 0.5) * spread * dist;

    this.tmpAim.sub(this.tmpMuzzle).normalize();

    this.pendingProjectiles.push({
      origin: this.tmpMuzzle.clone(),
      direction: this.tmpAim.clone(),
      speed: 40.0,
      damage: Math.max(1, Math.round(7 * this.damageMultiplier)),
      radius: 0.15,
      maxDistance: 70.0,
      isSniper: false,
      kind: 'drone'
    });
  }

  public override stagger(duration?: number, impulse?: THREE.Vector3): void {
    super.stagger(duration, impulse);
    if (this.telegraphTimer >= 0) {
      this.telegraphTimer = -1;
      this.releaseFiringToken();
    }
    if (this.flightState === 'dive') {
      this.flightState = 'climb';
      this.climbTimer = 0.8;
    }
    // Violent tilt / wobble when shot
    this.droneBodyGroup.rotation.z = (Math.random() - 0.5) * 0.9;
    this.droneBodyGroup.rotation.x = (Math.random() - 0.5) * 0.9;
  }

  public override die(hitPoint?: THREE.Vector3, _isHeadshot: boolean = false, _hitDirection?: THREE.Vector3): void {
    if (this.isDead) return;
    this.releaseFiringToken();

    this.isDead = true;
    this.isDying = true;
    this.state = EnemyState.DEAD;
    this.health = 0;
    this.deathTimer = 0;
    this.wreckTimer = this.corpseLifetime;
    this.wreckVelocityY = -2.0;
    this.bloodSpawnedOnFloor = false;

    // Hide UI overlays
    this.alertGroup.visible = false;
    this.healthBarGroup.visible = false;

    // Disable raycasting against meshes so tumbling wreck does not block bullets
    for (const m of this.collidableMeshes) {
      m.raycast = () => {};
    }

    soundManager.playEnemyDeath();
    soundManager.playWhistle();
  }

  public override disintegrate(particles: InkParticles, hitDir?: THREE.Vector3, isHeadshot: boolean = false): void {
    this.cachedParticles = particles;
    const origin = this.group.position.clone();
    particles.spawnBlood(origin, hitDir || new THREE.Vector3(0, 1, 0), isHeadshot ? 2.0 : 1.2, isHeadshot);
    particles.spawnBloodPool(origin, 1.2);
  }

  public override update(
    dt: number,
    playerPos: THREE.Vector3,
    camera?: THREE.Camera,
    collidables: THREE.Mesh[] = []
  ): void {
    if (this.isDying) {
      this.deathTimer += dt;
      this.wreckTimer -= dt;

      // Gravity drop, landing on the floor below instead of sinking through it.
      this.wreckVelocityY -= 18.0 * dt;
      this.group.position.y += this.wreckVelocityY * dt;
      let onGround = false;
      if (this.worldCollider) {
        const g = this.worldCollider.groundAt(
          this.group.position.x, this.group.position.y + 0.5, this.group.position.z, 50
        );
        if (g !== null && this.group.position.y <= g + 0.3) {
          this.group.position.y = g + 0.3;
          this.wreckVelocityY = 0;
          onGround = true;
        }
      }

      if (onGround && !this.bloodSpawnedOnFloor && this.cachedParticles) {
        this.bloodSpawnedOnFloor = true;
        this.cachedParticles.spawnBlood(this.group.position, new THREE.Vector3(0, 1, 0), 1.0, false);
      }

      // Tumbling angular momentum on all axes (slows down when on floor)
      const spinSpeed = onGround ? 0.3 : 1.0;
      this.droneBodyGroup.rotation.x += dt * 7.5 * spinSpeed;
      this.droneBodyGroup.rotation.y += dt * 5.0 * spinSpeed;
      this.droneBodyGroup.rotation.z += dt * 9.5 * spinSpeed;

      // Dissolve / shrink over last portion of corpseLifetime
      const shrinkDuration = Math.min(0.8, this.corpseLifetime * 0.4);
      if (this.deathTimer >= this.corpseLifetime - shrinkDuration) {
        const remaining = Math.max(0, this.corpseLifetime - this.deathTimer);
        const scaleVal = Math.max(0.001, remaining / shrinkDuration);
        this.group.scale.setScalar(scaleVal);
      }

      if (this.wreckTimer <= 0 || this.deathTimer >= this.corpseLifetime) {
        this.isDying = false;
        this.droneBodyGroup.visible = false;
        this.group.visible = false;
        for (const m of this.collidableMeshes) {
          m.visible = false;
        }
        if (this.cachedParticles) {
          const burstPos = this.group.position.clone();
          burstPos.y += 0.2;
          this.cachedParticles.spawnCorpseDissolve(burstPos);
          this.cachedParticles = null;
        }
      }
      return;
    }

    super.update(dt, playerPos, camera, collidables);
  }

  public override dispose(): void {
    this.releaseFiringToken();
    super.dispose();
  }
}

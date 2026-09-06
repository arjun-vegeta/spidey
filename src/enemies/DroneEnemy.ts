import * as THREE from 'three';
import { Enemy } from './Enemy';
import { soundManager } from '../core/SoundManager';

/**
 * Flying octagonal sketch drone with rotating rotors.
 * Maneuvers in 3D airspace around the construction site, strafes and orbits,
 * and fires twin red ink darts from underslung blasters.
 */
export class DroneEnemy extends Enemy {
  // Flight dynamics
  private flightSpeed: number = 7.5;
  private preferredDistance: number = 17.0;
  private orbitSpeed: number = 0.5; // Radians per second
  private orbitAngle: number = Math.random() * Math.PI * 2;
  private targetAltitude: number = 16.0;
  private strafeDir: number = Math.random() > 0.5 ? 1 : -1;
  private strafeSwitchTimer: number = 3.0;

  // Attack parameters
  private attackCooldownTimer: number = 1.2;
  private readonly attackCooldown: number = 1.5;
  private alternateBlaster: boolean = false;
  // Pre-dive telegraph: 0.5s dip + whine before darts (fairness)
  private telegraphTimer: number = -1;

  // Visual rig parts
  private rotorBlades: THREE.Group[] = [];
  private droneBodyGroup!: THREE.Group;
  private leftMuzzleSocket!: THREE.Object3D;
  private rightMuzzleSocket!: THREE.Object3D;
  private tmpTarget: THREE.Vector3 = new THREE.Vector3();
  private tmpMove: THREE.Vector3 = new THREE.Vector3();
  private tmpToPlayer: THREE.Vector3 = new THREE.Vector3();
  private tmpMuzzle: THREE.Vector3 = new THREE.Vector3();
  private tmpAim: THREE.Vector3 = new THREE.Vector3();

  constructor(position: THREE.Vector3) {
    // 60 HP: fast and agile aerial target (1 sniper shot or 2-3 pistol shots)
    super('drone', 60, position);
    this.scoreValue = 150;
    this.xpValue = 35;
    this.eyeHeight = 0.6;
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

    // Chassis top armor plate
    const topPlateGeom = new THREE.CylinderGeometry(0.45, 0.6, 0.1, 8);
    const topPlate = this.createMesh(topPlateGeom, this.primaryEnemyMat, false, true);
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

      // Motor pod
      const pod = this.createMesh(motorPodGeom, this.primaryEnemyMat, false, true);
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

    // Left cannon
    const leftBlaster = this.createMesh(blasterGeom, this.primaryEnemyMat, false, false);
    leftBlaster.position.set(-0.35, -0.16, 0.2);
    const leftBarrel = this.createMesh(barrelGeom, this.accentRedMat, false, false);
    leftBarrel.position.set(-0.35, -0.16, 0.45);
    this.droneBodyGroup.add(leftBlaster, leftBarrel);

    this.leftMuzzleSocket = new THREE.Object3D();
    this.leftMuzzleSocket.position.set(-0.35, -0.16, 0.55);
    this.droneBodyGroup.add(this.leftMuzzleSocket);

    // Right cannon
    const rightBlaster = this.createMesh(blasterGeom, this.primaryEnemyMat, false, false);
    rightBlaster.position.set(0.35, -0.16, 0.2);
    const rightBarrel = this.createMesh(barrelGeom, this.accentRedMat, false, false);
    rightBarrel.position.set(0.35, -0.16, 0.45);
    this.droneBodyGroup.add(rightBlaster, rightBarrel);

    this.rightMuzzleSocket = new THREE.Object3D();
    this.rightMuzzleSocket.position.set(0.35, -0.16, 0.55);
    this.droneBodyGroup.add(this.rightMuzzleSocket);

    this.group.add(this.droneBodyGroup);
  }

  protected updateAI(dt: number, playerPos: THREE.Vector3, _collidables: THREE.Mesh[]): void {
    // 1. High-speed propeller rotation
    for (const rotor of this.rotorBlades) {
      rotor.rotation.y += dt * 38.0;
    }

    const myPos = this.group.position;
    const distToPlayer = myPos.distanceTo(playerPos);

    if (!this.alerted && distToPlayer < 35.0) {
      this.alert(playerPos);
    }

    // 2. Aerial movement & circling behavior
    this.orbitAngle += dt * this.orbitSpeed * this.strafeDir;
    this.strafeSwitchTimer -= dt;
    if (this.strafeSwitchTimer <= 0) {
      this.strafeDir = Math.random() > 0.5 ? 1 : -1;
      this.strafeSwitchTimer = 3.0 + Math.random() * 3.0;
    }

    // Target orbit position around player
    const targetX = playerPos.x + Math.cos(this.orbitAngle) * this.preferredDistance;
    const targetZ = playerPos.z + Math.sin(this.orbitAngle) * this.preferredDistance;
    // Hover slightly above player altitude
    const targetY = Math.max(playerPos.y + 3.0, this.targetAltitude);

    this.tmpTarget.set(targetX, targetY, targetZ);
    this.tmpMove.copy(this.tmpTarget).sub(myPos);
    const moveDist = this.tmpMove.length();

    if (moveDist > 0.1) {
      this.tmpMove.normalize();
      const currentSpeed = Math.min(this.flightSpeed, moveDist * 2.0);
      myPos.addScaledVector(this.tmpMove, currentSpeed * dt);
    }

    // Organic hover vertical bobbing
    const hoverWobble = Math.sin(this.elapsed * 4.0) * 0.015;
    myPos.y += hoverWobble;

    // 3. Aim at Spider-Man
    this.tmpToPlayer.copy(playerPos).sub(myPos);
    const flatAngle = Math.atan2(this.tmpToPlayer.x, this.tmpToPlayer.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, flatAngle, 0.14);

    // Dynamic flight tilt (banking into movement)
    const bankZ = -this.tmpMove.x * 0.35 * this.strafeDir;
    const bankX = this.tmpMove.z * 0.25;
    this.droneBodyGroup.rotation.z = THREE.MathUtils.lerp(this.droneBodyGroup.rotation.z, bankZ, dt * 6.0);
    this.droneBodyGroup.rotation.x = THREE.MathUtils.lerp(this.droneBodyGroup.rotation.x, bankX, dt * 6.0);

    // 4. Attack: Twin red ink dart burst (telegraphed dive first)
    if (this.telegraphTimer >= 0) {
      this.telegraphTimer -= dt;
      myPos.y -= 1.2 * dt; // visible dip before firing
      if (this.telegraphTimer <= 0) {
        this.telegraphTimer = -1;
        this.fireTwinDarts(playerPos);
        this.attackCooldownTimer = this.attackCooldown + (Math.random() - 0.5) * 0.3;
      }
    } else {
      this.attackCooldownTimer -= dt;
      if (this.attackCooldownTimer <= 0 && distToPlayer < 32.0 && this.spawnGrace <= 0) {
        this.telegraphTimer = 0.5;
        soundManager.playPredive();
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
    this.tmpAim.y += 0.9;
    // Lead player slightly or slight spread
    const spread = 0.035;
    const dist = this.tmpAim.distanceTo(this.tmpMuzzle);
    this.tmpAim.x += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.y += (Math.random() - 0.5) * spread * dist;
    this.tmpAim.z += (Math.random() - 0.5) * spread * dist;

    this.tmpAim.sub(this.tmpMuzzle).normalize();

    this.pendingProjectiles.push({
      origin: this.tmpMuzzle.clone(),
      direction: this.tmpAim.clone(),
      speed: 40.0,
      damage: 7,
      radius: 0.15,
      maxDistance: 70.0,
      isSniper: false,
      kind: 'drone'
    });
  }

  public override stagger(duration?: number, impulse?: THREE.Vector3): void {
    super.stagger(duration, impulse);
    // Violent tilt / wobble when shot
    this.droneBodyGroup.rotation.z = (Math.random() - 0.5) * 0.9;
    this.droneBodyGroup.rotation.x = (Math.random() - 0.5) * 0.9;
  }

  public override die(hitPoint?: THREE.Vector3, isHeadshot?: boolean): void {
    super.die(hitPoint, isHeadshot);
    soundManager.playWhistle();
  }
}

import * as THREE from 'three';
import { Enemy, EnemyType, ProjectileSpawnRequest } from './Enemy';
import { ThugEnemy } from './ThugEnemy';
import { SniperEnemy } from './SniperEnemy';
import { DroneEnemy } from './DroneEnemy';
import { Player } from '../player/Player';
import { FireResult } from '../weapons/BaseWeapon';
import { InkParticles } from '../effects/InkParticles';
import { soundManager } from '../core/SoundManager';
import type { WorldCollider } from '../world/WorldCollider';
import { CHARACTER_HEIGHT, chestY, hitbandMaxY, hitbandMinY } from '../core/CoverMetrics';

export interface EnemyProjectile {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  damage: number;
  radius: number;
  traveled: number;
  maxDistance: number;
  mesh: THREE.Mesh;
  isSniper: boolean;
  kind: EnemyType;
  nearMissTriggered?: boolean;
}

export interface KillEvent {
  enemyId: string;
  enemyType: EnemyType;
  position: THREE.Vector3;
  isHeadshot: boolean;
  isSwinging: boolean;
  distance: number;
  scoreAwarded: number;
  xpAwarded: number;
  comboMultiplier: number;
  wave: number;
  killStreak: number;
}

export interface HitReport {
  enemy: Enemy;
  damageDealt: number;
  isHeadshot: boolean;
  killed: boolean;
  killEvent?: KillEvent;
}

export interface SpawnNode {
  position: THREE.Vector3;
  allowedTypes: EnemyType[];
  floorName: string;
  waypoints?: THREE.Vector3[];
}

export interface WaveModifier {
  name: string;
  description: string;
  speed: number;
  damage: number;
}

export const WAVE_MODIFIERS: WaveModifier[] = [
  { name: '', description: 'eliminate all ink hostiles', speed: 1.0, damage: 1.0 },
  { name: 'CAFFEINATED', description: 'they move fast', speed: 1.30, damage: 0.85 },
  { name: 'HEAVY INK', description: 'they hit harder', speed: 0.90, damage: 1.35 },
  { name: 'SWARM', description: 'aggressive & agile', speed: 1.15, damage: 0.90 },
];

/**
 * Pure segment-vs-player-capsule test (XZ circle + height band).
 * Returns true when the travel segment p0->p1 passes within hitR of the
 * player's vertical axis while inside [minY, maxY]. Exported for tests.
 */
export function segmentHitsPlayer(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  hitR: number,
  playerPos: THREE.Vector3,
  minY: number,
  maxY: number
): boolean {
  const ex = p1.x - p0.x;
  const ez = p1.z - p0.z;
  const fx = p0.x - playerPos.x;
  const fz = p0.z - playerPos.z;
  const a = ex * ex + ez * ez;
  let t = a > 1e-9 ? -(fx * ex + fz * ez) / a : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = p0.x + ex * t - playerPos.x;
  const cz = p0.z + ez * t - playerPos.z;
  if (cx * cx + cz * cz > hitR * hitR) return false;
  const cy = p0.y + (p1.y - p0.y) * t;
  return cy >= minY && cy <= maxY;
}

/**
 * Calculates the exact distance along segment p0->p1 where it hits the player capsule.
 * Returns the distance from p0 to the hit, or null if no hit. Exported for tests.
 */
export function segmentPlayerHitDistance(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  hitR: number,
  playerPos: THREE.Vector3,
  minY: number,
  maxY: number
): number | null {
  const ex = p1.x - p0.x;
  const ez = p1.z - p0.z;
  const fx = p0.x - playerPos.x;
  const fz = p0.z - playerPos.z;
  const a = ex * ex + ez * ez;
  let t = a > 1e-9 ? -(fx * ex + fz * ez) / a : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = p0.x + ex * t - playerPos.x;
  const cz = p0.z + ez * t - playerPos.z;
  if (cx * cx + cz * cz > hitR * hitR) return null;
  const cy = p0.y + (p1.y - p0.y) * t;
  if (cy < minY || cy > maxY) return null;
  const stepLen = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  return t * stepLen;
}

/**
 * Manages wave spawning, active enemies, enemy projectiles,
 * bullet hit detection, score/combo calculation, and wave progression.
 */
export class EnemyManager {
  public scene: THREE.Scene;
  public particles: InkParticles;
  public collidableMeshes: THREE.Mesh[] = [];
  public worldCollider: WorldCollider | null = null;
  private wallScratch: { x: number; z: number; nx: number; nz: number; pushed: boolean } = {
    x: 0, z: 0, nx: 0, nz: 0, pushed: false,
  };

  // Active enemies & projectiles
  public enemies: Enemy[] = [];
  public corpses: Enemy[] = [];
  public projectiles: EnemyProjectile[] = [];
  private projectileGroup: THREE.Group = new THREE.Group();

  // Wave state
  public currentWave: number = 0;
  public enemiesLeft: number = 0;
  public totalEnemiesInWave: number = 0;
  public waveInProgress: boolean = false;
  public intermissionTimer: number = 0;
  public readonly intermissionDuration: number = 3.5;

  // Wave speed and damage modifiers (inspired by inspiration's enemies.mods)
  public mods: { speed: number; damage: number } = { speed: 1.0, damage: 1.0 };
  public activeModifier: WaveModifier = WAVE_MODIFIERS[0];
  private static slotCounter: number = 0;

  // Combo & scoring state
  public totalScore: number = 0;
  public totalKills: number = 0;
  public killStreak: number = 0;
  public streakTimer: number = 0;
  private readonly streakExpiry: number = 4.0;

  // Event callbacks
  public onKill?: (event: KillEvent) => void;
  public onWaveStart?: (wave: number, totalEnemies: number) => void;
  public onWaveComplete?: (wave: number) => void;
  // Fired whenever an enemy projectile damages the player (HUD direction indicator)
  public onPlayerDamaged?: (fromPos: THREE.Vector3) => void;

  // Recap of the killing blow for the death screen (null until player dies)
  public lastPlayerDeath: string | null = null;

  // Designated spawn nodes across the construction site floors and rooftops
  public spawnNodes: SpawnNode[] = [];

  // Shared projectile resources
  private bulletMaterial: THREE.MeshBasicMaterial;
  private sniperBulletMaterial: THREE.MeshBasicMaterial;
  private bulletGeometry: THREE.BufferGeometry;
  private sniperGeometry: THREE.BufferGeometry;

  // Raycaster for projectile wall collision
  private projectileRaycaster: THREE.Raycaster = new THREE.Raycaster();
  private tmpPrev: THREE.Vector3 = new THREE.Vector3();
  private tmpStep: THREE.Vector3 = new THREE.Vector3();
  private tmpStepNorm: THREE.Vector3 = new THREE.Vector3();
  private tmpMeshPos: THREE.Vector3 = new THREE.Vector3();
  private nearMeshes: THREE.Mesh[] = [];

  public bindCollider(c: WorldCollider | null): void {
    this.worldCollider = c;
    this.particles.bindCollider(c);
    for (const e of this.enemies) e.bindCollider(c);
    for (const e of this.corpses) e.bindCollider(c);
  }

  constructor(scene: THREE.Scene, particles: InkParticles, collidableMeshes: THREE.Mesh[] = []) {
    this.scene = scene;
    this.particles = particles;
    this.collidableMeshes = collidableMeshes;

    this.projectileGroup.name = 'EnemyProjectiles';
    this.scene.add(this.projectileGroup);

    // Initialize projectile visuals (red sketch ink)
    this.bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xd63031 });
    this.sniperBulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff2222 });

    const bGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.45, 6);
    bGeom.rotateX(Math.PI * 0.5);
    this.bulletGeometry = bGeom;

    const sGeom = new THREE.CylinderGeometry(0.065, 0.065, 1.4, 6);
    sGeom.rotateX(Math.PI * 0.5);
    this.sniperGeometry = sGeom;

    this.initSpawnNodes();
  }

  /**
   * Initializes tactical spawn nodes across construction site floors, catwalks, cranes, and airspace
   */
  private initSpawnNodes(): void {
    // Floor 0 (Ground Foundation Y = 0.5)
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-8.0, 0.5, 4.0),
        allowedTypes: ['thug'],
        floorName: 'Ground Floor',
        waypoints: [
          new THREE.Vector3(-8.0, 0.5, 4.0),
          new THREE.Vector3(-2.0, 0.5, 4.0),
          new THREE.Vector3(-2.0, 0.5, 8.0),
          new THREE.Vector3(-8.0, 0.5, 8.0)
        ]
      },
      {
        position: new THREE.Vector3(6.0, 0.5, -4.0),
        allowedTypes: ['thug'],
        floorName: 'Ground Floor',
        waypoints: [
          new THREE.Vector3(6.0, 0.5, -4.0),
          new THREE.Vector3(10.0, 0.5, -4.0),
          new THREE.Vector3(10.0, 0.5, 2.0),
          new THREE.Vector3(6.0, 0.5, 2.0)
        ]
      },
      {
        position: new THREE.Vector3(-6.0, 0.5, -7.0),
        allowedTypes: ['thug'],
        floorName: 'Ground Floor',
        waypoints: [
          new THREE.Vector3(-6.0, 0.5, -7.0),
          new THREE.Vector3(0.0, 0.5, -7.0),
          new THREE.Vector3(0.0, 0.5, -3.0),
          new THREE.Vector3(-6.0, 0.5, -3.0)
        ]
      }
    );

    // Floor 1 (Y = 5.5)
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-6.0, 5.5, 4.0),
        allowedTypes: ['thug'],
        floorName: 'Level 1',
        waypoints: [
          new THREE.Vector3(-6.0, 5.5, 4.0),
          new THREE.Vector3(3.0, 5.5, 4.0),
          new THREE.Vector3(3.0, 5.5, 8.0),
          new THREE.Vector3(-6.0, 5.5, 8.0)
        ]
      },
      {
        position: new THREE.Vector3(4.0, 5.5, -5.0),
        allowedTypes: ['thug'],
        floorName: 'Level 1',
        waypoints: [
          new THREE.Vector3(4.0, 5.5, -5.0),
          new THREE.Vector3(10.0, 5.5, -5.0),
          new THREE.Vector3(10.0, 5.5, -1.0),
          new THREE.Vector3(4.0, 5.5, -1.0)
        ]
      }
    );

    // Floor 2 (Y = 10.5)
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-5.0, 10.5, -3.0),
        allowedTypes: ['thug'],
        floorName: 'Level 2',
        waypoints: [
          new THREE.Vector3(-5.0, 10.5, -3.0),
          new THREE.Vector3(2.0, 10.5, -3.0),
          new THREE.Vector3(2.0, 10.5, 3.0),
          new THREE.Vector3(-5.0, 10.5, 3.0)
        ]
      },
      {
        position: new THREE.Vector3(4.0, 10.5, 5.0),
        allowedTypes: ['thug'],
        floorName: 'Level 2',
        waypoints: [
          new THREE.Vector3(4.0, 10.5, 5.0),
          new THREE.Vector3(9.0, 10.5, 5.0),
          new THREE.Vector3(9.0, 10.5, 8.0),
          new THREE.Vector3(4.0, 10.5, 8.0)
        ]
      }
    );

    // Floor 3 & Skybridge (Y = 15.5)
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-6.0, 15.5, 0.0),
        allowedTypes: ['thug'],
        floorName: 'Level 3 Slab',
        waypoints: [
          new THREE.Vector3(-6.0, 15.5, -4.0),
          new THREE.Vector3(2.0, 15.5, -4.0),
          new THREE.Vector3(2.0, 15.5, 4.0),
          new THREE.Vector3(-6.0, 15.5, 4.0)
        ]
      },
      {
        position: new THREE.Vector3(-22.0, 15.5, 0.0),
        allowedTypes: ['thug'],
        floorName: 'Skybridge Catwalk',
        waypoints: [
          new THREE.Vector3(-15.0, 15.5, 0.0),
          new THREE.Vector3(-30.0, 15.5, 0.0)
        ]
      }
    );

    // Roof (Y = 20.5)
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-7.0, 20.5, 5.0),
        allowedTypes: ['thug'],
        floorName: 'Rooftop',
        waypoints: [
          new THREE.Vector3(-7.0, 20.5, 5.0),
          new THREE.Vector3(0.0, 20.5, 5.0),
          new THREE.Vector3(0.0, 20.5, -4.0),
          new THREE.Vector3(-7.0, 20.5, -4.0)
        ]
      },
      {
        position: new THREE.Vector3(6.0, 20.5, -5.0),
        allowedTypes: ['thug'],
        floorName: 'Rooftop',
        waypoints: [
          new THREE.Vector3(6.0, 20.5, -5.0),
          new THREE.Vector3(10.0, 20.5, -5.0),
          new THREE.Vector3(10.0, 20.5, 4.0),
          new THREE.Vector3(6.0, 20.5, 4.0)
        ]
      }
    );

    // High Perch Sniper Vantage Points
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-11.0, 21.5, -2.0),
        allowedTypes: ['sniper'],
        floorName: 'Crane Counterweight'
      },
      {
        position: new THREE.Vector3(17.0, 46.0, -2.0),
        allowedTypes: ['sniper'],
        floorName: 'Crane Jib Walkway'
      },
      {
        position: new THREE.Vector3(-33.0, 16.5, 0.0),
        allowedTypes: ['sniper'],
        floorName: 'Skybridge Far Perch'
      },
      {
        position: new THREE.Vector3(-6.0, 15.5, -12.4),
        allowedTypes: ['sniper'],
        floorName: 'Scaffolding High Beam'
      },
      {
        position: new THREE.Vector3(6.0, 15.5, -12.4),
        allowedTypes: ['sniper'],
        floorName: 'Scaffolding East Beam'
      },
      {
        position: new THREE.Vector3(60.0, 66.0, 10.0),
        allowedTypes: ['sniper'],
        floorName: 'Glass Slab Roof'
      },
      {
        position: new THREE.Vector3(-4.0, 88.0, 64.0),
        allowedTypes: ['sniper'],
        floorName: 'Deco Crown Roof'
      },
      {
        position: new THREE.Vector3(57.5, 24.0, -48.0),
        allowedTypes: ['sniper'],
        floorName: 'Copper Terrace Ring'
      },
      {
        position: new THREE.Vector3(-54.0, 28.8, 48.0),
        allowedTypes: ['sniper'],
        floorName: 'Theater Fly Cap'
      }
    );

    // Drone Aerial Airspace Spawn Rings
    this.spawnNodes.push(
      {
        position: new THREE.Vector3(-22.0, 16.0, 16.0),
        allowedTypes: ['drone'],
        floorName: 'West Airspace'
      },
      {
        position: new THREE.Vector3(20.0, 24.0, -18.0),
        allowedTypes: ['drone'],
        floorName: 'East Airspace'
      },
      {
        position: new THREE.Vector3(-20.0, 28.0, -16.0),
        allowedTypes: ['drone'],
        floorName: 'Northwest Airspace'
      },
      {
        position: new THREE.Vector3(18.0, 35.0, 18.0),
        allowedTypes: ['drone'],
        floorName: 'Southeast High Airspace'
      },
      {
        position: new THREE.Vector3(0.0, 42.0, -22.0),
        allowedTypes: ['drone'],
        floorName: 'Crane Apex Airspace'
      }
    );
  }

  /**
   * Wave composition for a given wave number (pure, shared by spawn + preview)
   */
  public compositionFor(wave: number): { thugs: number; snipers: number; drones: number } {
    // Wave composition requirements:
    // Wave 1: 5 thugs
    // Wave 2: 7 thugs + 2 drones
    // Wave 3: 8 thugs + 2 snipers + 3 drones
    // Wave N+: Escalating difficulty
    if (wave === 1) {
      return { thugs: 5, snipers: 0, drones: 0 };
    } else if (wave === 2) {
      return { thugs: 7, snipers: 0, drones: 2 };
    } else if (wave === 3) {
      return { thugs: 8, snipers: 2, drones: 3 };
    }
    // Endless escalating waves
    return {
      thugs: 8 + (wave - 3) * 2,
      snipers: Math.min(2 + Math.floor((wave - 3) / 2), 5),
      drones: 3 + (wave - 3),
    };
  }

  /** Preview of the next wave without spawning (HUD wave-preview row). */
  public peekNextWave(): { thugs: number; snipers: number; drones: number } {
    return this.compositionFor(this.currentWave + 1);
  }

  /**
   * Starts wave progression or advances to next wave.
   * Modifiers and progressive speed scaling applied from inspiration.
   * Mercy rule: low-HP players (below 30) face one fewer thug (min 1).
   */
  public startNextWave(playerHP?: number): void {
    this.currentWave++;
    this.waveInProgress = true;
    this.intermissionTimer = 0;

    // Wave speed and damage scaling (inspired by inspiration's enemies.mods)
    const waveSpeedScale = 1.0 + Math.min(0.35, (this.currentWave - 1) * 0.07);
    if (this.currentWave === 1) {
      this.activeModifier = WAVE_MODIFIERS[0];
      this.mods.speed = 1.0;
      this.mods.damage = 1.0;
    } else {
      const allowed = this.currentWave < 3 ? 2 : WAVE_MODIFIERS.length;
      const mod = WAVE_MODIFIERS[Math.floor(Math.random() * allowed)];
      this.activeModifier = mod;
      this.mods.speed = mod.speed * waveSpeedScale;
      this.mods.damage = mod.damage;
    }

    const comp = this.compositionFor(this.currentWave);
    let thugsToSpawn = comp.thugs;
    const snipersToSpawn = comp.snipers;
    const dronesToSpawn = comp.drones;

    if (playerHP !== undefined && playerHP < 30 && thugsToSpawn > 1) {
      thugsToSpawn -= 1;
    }

    this.spawnWave(thugsToSpawn, snipersToSpawn, dronesToSpawn);

    // Audio fanfare
    soundManager.playWaveStart(this.currentWave);

    if (this.onWaveStart) {
      this.onWaveStart(this.currentWave, this.totalEnemiesInWave);
    }
  }

  /**
   * Spawns requested counts of each enemy type at valid nodes.
   * Staggered trickle with a 12-alive cap: reinforcements, not a mob.
   */
  private spawnQueue: Array<() => void> = [];
  private spawnTick: number = 0;
  private readonly maxAlive: number = 12;
  private readonly maxProjectiles: number = 60;

  private spawnWave(thugs: number, snipers: number, drones: number): void {
    const thugNodes = this.spawnNodes.filter((n) => n.allowedTypes.includes('thug'));
    const sniperNodes = this.spawnNodes.filter((n) => n.allowedTypes.includes('sniper'));
    const droneNodes = this.spawnNodes.filter((n) => n.allowedTypes.includes('drone'));

    this.spawnQueue.length = 0;
    this.spawnTick = 0.2;

    const thugJobs: Array<() => void> = [];
    const sniperJobs: Array<() => void> = [];
    const droneJobs: Array<() => void> = [];

    // 1. Queue Thugs
    for (let i = 0; i < thugs; i++) {
      const node = thugNodes[i % thugNodes.length];
      thugJobs.push(() => {
        const spawnPos = node.position.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 2.0, 0, (Math.random() - 0.5) * 2.0)
        );
        this.addEnemy(new ThugEnemy(spawnPos, node.waypoints));
      });
    }

    // 2. Queue Snipers
    for (let i = 0; i < snipers; i++) {
      const node = sniperNodes[i % sniperNodes.length];
      sniperJobs.push(() => {
        this.addEnemy(new SniperEnemy(node.position.clone()));
      });
    }

    // 3. Queue Drones
    for (let i = 0; i < drones; i++) {
      const node = droneNodes[i % droneNodes.length];
      droneJobs.push(() => {
        const spawnPos = node.position.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 4.0, (Math.random() - 0.5) * 3.0, (Math.random() - 0.5) * 4.0)
        );
        this.addEnemy(new DroneEnemy(spawnPos));
      });
    }

    // Interleave round-robin so the entrance is mixed, not thugs-then-all
    while (thugJobs.length > 0 || sniperJobs.length > 0 || droneJobs.length > 0) {
      const t = thugJobs.shift();
      if (t) this.spawnQueue.push(t);
      const s = sniperJobs.shift();
      if (s) this.spawnQueue.push(s);
      const d = droneJobs.shift();
      if (d) this.spawnQueue.push(d);
    }

    this.totalEnemiesInWave = thugs + snipers + drones;
    this.enemiesLeft = this.totalEnemiesInWave;
  }

  /** Trickles queued spawns respecting the alive cap. Called each frame. */
  private pumpSpawnQueue(dt: number): void {
    if (this.spawnQueue.length === 0) return;
    this.spawnTick -= dt;
    const waveDelay = Math.max(0.3, 0.5 - (this.currentWave - 1) * 0.04);
    while (this.spawnQueue.length > 0 && this.spawnTick <= 0) {
      if (this.enemies.length >= this.maxAlive) {
        this.spawnTick = waveDelay;
        return;
      }
      const fn = this.spawnQueue.shift()!;
      fn();
      this.spawnTick += waveDelay;
    }
  }

  private addEnemy(enemy: Enemy): void {
    enemy.slotAngle = (EnemyManager.slotCounter++) * 2.39996;
    enemy.speedMultiplier = this.mods.speed;
    enemy.damageMultiplier = this.mods.damage;
    enemy.bindCollider(this.worldCollider);
    this.snapSpawnToWorld(enemy);
    this.enemies.push(enemy);
    this.scene.add(enemy.group);
    this.particles.spawnSketchIn(enemy.group.position);
    soundManager.playSpawnIn();
  }

  private snapSpawnToWorld(enemy: Enemy): void {
    if (!this.worldCollider) return;
    const p = enemy.group.position;
    if (enemy.type === 'drone') {
      this.worldCollider.pushOut(p.x, p.z, 1.4, p.y - 1.0, p.y + 1.0, this.wallScratch);
      if (this.wallScratch.pushed) {
        p.x = this.wallScratch.x;
        p.z = this.wallScratch.z;
      }
      const ground = this.worldCollider.groundAt(p.x, p.y, p.z, 50);
      if (ground !== null && p.y < ground + 1.5) p.y = ground + 1.5;
      return;
    }
    this.worldCollider.pushOut(p.x, p.z, 0.55, p.y, p.y + 1.8, this.wallScratch);
    if (this.wallScratch.pushed) {
      p.x = this.wallScratch.x;
      p.z = this.wallScratch.z;
    }
    const ground = this.worldCollider.groundAt(p.x, p.y + 0.5, p.z, 3.0);
    if (ground !== null) p.y = ground;
  }

  /**
   * Returns all collidable meshes from living enemies for raycasting
   */
  public getRaycastTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const e of this.enemies) {
      if (!e.isDead) {
        targets.push(...e.collidableMeshes);
      }
    }
    return targets;
  }

  /**
   * Checks player gunshot hit against all enemies with headshot detection,
   * stagger application, combo scoring, and kill reporting
   */
  public checkBulletHits(
    fireResult: FireResult,
    isSwinging: boolean = false,
    playerPos?: THREE.Vector3
  ): HitReport | null {
    if (!fireResult.hit || !fireResult.target) {
      return null;
    }

    // Identify target enemy by ascending mesh hierarchy or userData
    let hitObject: THREE.Object3D | null = fireResult.target;
    let targetEnemy: Enemy | null = null;
    let isHeadshotHit = false;

    while (hitObject) {
      if (hitObject.userData && hitObject.userData.isHead) {
        isHeadshotHit = true;
      }
      if (hitObject.userData && hitObject.userData.enemy instanceof Enemy) {
        targetEnemy = hitObject.userData.enemy;
        break;
      }
      hitObject = hitObject.parent;
    }

    // Fallback: check all enemies if hit mesh is in collidableMeshes
    if (!targetEnemy) {
      for (const e of this.enemies) {
        if (e.collidableMeshes.includes(fireResult.target)) {
          targetEnemy = e;
          if (fireResult.target === e.headMesh || fireResult.target.userData?.isHead) {
            isHeadshotHit = true;
          }
          break;
        }
      }
    }

    if (!targetEnemy || targetEnemy.isDead) {
      return null;
    }

    // Merge headshot flag from weapon calculation
    const finalHeadshot = isHeadshotHit || fireResult.isHeadshot;

    // Apply damage to enemy
    const hitPoint = fireResult.point || targetEnemy.group.position.clone();
    const hitDir = fireResult.ray.direction;
    const damageResult = targetEnemy.takeDamage(fireResult.damage, finalHeadshot, hitPoint, hitDir);

    // Spawn directional red ink blood splatter
    const bloodAmt = Math.max(0.6, Math.min(2.5, fireResult.damage / 45.0)) * (finalHeadshot ? 1.6 : 1.0);
    this.particles.spawnBlood(hitPoint, hitDir, bloodAmt, finalHeadshot);

    let killEvent: KillEvent | undefined;

    if (damageResult.killed) {
      // Enemy disintegrates into ink drops, paper scraps, directional blood burst, blood pool, and fountain
      targetEnemy.disintegrate(this.particles, hitDir, finalHeadshot);

      // Kill streak tracking
      this.totalKills++;
      this.killStreak++;
      this.streakTimer = this.streakExpiry;

      // Distance calculation
      const dist = playerPos ? playerPos.distanceTo(targetEnemy.group.position) : fireResult.distance || 10;

      // Score and XP computation with stylish comic combo bonuses
      let score = targetEnemy.scoreValue;
      let xp = targetEnemy.xpValue;

      // Headshot bonus (+150 score)
      if (finalHeadshot) {
        score += 150;
        xp += 20;
      }

      // Aerial swing kill bonus (+250 score - "Air Assassin!")
      if (isSwinging) {
        score += 250;
        xp += 35;
      }

      // Longshot sniper/distance bonus (+150 score)
      if (dist > 32.0) {
        score += 150;
        xp += 20;
      }

      // Combo multiplier: scales up to 3.0x on kill streaks
      const comboMult = 1.0 + Math.min(this.killStreak * 0.25, 2.5);
      score = Math.round(score * comboMult);
      this.totalScore += score;

      killEvent = {
        enemyId: targetEnemy.id,
        enemyType: targetEnemy.type,
        position: targetEnemy.group.position.clone(),
        isHeadshot: finalHeadshot,
        isSwinging,
        distance: dist,
        scoreAwarded: score,
        xpAwarded: xp,
        comboMultiplier: comboMult,
        wave: this.currentWave,
        killStreak: this.killStreak
      };

      // Decrement remaining enemy count
      this.enemiesLeft = Math.max(0, this.enemiesLeft - 1);

      if (this.onKill) {
        this.onKill(killEvent);
      }

      // Check wave completion
      if (this.enemiesLeft === 0 && this.waveInProgress) {
        this.completeWave();
      }
    }

    return {
      enemy: targetEnemy,
      damageDealt: damageResult.damageTaken,
      isHeadshot: finalHeadshot,
      killed: damageResult.killed,
      killEvent
    };
  }

  /**
   * Handles wave completion and starts intermission countdown
   */
  private completeWave(): void {
    this.waveInProgress = false;
    this.intermissionTimer = this.intermissionDuration;

    if (this.onWaveComplete) {
      this.onWaveComplete(this.currentWave);
    }
  }

  /**
   * Spawns a projectile into the simulation
   */
  public spawnProjectile(req: ProjectileSpawnRequest): void {
    if (this.projectiles.length >= this.maxProjectiles) return;
    const isSniper = req.isSniper || false;
    const geom = isSniper ? this.sniperGeometry : this.bulletGeometry;
    const mat = isSniper ? this.sniperBulletMaterial : this.bulletMaterial;

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(req.origin);
    mesh.lookAt(req.origin.clone().add(req.direction));
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    this.projectileGroup.add(mesh);

    this.projectiles.push({
      id: Math.random().toString(36).substring(2, 9),
      position: req.origin.clone(),
      velocity: req.direction.clone().multiplyScalar(req.speed),
      damage: req.damage,
      radius: req.radius,
      traveled: 0,
      maxDistance: req.maxDistance,
      mesh,
      isSniper,
      kind: req.kind ?? (isSniper ? 'sniper' : 'thug'),
    });
  }

  /**
   * Main per-frame update loop
   */
  public update(
    dt: number,
    player: Player,
    camera: THREE.PerspectiveCamera
  ): void {
    // 1. Combo streak timer decay
    if (this.streakTimer > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) {
        this.killStreak = 0;
      }
    }

    // 2. Wave intermission timer
    if (!this.waveInProgress && this.intermissionTimer > 0) {
      this.intermissionTimer -= dt;
      if (this.intermissionTimer <= 0) {
        this.startNextWave(player.health);
      }
    }

    // 2b. Trickle queued spawns (staggered entrance, alive cap)
    this.pumpSpawnQueue(dt);

    // 3. Update all living enemies
    const playerPos = player.position;
    const playerSpeed = player.velocity ? player.velocity.length() : 0;
    // Chest aim height for this frame. Crouched it drops below rail height, so
    // every shooter's line-of-sight check finds the railing and holds fire.
    const aimY = chestY(
      playerPos.y,
      player.physics ? player.physics.playerHeight : CHARACTER_HEIGHT
    );
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];

      if (enemy.isDead) {
        this.enemies.splice(i, 1);
        if (enemy.isDying) {
          this.corpses.push(enemy);
        } else {
          this.scene.remove(enemy.group);
          enemy.dispose();
        }
        continue;
      }

      enemy.waveNumber = this.currentWave;
      enemy.speedMultiplier = this.mods.speed;
      enemy.damageMultiplier = this.mods.damage;
      if (enemy.worldCollider !== this.worldCollider) enemy.bindCollider(this.worldCollider);
      enemy.aimTargetY = aimY;
      if (this.waveInProgress && !enemy.alerted && !enemy.isDead) {
        enemy.alert(playerPos);
      }
      enemy.update(dt, playerPos, camera, this.collidableMeshes, playerSpeed);

      // Collect pending projectiles from this enemy
      while (enemy.pendingProjectiles.length > 0) {
        const req = enemy.pendingProjectiles.shift()!;
        this.spawnProjectile(req);
      }
    }

    // 3b. Update active corpses falling and resting on ground (x seconds before disappearing)
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const corpse = this.corpses[i];
      if (corpse.worldCollider !== this.worldCollider) corpse.bindCollider(this.worldCollider);
      corpse.aimTargetY = aimY;
      corpse.update(dt, playerPos, camera, this.collidableMeshes, playerSpeed);
      if (!corpse.isDying) {
        this.scene.remove(corpse.group);
        corpse.dispose();
        this.corpses.splice(i, 1);
      }
    }

    // 3b. Separation: same-floor enemies never stack into one blob.
    // Snipers are anchored perches — everyone else walks around them.
    this.separateEnemies();

    // 4. Update and resolve enemy projectiles
    this.updateProjectiles(dt, player, camera);
  }

  private separateEnemies(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.isDead) continue;
      const pa = a.group.position;
      const aAnchored = a.type === 'sniper';
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.isDead) continue;
        const pb = b.group.position;
        // Drones live in a different air band: wider Y gate + wider ring.
        const yGate = a.type === 'drone' || b.type === 'drone' ? 3.0 : 2.0;
        if (Math.abs(pa.y - pb.y) > yGate) continue;
        const minD = a.type === 'drone' || b.type === 'drone' ? 3.2 : 1.4;
        let dx = pb.x - pa.x;
        let dz = pb.z - pa.z;
        // Thugs trail instead of stacking: follower hangs back along its heading.
        // (Heading bias applied by callers via position; here keep pure radial push.)
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (minD - d) / d;
          dx *= push;
          dz *= push;
        } else {
          // Deterministic declump: split along the line to the player side
          // is handled by movement; here just separate on +X deterministically.
          dx = minD;
          dz = 0;
        }
        const bAnchored = b.type === 'sniper';
        if (!aAnchored && !bAnchored) {
          pa.x -= dx * 0.5;
          pa.z -= dz * 0.5;
          pb.x += dx * 0.5;
          pb.z += dz * 0.5;
        } else if (aAnchored && !bAnchored) {
          pb.x += dx;
          pb.z += dz;
        } else if (!aAnchored && bAnchored) {
          pa.x -= dx;
          pa.z -= dz;
        }
      }
    }
    // Separation must never shove anyone inside a wall: re-resolve shells.
    if (this.worldCollider) {
      for (const e of list) {
        if (e.isDead || e.type === 'drone') continue;
        const p = e.group.position;
        this.worldCollider.pushOut(p.x, p.z, 0.55, p.y, p.y + 1.8, this.wallScratch);
        if (this.wallScratch.pushed) {
          p.x = this.wallScratch.x;
          p.z = this.wallScratch.z;
        }
      }
    }
  }

  private tmpFwd: THREE.Vector3 = new THREE.Vector3();
  private tmpRight: THREE.Vector3 = new THREE.Vector3();
  private tmpDir: THREE.Vector3 = new THREE.Vector3();
  private static readonly UP: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  /**
   * Advances projectiles, checks player hitboxes, and handles architecture collisions
   */
  private updateProjectiles(dt: number, player: Player, camera?: THREE.PerspectiveCamera): void {
    const playerPos = player.position;
    const playerRadius = 0.65;
    // Dynamic hitbox: crouching (0.9m) genuinely ducks under chest-aimed fire.
    // playerPos is the body CENTER. The crouched band deliberately gets NO head
    // margin so it tops out at rail height and a railing eats the bullet first.
    const pHeight = player.physics ? player.physics.playerHeight : CHARACTER_HEIGHT;
    const playerMinY = hitbandMinY(playerPos.y, pHeight);
    const playerMaxY = hitbandMaxY(playerPos.y, pHeight);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      this.tmpPrev.copy(proj.position);
      this.tmpStep.copy(proj.velocity).multiplyScalar(dt);
      const stepLength = this.tmpStep.length();

      proj.position.add(this.tmpStep);
      proj.traveled += stepLength;
      proj.mesh.position.copy(proj.position);

      // Check max distance expiry
      if (proj.traveled >= proj.maxDistance) {
        this.removeProjectile(i);
        continue;
      }

      // 1. Check collision against architecture first (WorldCollider primary, collidableMeshes fallback)
      let wallHitDist = Infinity;
      let wallHitPoint: THREE.Vector3 | null = null;
      let wallHitNormal: THREE.Vector3 | null = null;

      if (stepLength > 0.001) {
        this.tmpStepNorm.copy(this.tmpStep).multiplyScalar(1.0 / stepLength);

        if (this.worldCollider) {
          const hit = this.worldCollider.raycast(this.tmpPrev, this.tmpStepNorm, stepLength);
          if (hit) {
            wallHitDist = hit.dist;
            wallHitPoint = hit.point;
            wallHitNormal = hit.normal;
          }
        } else if (this.collidableMeshes.length > 0) {
          this.projectileRaycaster.set(this.tmpPrev, this.tmpStepNorm);
          this.projectileRaycaster.far = stepLength;

          this.nearMeshes.length = 0;
          for (let m = 0; m < this.collidableMeshes.length; m++) {
            const mesh = this.collidableMeshes[m];
            mesh.getWorldPosition(this.tmpMeshPos);
            const mx = this.tmpMeshPos.x - proj.position.x;
            const mz = this.tmpMeshPos.z - proj.position.z;
            if (mx * mx + mz * mz > 900) continue;
            if (Math.abs(this.tmpMeshPos.y - proj.position.y) > 60) continue;
            this.nearMeshes.push(mesh);
          }
          if (this.nearMeshes.length > 0) {
            const hits = this.projectileRaycaster.intersectObjects(this.nearMeshes, false);
            if (hits.length > 0) {
              const hit = hits[0];
              wallHitDist = hit.distance;
              wallHitPoint = hit.point;
              wallHitNormal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : EnemyManager.UP;
            }
          }
        }
      }

      // 2. Check segment against player (if alive)
      const hitDist = !player.isDead
        ? segmentPlayerHitDistance(
            this.tmpPrev, proj.position, proj.radius + playerRadius,
            playerPos, playerMinY, playerMaxY
          )
        : null;

      // 3. Resolve: if player was hit before the wall along the segment, damage player;
      // otherwise, if a wall was hit, the wall stops the bullet completely.
      if (hitDist !== null && hitDist < wallHitDist) {
        const wasAlive = !player.isDead;
        player.takeDamage(proj.damage, proj.position);
        if (this.onPlayerDamaged) this.onPlayerDamaged(proj.position);
        if (wasAlive && player.isDead) {
          this.lastPlayerDeath = this.describeKiller(proj, player, camera);
        }
        this.removeProjectile(i);
        continue;
      } else if (wallHitPoint && wallHitNormal) {
        this.particles.spawnWallImpact(wallHitPoint, wallHitNormal);
        soundManager.playImpactWall();
        this.removeProjectile(i);
        continue;
      }

      // 4. Near-miss whiz when an enemy projectile passes <2m without hitting
      if (!player.isDead) {
        const dx = proj.position.x - playerPos.x;
        const dz = proj.position.z - playerPos.z;
        const horizDist = Math.hypot(dx, dz);
        if (!proj.nearMissTriggered && horizDist < 2.0 && proj.position.y >= (playerMinY - 0.8) && proj.position.y <= (playerMaxY + 0.8)) {
          proj.nearMissTriggered = true;
          soundManager.playNearMissWhiz();
        }
      }
    }
  }

  /**
   * One-line killer recap for the death screen, e.g. "SNIPER · 42m · BEHIND".
   */
  private describeKiller(proj: EnemyProjectile, player: Player, camera?: THREE.PerspectiveCamera): string {
    const dist = Math.round(proj.position.distanceTo(player.position));
    let where = 'AHEAD';
    if (camera) {
      this.tmpDir.copy(proj.position).sub(player.position);
      this.tmpDir.y = 0;
      if (this.tmpDir.lengthSq() > 0.01) {
        this.tmpDir.normalize();
        this.tmpFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
        this.tmpFwd.y = 0;
        this.tmpFwd.normalize();
        this.tmpRight.crossVectors(this.tmpFwd, EnemyManager.UP).normalize();
        const f = this.tmpDir.dot(this.tmpFwd);
        const r = this.tmpDir.dot(this.tmpRight);
        const ang = Math.atan2(r, f) * (180 / Math.PI);
        const a = Math.abs(ang);
        if (a > 135) where = 'BEHIND';
        else if (a > 45) where = ang > 0 ? 'RIGHT' : 'LEFT';
      }
    }
    return `${proj.kind.toUpperCase()} · ${dist}m · ${where}`;
  }

  private removeProjectile(index: number): void {
    const proj = this.projectiles[index];
    this.projectileGroup.remove(proj.mesh);
    this.projectiles.splice(index, 1);
  }

  /**
   * Resets all enemies and waves
   */
  public clear(): void {
    DroneEnemy.resetConcurrency();
    SniperEnemy.resetStaticState();
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.group);
      enemy.dispose();
    }
    this.enemies = [];

    for (const corpse of this.corpses) {
      this.scene.remove(corpse.group);
      corpse.dispose();
    }
    this.corpses = [];

    for (const proj of this.projectiles) {
      this.projectileGroup.remove(proj.mesh);
    }
    this.projectiles = [];

    this.currentWave = 0;
    this.enemiesLeft = 0;
    this.totalEnemiesInWave = 0;
    this.waveInProgress = false;
    this.intermissionTimer = 0;
    this.spawnQueue.length = 0;
    this.spawnTick = 0;
    this.totalScore = 0;
    this.totalKills = 0;
    this.killStreak = 0;
    this.lastPlayerDeath = null;
    this.mods = { speed: 1.0, damage: 1.0 };
    this.activeModifier = WAVE_MODIFIERS[0];
  }

  public dispose(): void {
    this.clear();
    this.scene.remove(this.projectileGroup);
    this.bulletGeometry.dispose();
    this.sniperGeometry.dispose();
    this.bulletMaterial.dispose();
    this.sniperBulletMaterial.dispose();
  }
}

import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { soundManager } from '../core/SoundManager';
import { InkParticles } from '../effects/InkParticles';
import type { WorldCollider } from '../world/WorldCollider';

export enum EnemyState {
  IDLE = 'IDLE',
  CHASE = 'CHASE',
  ATTACK = 'ATTACK',
  STAGGER = 'STAGGER',
  DEAD = 'DEAD'
}

export type EnemyType = 'thug' | 'sniper' | 'drone';

export interface DamageResult {
  damageTaken: number;
  killed: boolean;
  isHeadshot: boolean;
  remainingHealth: number;
}

export interface PlayerCombatTarget {
  position: THREE.Vector3;
  takeDamage?: (damage: number) => void;
  isSwinging?: boolean;
  velocity?: THREE.Vector3;
}

export interface ProjectileSpawnRequest {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  damage: number;
  radius: number;
  maxDistance: number;
  isSniper?: boolean;
  kind?: EnemyType;
}

/**
 * Base abstract class for all hand-drawn sketch enemies.
 * Features:
 * - Finite State Machine (IDLE, CHASE, ATTACK, STAGGER, DEAD)
 * - InkShaderMaterial with isEnemy: true, red ink accents (vec3(0.85, 0.2, 0.2)), and blue edge lines
 * - Head/weakpoint mesh flagged with userData: { isHead: true, enemy: this }
 * - Floating red exclamation mark (!) when alerted with bouncy billboard animation
 * - Hand-drawn notebook paper health bar that tracks damage
 * - Damage reception with red ink flash, stagger knockback, and hit marker audio
 * - Ink droplet & paper scrap disintegration on defeat
 */
export abstract class Enemy {
  public readonly id: string;
  public readonly type: EnemyType;
  public group: THREE.Group;

  public get position(): THREE.Vector3 {
    return this.group.position;
  }

  public get rotation(): THREE.Euler {
    return this.group.rotation;
  }

  public state: EnemyState = EnemyState.IDLE;
  public health: number;
  public maxHealth: number;
  public isDead: boolean = false;
  public isDying: boolean = false;
  public alerted: boolean = false;

  // Corpse persistence and physical falling (x seconds before disappearing)
  public static defaultCorpseLifetime: number = 4.0;
  public corpseLifetime: number = Enemy.defaultCorpseLifetime;
  public deathTimer: number = 0;
  public fallVelocity: THREE.Vector3 = new THREE.Vector3();
  public toppleAxis: 'x' | 'z' = 'x';
  public toppleSign: number = 1;
  public toppleProgress: number = 0;
  public onGroundCorpse: boolean = false;
  protected cachedParticles: InkParticles | null = null;
  protected bloodSpawnedOnFloor: boolean = false;

  public scoreValue: number = 100;
  public xpValue: number = 25;

  // Collision and weakpoint meshes
  public collidableMeshes: THREE.Mesh[] = [];
  public headMesh: THREE.Mesh | null = null;

  // Materials list for line-boil time updates and red hit flashes
  protected materials: THREE.ShaderMaterial[] = [];
  protected primaryEnemyMat!: THREE.ShaderMaterial;
  protected accentRedMat!: THREE.ShaderMaterial;

  // Visual indicators
  protected alertGroup: THREE.Group = new THREE.Group();
  protected alertScale: number = 0;
  protected alertTimer: number = 0;

  protected healthBarGroup: THREE.Group = new THREE.Group();
  protected healthBarFill!: THREE.Mesh;
  protected healthBarBg!: THREE.Mesh;
  protected healthBarVisibleTimer: number = 0;

  // Timers and physics
  protected hitFlashTimer: number = 0;
  protected staggerTimer: number = 0;
  protected staggerVelocity: THREE.Vector3 = new THREE.Vector3();
  protected elapsed: number = 0;
  protected eyeHeight: number = 1.7;

  // Billboard scratch objects (reused — no per-frame allocation)
  private tmpQuatA: THREE.Quaternion = new THREE.Quaternion();
  private tmpQuatB: THREE.Quaternion = new THREE.Quaternion();
  private tmpLook: THREE.Vector3 = new THREE.Vector3();

  // Projectile queue fired by this enemy
  public pendingProjectiles: ProjectileSpawnRequest[] = [];

  // Current wave number (set by EnemyManager each frame, used for behavior gates)
  public waveNumber: number = 1;

  // Wave speed and damage modifiers (set by EnemyManager from inspiration wave system)
  public speedMultiplier: number = 1.0;
  public damageMultiplier: number = 1.0;

  // Current player speed (for speed-scaled bullet spread like inspiration)
  public playerSpeed: number = 0;

  // Golden ratio slot angle around player (fanning out and encirclement)
  public slotAngle: number = 0;

  // Spawn grace: no attacking for 1.5s after sketch-in (fairness)
  public spawnGrace: number = 1.5;

  // Simplified collision shells (same source of truth as the player).
  // When null (tests, headless), enemies fall back to legacy free movement.
  public worldCollider: WorldCollider | null = null;
  protected pushScratch: { x: number; z: number; nx: number; nz: number; pushed: boolean } = {
    x: 0, z: 0, nx: 0, nz: 0, pushed: false,
  };

  constructor(type: EnemyType, maxHealth: number, position: THREE.Vector3) {
    this.id = `${type}_${Math.random().toString(36).substring(2, 9)}`;
    this.type = type;
    this.maxHealth = maxHealth;
    this.health = maxHealth;

    this.group = new THREE.Group();
    this.group.name = `Enemy_${this.id}`;
    this.group.position.copy(position);

    this.initSharedMaterials();
    this.createAlertIcon();
    this.createHealthBar();
  }

  public bindCollider(c: WorldCollider | null): void {
    this.worldCollider = c;
  }

  protected resolveWalls(radius: number, minY: number, maxY: number): boolean {
    if (!this.worldCollider) return false;
    const p = this.group.position;
    this.worldCollider.pushOut(p.x, p.z, radius, minY, maxY, this.pushScratch);
    if (this.pushScratch.pushed) {
      p.x = this.pushScratch.x;
      p.z = this.pushScratch.z;
      return true;
    }
    return false;
  }

  protected groundUnderFeet(feetY: number, maxStepUp: number = 0.6): number | null {
    if (!this.worldCollider) return null;
    const p = this.group.position;
    return this.worldCollider.groundAt(p.x, feetY, p.z, maxStepUp);
  }

  /**
   * Initializes standard ink shader materials for this enemy instance
   */
  protected initSharedMaterials(): void {
    // Body material: Rich crimson sketch ink
    this.primaryEnemyMat = InkShaderMaterial.create({
      isEnemy: true,
      inkColor: new THREE.Color(0.85, 0.12, 0.18),
      accentColor: new THREE.Color(0.95, 0.15, 0.18)
    });

    // Accent material: Brilliant scarlet red sketch ink for head, weakpoints, armor, and alerts
    this.accentRedMat = InkShaderMaterial.create({
      isAccent: true,
      isEnemy: true,
      inkColor: new THREE.Color(0.85, 0.12, 0.18),
      accentColor: new THREE.Color(1.0, 0.15, 0.15)
    });

    this.materials.push(this.primaryEnemyMat, this.accentRedMat);
  }

  /**
   * Helper to create a styled sketch mesh with ballpoint red ink edge lines
   */
  protected createMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    isHead: boolean = false,
    collidable: boolean = true
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData = {
      enemy: this,
      isHead
    };

    // Crimson red ink edge outline for hostiles
    const edges = InkShaderMaterial.createEdgeLines(
      geometry,
      new THREE.Color(0xb71520)
    );
    edges.raycast = () => {}; // Do not intercept rays on edge lines
    mesh.add(edges);

    if (collidable) {
      this.collidableMeshes.push(mesh);
    }
    if (isHead) {
      this.headMesh = mesh;
    }

    return mesh;
  }

  /**
   * Builds the hand-drawn floating exclamation mark (!)
   */
  private createAlertIcon(): void {
    this.alertGroup = new THREE.Group();
    this.alertGroup.name = 'AlertIcon';

    // Top vertical stroke
    const stickGeom = new THREE.CylinderGeometry(0.04, 0.07, 0.32, 6);
    const stickMesh = new THREE.Mesh(stickGeom, this.accentRedMat);
    stickMesh.position.set(0, 0.22, 0);
    stickMesh.userData = { isDecor: true };
    const stickEdges = InkShaderMaterial.createEdgeLines(stickGeom, InkShaderMaterial.defaultInkColor);
    stickEdges.raycast = () => {};
    stickMesh.add(stickEdges);
    this.alertGroup.add(stickMesh);

    // Bottom period dot
    const dotGeom = new THREE.SphereGeometry(0.05, 6, 6);
    const dotMesh = new THREE.Mesh(dotGeom, this.accentRedMat);
    dotMesh.position.set(0, 0.02, 0);
    dotMesh.userData = { isDecor: true };
    const dotEdges = InkShaderMaterial.createEdgeLines(dotGeom, InkShaderMaterial.defaultInkColor);
    dotEdges.raycast = () => {};
    dotMesh.add(dotEdges);
    this.alertGroup.add(dotMesh);

    this.alertGroup.position.set(0, this.eyeHeight + 0.45, 0);
    this.alertGroup.scale.set(0, 0, 0);
    this.alertGroup.visible = false;
    this.group.add(this.alertGroup);
  }

  /**
   * Builds the floating notebook paper health bar
   */
  private createHealthBar(): void {
    this.healthBarGroup = new THREE.Group();
    this.healthBarGroup.name = 'HealthBar';
    this.healthBarGroup.position.set(0, this.eyeHeight + 0.22, 0);

    const barWidth = 0.8;
    const barHeight = 0.09;
    const barDepth = 0.02;

    // Background paper slab with border
    const bgGeom = new THREE.BoxGeometry(barWidth, barHeight, barDepth);
    const bgMat = InkShaderMaterial.create({
      inkColor: new THREE.Color(0x152777)
    });
    this.materials.push(bgMat);

    this.healthBarBg = new THREE.Mesh(bgGeom, bgMat);
    const bgEdges = InkShaderMaterial.createEdgeLines(bgGeom, InkShaderMaterial.defaultInkColor);
    bgEdges.raycast = () => {};
    this.healthBarBg.add(bgEdges);
    this.healthBarGroup.add(this.healthBarBg);

    // Red ink health fill bar
    const fillGeom = new THREE.BoxGeometry(barWidth * 0.95, barHeight * 0.7, barDepth * 1.2);
    // Shift pivot to left edge
    fillGeom.translate(barWidth * 0.475, 0, 0);

    this.healthBarFill = new THREE.Mesh(fillGeom, this.accentRedMat);
    this.healthBarFill.position.set(-barWidth * 0.475, 0, 0.01);
    this.healthBarGroup.add(this.healthBarFill);

    this.healthBarGroup.visible = false;
    this.group.add(this.healthBarGroup);
  }

  /**
   * Flashes the floating health bar (aim hover feedback, damage calls this too).
   */
  public pingHealthBar(): void {
    if (this.isDead) return;
    this.healthBarVisibleTimer = Math.max(this.healthBarVisibleTimer, 2.5);
    this.healthBarGroup.visible = true;
  }

  /**
   * Alerts the enemy to the player's presence
   */
  public alert(playerPos?: THREE.Vector3): void {
    if (this.isDead) return;

    if (!this.alerted) {
      this.alerted = true;
      this.alertTimer = 1.6;
      this.alertScale = 0.01;
      this.alertGroup.visible = true;
      this.healthBarVisibleTimer = 4.0;
      this.healthBarGroup.visible = true;
      const dist = playerPos ? this.group.position.distanceTo(playerPos) : undefined;
      soundManager.playAggro(dist);

      if (this.state === EnemyState.IDLE) {
        this.state = EnemyState.CHASE;
      }
    }

    if (playerPos) {
      this.tmpLook.copy(playerPos);
      this.tmpLook.y = this.group.position.y;
      this.group.lookAt(this.tmpLook);
    }
  }

  /**
   * Applies damage to this enemy with stagger and headshot detection
   */
  public takeDamage(
    amount: number,
    isHeadshot: boolean,
    hitPoint?: THREE.Vector3,
    hitDirection?: THREE.Vector3
  ): DamageResult {
    if (this.isDead) {
      return { damageTaken: 0, killed: false, isHeadshot: false, remainingHealth: 0 };
    }

    const actualDamage = Math.min(this.health, amount);
    this.health -= actualDamage;

    // Visual hit reaction: flash red ink
    this.hitFlashTimer = 0.15;
    for (const mat of this.materials) {
      if (mat.uniforms && mat.uniforms.uAccentColor) {
        mat.uniforms.uAccentColor.value.setRGB(1.0, 0.05, 0.05);
      }
    }

    // Play hit sound
    soundManager.playHitMarker(isHeadshot);

    // Show health bar
    this.healthBarVisibleTimer = 5.0;
    this.healthBarGroup.visible = true;

    // Trigger alert immediately on damage
    if (!this.alerted) {
      this.alert();
    }

    // Check death condition
    if (this.health <= 0) {
      this.health = 0;
      this.die(hitPoint, isHeadshot, hitDirection);
      return {
        damageTaken: actualDamage,
        killed: true,
        isHeadshot,
        remainingHealth: 0
      };
    }

    // Stagger reaction
    const staggerTime = isHeadshot ? 0.45 : 0.26;
    const impulse = hitDirection
      ? hitDirection.clone().normalize().multiplyScalar(isHeadshot ? 7.0 : 4.0)
      : new THREE.Vector3(0, 0, 0);
    this.stagger(staggerTime, impulse);

    return {
      damageTaken: actualDamage,
      killed: false,
      isHeadshot,
      remainingHealth: this.health
    };
  }

  /**
   * Forces enemy into stagger state with optional physical knockback impulse
   */
  public stagger(duration: number = 0.3, impulse?: THREE.Vector3): void {
    if (this.isDead) return;

    this.state = EnemyState.STAGGER;
    this.staggerTimer = duration;

    if (impulse) {
      this.staggerVelocity.copy(impulse);
    }
  }

  /**
   * Triggers defeat and starts physical corpse collapse (x seconds before disappearing)
   */
  public die(hitPoint?: THREE.Vector3, _isHeadshot: boolean = false, hitDirection?: THREE.Vector3): void {
    if (this.isDead) return;

    this.isDead = true;
    this.isDying = true;
    this.state = EnemyState.DEAD;
    this.health = 0;
    this.deathTimer = 0;
    this.toppleProgress = 0;
    this.onGroundCorpse = false;
    this.bloodSpawnedOnFloor = false;

    // Hide UI overlays
    this.alertGroup.visible = false;
    this.healthBarGroup.visible = false;

    // Audio feedback
    soundManager.playEnemyDeath();

    // Disable raycasting against meshes so corpse does not block bullets
    for (const m of this.collidableMeshes) {
      m.raycast = () => {};
    }

    // Physical knockback impulse from killing bullet
    const kick = hitDirection ? hitDirection.clone().normalize() : new THREE.Vector3();
    if (kick.lengthSq() < 1e-4) {
      kick.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
    }
    this.fallVelocity.set(kick.x * 2.5, 2.0, kick.z * 2.5);

    // Topple orientation (inspiration: pitch or roll flat onto floor)
    if (Math.abs(kick.x) > Math.abs(kick.z)) {
      this.toppleAxis = 'z';
      this.toppleSign = kick.x > 0 ? -1 : 1;
    } else {
      this.toppleAxis = 'x';
      this.toppleSign = kick.z > 0 ? 1 : -1;
    }
  }

  /**
   * Spawns disintegration particle burst using InkParticles
   */
  public disintegrate(particles: InkParticles, hitDir?: THREE.Vector3, isHeadshot: boolean = false): void {
    this.cachedParticles = particles;
    const origin = this.group.position.clone();
    origin.y += this.eyeHeight * 0.5;
    particles.spawnEnemyDeath(origin, hitDir, isHeadshot);
  }

  /**
   * Per-frame update loop
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    camera?: THREE.Camera,
    collidables: THREE.Mesh[] = [],
    playerSpeed: number = 0
  ): void {
    if (this.isDying) {
      this.deathTimer += dt;

      // 1. Gravity and floor collision
      if (!this.onGroundCorpse) {
        this.fallVelocity.y -= 18.0 * dt;
        this.fallVelocity.x *= Math.max(0, 1.0 - 3.0 * dt);
        this.fallVelocity.z *= Math.max(0, 1.0 - 3.0 * dt);
        this.group.position.addScaledVector(this.fallVelocity, dt);

        this.resolveWalls(0.5, this.group.position.y, this.group.position.y + 1.8);

        let groundY: number | null = null;
        if (this.worldCollider) {
          groundY = this.worldCollider.groundAt(
            this.group.position.x,
            this.group.position.y + 0.6,
            this.group.position.z,
            2.5
          );
        }
        if (groundY === null) {
          groundY = Math.min(this.group.position.y, 0);
        }

        if (this.group.position.y <= groundY + 0.15 && this.fallVelocity.y <= 0) {
          this.group.position.y = groundY + 0.08;
          this.fallVelocity.set(0, 0, 0);
          this.onGroundCorpse = true;

          if (!this.bloodSpawnedOnFloor && this.cachedParticles) {
            this.bloodSpawnedOnFloor = true;
            this.cachedParticles.spawnBlood(this.group.position, new THREE.Vector3(0, 1, 0), 0.8, false);
          }
        }
      }

      // 2. Topple rotation onto floor (0.45s easeOutQuad)
      if (this.toppleProgress < 1.0) {
        this.toppleProgress = Math.min(1.0, this.toppleProgress + dt * 2.8);
        const ease = 1.0 - (1.0 - this.toppleProgress) * (1.0 - this.toppleProgress);
        const angle = this.toppleSign * (Math.PI * 0.48) * ease;
        if (this.toppleAxis === 'x') {
          this.group.rotation.x = angle;
        } else {
          this.group.rotation.z = angle;
        }
      }

      // 3. Smooth shrink / dissolve over last 0.8s of corpseLifetime
      const shrinkDuration = 0.8;
      if (this.deathTimer >= this.corpseLifetime - shrinkDuration) {
        const remaining = Math.max(0, this.corpseLifetime - this.deathTimer);
        const scaleVal = Math.max(0.001, remaining / shrinkDuration);
        this.group.scale.setScalar(scaleVal);
      }

      // 4. Disappear completely when corpseLifetime (x seconds) is reached
      if (this.deathTimer >= this.corpseLifetime) {
        this.isDying = false;
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

    if (this.isDead) return;

    this.playerSpeed = playerSpeed;
    this.elapsed += dt;
    if (this.spawnGrace > 0) this.spawnGrace -= dt;

    // 1. Update shader line-boil tremor on all materials
    for (const mat of this.materials) {
      if (mat.uniforms && mat.uniforms.uTime) {
        mat.uniforms.uTime.value = this.elapsed;
      }
    }

    // 2. Hit flash decay
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      if (this.hitFlashTimer <= 0) {
        for (const mat of this.materials) {
          if (mat.uniforms && mat.uniforms.uAccentColor) {
            mat.uniforms.uAccentColor.value.setRGB(0.86, 0.12, 0.20);
          }
        }
      }
    }

    // 3. Stagger recovery (knockback slides along walls, never through them)
    if (this.state === EnemyState.STAGGER) {
      this.staggerTimer -= dt;
      // Damp stagger velocity
      this.group.position.addScaledVector(this.staggerVelocity, dt);
      if (this.worldCollider && this.type !== 'drone') {
        const p = this.group.position;
        this.worldCollider.pushOut(p.x, p.z, 0.5, p.y, p.y + 1.7, this.pushScratch);
        if (this.pushScratch.pushed) {
          p.x = this.pushScratch.x;
          p.z = this.pushScratch.z;
          const vn = this.staggerVelocity.x * this.pushScratch.nx + this.staggerVelocity.z * this.pushScratch.nz;
          if (vn < 0) {
            this.staggerVelocity.x -= this.pushScratch.nx * vn;
            this.staggerVelocity.z -= this.pushScratch.nz * vn;
          }
        }
      }
      this.staggerVelocity.multiplyScalar(Math.max(0, 1.0 - dt * 8.0));

      if (this.staggerTimer <= 0) {
        this.staggerVelocity.set(0, 0, 0);
        this.state = this.alerted ? EnemyState.CHASE : EnemyState.IDLE;
      }
    }

    // 4. Update AI if not staggering
    if (this.state !== EnemyState.STAGGER) {
      this.updateAI(dt, playerPos, collidables);
    }

    // 5. Update Billboards (Health bar & Alert mark)
    // Counter-rotate parent world orientation so bars face the camera
    if (camera) {
      this.group.getWorldQuaternion(this.tmpQuatA);
      this.tmpQuatB.copy(this.tmpQuatA).invert().multiply(camera.quaternion);
      this.healthBarGroup.quaternion.copy(this.tmpQuatB);
      this.alertGroup.quaternion.copy(this.tmpQuatB);
    }

    // Health bar fill ratio & auto-hide
    if (this.healthBarVisibleTimer > 0) {
      this.healthBarVisibleTimer -= dt;
      const ratio = Math.max(0, Math.min(1, this.health / this.maxHealth));
      this.healthBarFill.scale.set(ratio, 1, 1);

      if (this.healthBarVisibleTimer <= 0) {
        this.healthBarGroup.visible = false;
      }
    }

    // Alert icon animation (bouncy comic pop-up)
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.alertScale = Math.min(1.0, this.alertScale + dt * 6.0);
      const bob = 1.0 + Math.sin(this.elapsed * 12.0) * 0.12;
      this.alertGroup.scale.set(this.alertScale, this.alertScale * bob, this.alertScale);

      if (this.alertTimer <= 0) {
        this.alertGroup.visible = false;
      }
    }
  }

  /**
   * Subclasses implement their custom 3D model geometry and hierarchy
   */
  protected abstract buildModel(): void;

  /**
   * Subclasses implement their behavior tree / finite state machine logic
   */
  protected abstract updateAI(dt: number, playerPos: THREE.Vector3, collidables: THREE.Mesh[]): void;

  /**
   * Clean up Three.js geometries and materials
   */
  public dispose(): void {
    for (const mesh of this.collidableMeshes) {
      mesh.geometry.dispose();
    }
    for (const mat of this.materials) {
      InkShaderMaterial.unregister(mat);
      mat.dispose();
    }
  }
}

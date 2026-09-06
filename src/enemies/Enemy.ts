import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { soundManager } from '../core/SoundManager';
import { InkParticles } from '../effects/InkParticles';

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

  public state: EnemyState = EnemyState.IDLE;
  public health: number;
  public maxHealth: number;
  public isDead: boolean = false;
  public alerted: boolean = false;

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

  // Spawn grace: no attacking for 1.5s after sketch-in (fairness)
  public spawnGrace: number = 1.5;

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

  /**
   * Initializes standard ink shader materials for this enemy instance
   */
  protected initSharedMaterials(): void {
    // Body material: Darkened hatching with red ink blend
    this.primaryEnemyMat = InkShaderMaterial.create({
      isEnemy: true,
      accentColor: new THREE.Color(0.85, 0.2, 0.2)
    });

    // Accent material: Vibrant red sketch ink for head, weakpoints, and alerts
    this.accentRedMat = InkShaderMaterial.create({
      isAccent: true,
      accentColor: new THREE.Color(0.85, 0.2, 0.2)
    });

    this.materials.push(this.primaryEnemyMat, this.accentRedMat);
  }

  /**
   * Helper to create a styled sketch mesh with ballpoint blue edge lines
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

    // Blue ink edge outline
    const edges = InkShaderMaterial.createEdgeLines(geometry, InkShaderMaterial.defaultInkColor);
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
      soundManager.playAggro();

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
      this.die(hitPoint, isHeadshot);
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
   * Triggers disintegration and marks enemy as dead
   */
  public die(hitPoint?: THREE.Vector3, _isHeadshot: boolean = false): void {
    if (this.isDead) return;

    this.isDead = true;
    this.state = EnemyState.DEAD;
    this.health = 0;

    // Hide UI overlays
    this.alertGroup.visible = false;
    this.healthBarGroup.visible = false;

    // Audio feedback
    soundManager.playEnemyDeath();

    // Disable raycasting against meshes
    for (const m of this.collidableMeshes) {
      m.visible = false;
    }
  }

  /**
   * Spawns disintegration particle burst using InkParticles
   */
  public disintegrate(particles: InkParticles): void {
    const origin = this.group.position.clone();
    origin.y += this.eyeHeight * 0.5;
    particles.spawnEnemyDeath(origin);
  }

  /**
   * Per-frame update loop
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    camera?: THREE.Camera,
    collidables: THREE.Mesh[] = []
  ): void {
    if (this.isDead) return;

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
            mat.uniforms.uAccentColor.value.setRGB(0.85, 0.2, 0.2);
          }
        }
      }
    }

    // 3. Stagger recovery
    if (this.state === EnemyState.STAGGER) {
      this.staggerTimer -= dt;
      // Damp stagger velocity
      this.group.position.addScaledVector(this.staggerVelocity, dt);
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

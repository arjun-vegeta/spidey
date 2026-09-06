import * as THREE from 'three';
import { SwingPhysics, MovementMode } from './SwingPhysics';
import { InputManager } from '../core/InputManager';
import { WeaponManager } from './WeaponManager';
import { PlayerArms } from './PlayerArms';
import { WebShooter } from './WebShooter';
import { soundManager } from '../core/SoundManager';
import { FireResult } from '../weapons/BaseWeapon';
import { Sniper } from '../weapons/Sniper';
import { WorldCollider, PushResult } from '../world/WorldCollider';

export class Player {
  public camera: THREE.PerspectiveCamera;
  public physics: SwingPhysics;
  public input: InputManager;
  public weaponManager: WeaponManager;
  public arms: PlayerArms;
  public webShooter: WebShooter;

  // Camera orientation
  public yaw: number = 0;
  public pitch: number = 0;
  public cameraRoll: number = 0;

  // Base FOV
  public baseFov: number = 75;
  public currentFov: number = 75;

  // Player stats
  public maxHealth: number = 100;
  public health: number = 100;
  public isDead: boolean = false;
  public invulnerabilityTimer: number = 0;

  // HP regen (forgiveness model: regen to 50 after 5s without damage)
  public hpRegenTo: number = 50;
  public hpRegenDelay: number = 5.0;
  public hpRegenRate: number = 12.0;
  private lastDamageAt: number = -100;

  // Simplified collision shells (preferred over mesh sampling when bound)
  public worldCollider: WorldCollider | null = null;
  private pushScratch: PushResult = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
  private headPushScratch: PushResult = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
  private torsoPushScratch: PushResult = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
  private _upRay: THREE.Raycaster = new THREE.Raycaster();

  // Traversal & stunt score tracking
  public isMidAir: boolean = false;
  public airTime: number = 0;
  public landingDip: number = 0;

  // Scope breath: hold Shift to steady, 3s lungs
  private breathLeft: number = 3.0;
  private swayTime: number = 0;

  // Temporary vectors (reused to avoid per-frame allocation)
  private _tempVec: THREE.Vector3 = new THREE.Vector3();
  private _tempVec2: THREE.Vector3 = new THREE.Vector3();
  private _forward: THREE.Vector3 = new THREE.Vector3();
  private _forwardFlat: THREE.Vector3 = new THREE.Vector3();
  private _rightFlat: THREE.Vector3 = new THREE.Vector3();
  private _inputDir: THREE.Vector3 = new THREE.Vector3();
  private _euler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _eyeOffset: THREE.Vector3 = new THREE.Vector3(0, 0.8, 0);
  private _downRay: THREE.Raycaster = new THREE.Raycaster();
  private _box: THREE.Box3 = new THREE.Box3();
  private _closest: THREE.Vector3 = new THREE.Vector3();
  private static readonly SPAWN = new THREE.Vector3(0, 4.0, 18.0);

  constructor(camera: THREE.PerspectiveCamera, input: InputManager) {
    this.camera = camera;
    this.input = input;

    this.physics = new SwingPhysics();
    this.weaponManager = new WeaponManager();
    this.arms = new PlayerArms();
    this.webShooter = new WebShooter(this.physics);

    // Attach arms and weapons to camera so they follow in first person
    this.camera.add(this.arms.armsGroup);
    this.camera.add(this.weaponManager.weaponContainer);

    // Initial spawn shares the single reset path (no triple init drift)
    this.reset();
  }

  /** Position camera for menu-background / first-frame render before Play. */
  public lookInit(): void {
    this.yaw = 0;
    this.pitch = -0.04;
    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);
    this.camera.position.copy(this.physics.position).add(this._eyeOffset);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  public bindCollider(c: WorldCollider): void {
    this.worldCollider = c;
  }

  public reset(): void {    this.physics.reset(Player.SPAWN);
    this.yaw = 0;
    this.pitch = 0;
    this.cameraRoll = 0;
    this.currentFov = this.baseFov;
    this.health = this.maxHealth;
    this.isDead = false;
    this.invulnerabilityTimer = 0;
    this.lastDamageAt = -100;
    this.airTime = 0;
    this.landingDip = 0;
    this.webShooter.isWebActive = false;
    this.webShooter.currentTarget = null;
    this.weaponManager.resetAmmo();
  }

  public get isSwinging(): boolean {
    return this.physics.mode === MovementMode.SWINGING;
  }

  public get velocity(): THREE.Vector3 {
    return this.physics.velocity;
  }

  public get position(): THREE.Vector3 {
    return this.physics.position;
  }

  public takeDamage(amount: number): boolean {
    if (this.isDead || this.invulnerabilityTimer > 0) return false;

    this.health = Math.max(0, this.health - amount);
    this.invulnerabilityTimer = 0.4; // 400ms i-frames
    this.lastDamageAt = performance.now() * 0.001;

    // Camera jolt
    this.pitch += (Math.random() - 0.5) * 0.08;
    this.yaw += (Math.random() - 0.5) * 0.08;

    // Unscope the sniper when hurt (no scope-camping through trades)
    const activeNow = this.weaponManager.activeWeapon;
    if (activeNow.type === 'sniper' && (activeNow as Sniper).isScoped) {
      (activeNow as Sniper).isScoped = false;
      this.weaponManager.aimProgress = 0;
    }

    if (this.health <= 0) {
      this.isDead = true;
      soundManager.playEnemyDeath();
    }
    return true;
  }

  public heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  public update(dt: number, collidables: THREE.Object3D[], combatTargets?: THREE.Object3D[], webAnchors?: THREE.Vector3[]): FireResult | null {
    if (this.isDead) return null;

    if (this.invulnerabilityTimer > 0) {
      this.invulnerabilityTimer -= dt;
    }

    // HP regen to hpRegenTo after hpRegenDelay without damage
    if (this.health < this.hpRegenTo) {
      const now = performance.now() * 0.001;
      if (now - this.lastDamageAt > this.hpRegenDelay) {
        this.health = Math.min(this.hpRegenTo, this.health + this.hpRegenRate * dt);
      }
    }

    // 0. ADS sensitivity scaling (ratio currentFov/baseFov passed to InputManager)
    const fovRatio = this.currentFov / this.baseFov;
    const adsScale = this.isSwinging ? 0 : this.weaponManager.aimProgress;
    this.input.setAdsScaling(adsScale, fovRatio);

    // 1. Mouse look updates
    this.yaw -= this.input.mouseDelta.x;
    this.pitch -= this.input.mouseDelta.y;
    // Clamp vertical pitch to prevent backflips
    this.pitch = Math.max(-Math.PI / 2.05, Math.min(Math.PI / 2.05, this.pitch));

    // Dynamic camera roll when swinging or strafing
    const targetRoll = this.isSwinging
      ? THREE.MathUtils.clamp(-this.physics.velocity.x * 0.012, -0.3, 0.3)
      : (this.input.isMovingLeft() ? 0.025 : (this.input.isMovingRight() ? -0.025 : 0));
    this.cameraRoll = THREE.MathUtils.lerp(this.cameraRoll, targetRoll, dt * 8.0);

    // Apply camera rotation: Yaw -> Pitch -> Roll (scope sway rides the euler only)
    let swayY = 0;
    let swayP = 0;
    const scopeWep = this.weaponManager.activeWeapon;
    const scopedNow = scopeWep.type === 'sniper' && (scopeWep as Sniper).isScoped;
    if (scopedNow) {
      this.swayTime += dt;
      const steadying = this.input.isReelingIn() && this.breathLeft > 0;
      if (steadying) this.breathLeft = Math.max(0, this.breathLeft - dt);
      else this.breathLeft = Math.min(3, this.breathLeft + dt * 0.8);
      if (!steadying || this.breathLeft <= 0) {
        swayY = Math.sin(this.swayTime * 1.3) * 0.004 + Math.sin(this.swayTime * 2.9) * 0.0015;
        swayP = Math.cos(this.swayTime * 1.7) * 0.003;
      }
    } else {
      this.breathLeft = Math.min(3, this.breathLeft + dt * 2);
    }
    this._euler.set(this.pitch + swayP, this.yaw + swayY, this.cameraRoll);
    this.camera.quaternion.setFromEuler(this._euler);

    // 2. Movement direction vectors in camera horizontal plane
    const forward = this._forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._forwardFlat.set(forward.x, 0, forward.z);
    if (this._forwardFlat.lengthSq() < 1e-6) this._forwardFlat.set(0, 0, -1);
    else this._forwardFlat.normalize();
    const forwardFlat = this._forwardFlat;
    const rightFlat = this._rightFlat.crossVectors(forwardFlat, Player.UP);
    if (rightFlat.lengthSq() < 1e-6) rightFlat.set(1, 0, 0);
    else rightFlat.normalize();

    const inputDir = this._inputDir.set(0, 0, 0);
    if (this.input.isMovingForward()) inputDir.add(forwardFlat);
    if (this.input.isMovingBackward()) inputDir.sub(forwardFlat);
    if (this.input.isMovingRight()) inputDir.add(rightFlat);
    if (this.input.isMovingLeft()) inputDir.sub(rightFlat);
    if (inputDir.lengthSq() > 0.01) inputDir.normalize();
    const isMoving = inputDir.lengthSq() > 0.01;

    // 3. Web-Slinging Actions
    // Scan for potential anchors ahead (forgiving cone + height bias + latch magnet)
    this.webShooter.scanForTargets(this.camera, collidables, this.physics.position, webAnchors);

    // Web attach (Hold right-click or E)
    if (this.input.webJustPressed) {
      this.webShooter.shootWeb(undefined, this.physics.position);
    } else if (!this.input.isWebHolding() && this.isSwinging) {
      // Released web: apply slingshot momentum boost if jumping
      this.webShooter.releaseWeb(this.input.isJumping(), forward);
    }

    // Web Zip (Press F)
    if (this.input.webZipJustPressed) {
      this.webShooter.triggerWebZip();
    }

    // Jump buffering + coyote time + zip-cancel
    if (this.physics.isGrounded) this.physics.coyoteTimer = 0.12;
    else this.physics.coyoteTimer = Math.max(0, this.physics.coyoteTimer - dt);
    if (this.input.jumpJustPressed) this.physics.jumpBufferTimer = 0.14;
    else this.physics.jumpBufferTimer = Math.max(0, this.physics.jumpBufferTimer - dt);

    if (this.physics.jumpBufferTimer > 0) {
      if (this.physics.mode === MovementMode.WEB_ZIPPING) {
        // Zip-cancel: jump converts zip into forward/upward release boost
        this.webShooter.cancelWebZip(forward);
        this.physics.jumpBufferTimer = 0;
      } else if (this.isSwinging) {
        this.webShooter.releaseWeb(true, forward);
        this.physics.jumpBufferTimer = 0;
      } else if (this.physics.isGrounded || this.physics.coyoteTimer > 0) {
        this.physics.jump();
        this.physics.jumpBufferTimer = 0;
      }
    }

    // 4. Update Physics Simulation (ADS slows feet on the ground: commitment)
    const wasGrounded = this.physics.isGrounded;
    const fallSpeedBefore = this.physics.velocity.y;
    const wantAimSlow = this.input.isZoomHolding() && !this.isSwinging && this.physics.isGrounded;
    this.physics.speedMultiplier = wantAimSlow ? 0.6 : 1.0;
    const isReelingIn = this.input.isReelingIn();
    const isReelingOut = this.input.isReelingOut();

    // Airborne control intent: air brake (holding S/back) & dive (holding Ctrl)
    const isAirborne = !this.physics.isGrounded && this.physics.mode === MovementMode.AIR;
    const braking = isAirborne && this.input.isMovingBackward();
    const diving = isAirborne && this.input.isDiving();

    // Downward pitch assist while diving
    if (diving) {
      this.pitch = Math.max(-Math.PI / 2.05, this.pitch - 0.5 * dt);
    }

    this.physics.update(dt, inputDir, forward, isReelingIn, isReelingOut, braking, diving);

    // World collision: ground raycast (floors/roofs) + capsule push-out (walls)
    this.resolveWorldCollisions(collidables);

    // Landing dip feel & hard landing control damp (>25 m/s fall)
    if (!wasGrounded && this.physics.isGrounded && fallSpeedBefore < -12) {
      this.landingDip = Math.min(0.35, (-fallSpeedBefore - 12) * 0.02);
      if (fallSpeedBefore < -25) {
        this.physics.controlDampTimer = 0.25;
        soundManager.playImpactWall();
      }
    }
    this.landingDip = THREE.MathUtils.lerp(this.landingDip, 0, dt * 7.0);

    // Snap camera position to physics position (eye level at 1.7m)
    this.camera.position.copy(this.physics.position).add(this._eyeOffset);
    this.camera.position.y -= this.landingDip;

    // Air time tracking
    if (!this.physics.isGrounded) this.airTime += dt;
    else this.airTime = 0;
    this.isMidAir = !this.physics.isGrounded;

    // 5. Sound: Wind rush modulation based on velocity
    const currentSpeed = this.physics.velocity.length();
    soundManager.updateWind(currentSpeed, 45.0);

    // 6. Dynamic FOV based on speed, sniper scope, and holographic sight ADS
    const activeWep = this.weaponManager.activeWeapon;
    const isAiming = this.input.isZoomHolding() && !this.isSwinging;
    const isSniperScoped = activeWep.type === 'sniper' && (activeWep as Sniper).isScoped;

    if (isSniperScoped) {
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, 22.0, dt * 14.0);
    } else if (isAiming && activeWep.type === 'smg') {
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, 60.0, dt * 12.0);
    } else if (isAiming && activeWep.type === 'pistol') {
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, 66.0, dt * 12.0);
    } else {
      const speedT = Math.min(Math.max((currentSpeed - 8) / 32.0, 0), 1);
      const targetFov = this.baseFov + speedT * 22.0; // Widens from 75 up to 97 deg at high speed
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, dt * 6.0);
    }
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // 7. Weapon Switching
    if (this.input.weaponSwitchIndex >= 0) {
      this.weaponManager.switchWeapon(this.input.weaponSwitchIndex);
    }
    if (this.input.mouseWheelDelta > 0) {
      this.weaponManager.nextWeapon();
    } else if (this.input.mouseWheelDelta < 0) {
      this.weaponManager.prevWeapon();
    }

    // 8. Weapon Reloading
    if (this.input.reloadJustPressed) {
      this.weaponManager.reload();
    }
    if (activeWep.currentAmmo === 0 && !activeWep.isReloading) {
      this.weaponManager.reload();
    }

    // 9. Weapon Firing (bullets test enemies AND walls so cover blocks shots)
    let fireResult: FireResult | null = null;
    const shouldFire = activeWep.type === 'smg' ? this.input.isFiring() : this.input.fireJustPressed;

    if (shouldFire) {
      const now = performance.now() * 0.001;
      const shootOrigin = this._tempVec.copy(this.camera.position);
      const shootDir = this._tempVec2.copy(forward);

      const targets = combatTargets ?? collidables;
      fireResult = this.weaponManager.fire(now, shootOrigin, shootDir, this.isSwinging, targets, {
        moving: isMoving,
        aiming: this.input.isZoomHolding() && !this.isSwinging,
      });
    }

    // 10. Update Weapon & Arm Animations
    this.weaponManager.update(dt, this.isSwinging, isAiming, isMoving, currentSpeed);

    // Arms follow web anchor
    this.arms.update(
      dt,
      this.isSwinging,
      this.physics.webAnchor,
      this.camera.position,
      isMoving,
      currentSpeed
    );

    // 11. Update Web Line Renderer
    const wristWorldPos = this._tempVec2;
    this.arms.getWebOriginWorldPos(wristWorldPos);
    this.webShooter.update(dt, wristWorldPos);

    return fireResult;
  }

  private static UP: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  private resolveWorldCollisions(collidables: THREE.Object3D[]): void {
    const p = this.physics.position;
    const r = this.physics.playerRadius;

    if (this.worldCollider) {
      this.resolveWithShells(p, r);
    } else {
      this.resolveWithMeshes(p, r, collidables);
    }

    // C. World bounds
    p.x = THREE.MathUtils.clamp(p.x, -250, 250);
    p.z = THREE.MathUtils.clamp(p.z, -250, 250);
    if (p.y < -20) {
      p.set(0, 12, 18);
      this.physics.velocity.set(0, 0, 0);
      this.takeDamage(10);
    }
  }

  /** Preferred path: simplified collision shells + spatial hash. */
  private resolveWithShells(p: THREE.Vector3, r: number): void {
    const coll = this.worldCollider as WorldCollider;
    const halfH = this.physics.playerHeight * 0.5;

    // A. Ground snap via floor shells (supports roofs, terraces, slabs, street)
    const feetY = p.y - halfH;
    const top = coll.groundAt(p.x, feetY, p.z);
    if (top !== null && feetY <= top + 0.15 && this.physics.velocity.y <= 0.5) {
      p.y = top + halfH;
      if (this.physics.velocity.y < 0) this.physics.velocity.y = 0;
      if (!this.physics.isGrounded) {
        this.physics.isGrounded = true;
        if (this.physics.mode === MovementMode.AIR || this.physics.mode === MovementMode.SWINGING) {
          this.physics.mode = MovementMode.GROUNDED;
          this.physics.webAnchor = null;
          this.webShooter.isWebActive = false;
        }
      }
    } else if (top === null || feetY > top + 0.35) {
      if (this.physics.isGrounded) {
        this.physics.isGrounded = false;
        if (this.physics.mode === MovementMode.GROUNDED) this.physics.mode = MovementMode.AIR;
      }
    }

    // B. Horizontal push-out against wall shells
    const push = this.pushScratch;
    coll.pushOut(p.x, p.z, r, p.y - halfH, p.y + halfH, push);
    let wallNx = 0;
    let wallNz = 0;
    let hasWallContact = false;
    if (push.pushed) {
      p.x = push.x;
      p.z = push.z;
      const vn = this.physics.velocity.x * push.nx + this.physics.velocity.z * push.nz;
      if (vn < 0) {
        this.physics.velocity.x -= push.nx * vn;
        this.physics.velocity.z -= push.nz * vn;
      }
      wallNx = push.nx;
      wallNz = push.nz;
      hasWallContact = true;
    }

    // B1. Head-bump: when moving upward and a wall box overlaps the head band but not lower torso
    if (this.physics.velocity.y > 0) {
      const headMinY = p.y + halfH - 0.4;
      const headMaxY = p.y + halfH + 0.3;
      const headPush = this.headPushScratch;
      coll.pushOut(p.x, p.z, r * 0.8, headMinY, headMaxY, headPush);

      if (headPush.pushed) {
        // If the wall does NOT overlap lower torso/feet, player's head hit an overhang/ceiling
        const torsoPush = this.torsoPushScratch;
        coll.pushOut(p.x, p.z, r * 0.8, p.y - halfH, p.y + halfH - 0.5, torsoPush);
        if (!torsoPush.pushed) {
          this.physics.velocity.y = 0;
          soundManager.playImpactWall();
        }
      }
    }

    // B2. Wall-run entry: airborne + fast + holding forward + side contact
    if (
      hasWallContact &&
      !this.physics.isGrounded &&
      this.physics.mode === MovementMode.AIR &&
      this.physics.velocity.length() > 10 &&
      (this.input.isMovingForward() || this.isSwinging)
    ) {
      this.physics.mode = MovementMode.WALL_RUNNING;
      this.physics.wallNormal.set(wallNx, 0, wallNz);
      this.physics.wallRunTimer = 0;
    } else if (this.physics.mode === MovementMode.WALL_RUNNING && (!hasWallContact || this.physics.isGrounded)) {
      this.physics.detachFromWall();
    }
  }

  /** Fallback path: mesh sampling (kept for tests / unbound play). */
  private resolveWithMeshes(p: THREE.Vector3, r: number, collidables: THREE.Object3D[]): void {
    this._downRay.set(
      this._closest.set(p.x, p.y + 1.0, p.z),
      Player.DOWN
    );
    this._downRay.near = 0;
    this._downRay.far = 2.6;
    const groundHits = this._downRay.intersectObjects(collidables, false);
    if (groundHits.length > 0) {
      const g = groundHits[0];
      const groundY = g.point.y + this.physics.playerHeight * 0.5;
      if (p.y <= groundY + 0.15 && this.physics.velocity.y <= 0.5) {
        p.y = groundY;
        if (this.physics.velocity.y < 0) this.physics.velocity.y = 0;
        if (!this.physics.isGrounded) {
          this.physics.isGrounded = true;
          if (this.physics.mode === MovementMode.AIR || this.physics.mode === MovementMode.SWINGING) {
            this.physics.mode = MovementMode.GROUNDED;
            this.physics.webAnchor = null;
            this.webShooter.isWebActive = false;
          }
        }
      } else if (p.y > groundY + 0.35 && this.physics.isGrounded) {
        this.physics.isGrounded = false;
        if (this.physics.mode === MovementMode.GROUNDED) this.physics.mode = MovementMode.AIR;
      }
    } else {
      // Fallback street plane (slab top ≈ 0.5m)
      this.physics.resolveGround(0.5);
      if (!this.physics.isGrounded && p.y > 3.0 && this.physics.mode === MovementMode.GROUNDED) {
        this.physics.isGrounded = false;
        this.physics.mode = MovementMode.AIR;
      }
    }

    // Upward head-bump check against collidable meshes when moving upward
    if (this.physics.velocity.y > 0) {
      this._upRay.set(this._closest.set(p.x, p.y + 0.5, p.z), Player.UP);
      this._upRay.near = 0;
      this._upRay.far = this.physics.playerHeight * 0.5 + 0.4;
      const upHits = this._upRay.intersectObjects(collidables, false);
      if (upHits.length > 0 && upHits[0].distance < this.physics.playerHeight * 0.5 + 0.35) {
        this.physics.velocity.y = 0;
        soundManager.playImpactWall();
      }
    }

    // B. Horizontal capsule push-out against nearby boxes (sampled for perf)
    let wallNx = 0;
    let wallNz = 0;
    let hasWallContact = false;
    for (let i = 0; i < collidables.length; i += 2) {
      const obj = collidables[i] as THREE.Mesh;
      if (!obj || !obj.geometry) continue;
      const dx = obj.position.x - p.x;
      const dz = obj.position.z - p.z;
      if (dx * dx + dz * dz > 64) continue;
      this._box.setFromObject(obj);
      // Shrink vertical range to torso so floors don't push us sideways
      if (p.y > this._box.max.y - 0.25 || p.y < this._box.min.y - 1.2) continue;
      this._closest.set(p.x, THREE.MathUtils.clamp(p.y, this._box.min.y, this._box.max.y), p.z);
      const cx = THREE.MathUtils.clamp(this._closest.x, this._box.min.x, this._box.max.x);
      const cz = THREE.MathUtils.clamp(this._closest.z, this._box.min.z, this._box.max.z);
      const px = p.x - cx;
      const pz = p.z - cz;
      const d2 = px * px + pz * pz;
      if (d2 < r * r && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        p.x += px * push;
        p.z += pz * push;
        const nx = px / d;
        const nz = pz / d;
        const vn = this.physics.velocity.x * nx + this.physics.velocity.z * nz;
        if (vn < 0) {
          this.physics.velocity.x -= nx * vn;
          this.physics.velocity.z -= nz * vn;
        }
        wallNx = nx;
        wallNz = nz;
        hasWallContact = true;
      } else if (d2 <= 1e-8) {
        // Center inside box — push out along smallest horizontal axis
        const ex = Math.min(p.x - this._box.min.x, this._box.max.x - p.x);
        const ez = Math.min(p.z - this._box.min.z, this._box.max.z - p.z);
        if (ex < ez) p.x = p.x - this._box.min.x < this._box.max.x - p.x ? this._box.min.x - r : this._box.max.x + r;
        else p.z = p.z - this._box.min.z < this._box.max.z - p.z ? this._box.min.z - r : this._box.max.z + r;
        this.physics.velocity.x *= 0.2;
        this.physics.velocity.z *= 0.2;
        hasWallContact = true;
      }
    }

    // B2. Wall-run entry: airborne + fast + holding forward + side contact
    // Previously WALL_RUNNING was dead code — now wired for feel.
    if (
      hasWallContact &&
      !this.physics.isGrounded &&
      this.physics.mode === MovementMode.AIR &&
      this.physics.velocity.length() > 10 &&
      (this.input.isMovingForward() || this.isSwinging)
    ) {
      this.physics.mode = MovementMode.WALL_RUNNING;
      this.physics.wallNormal.set(wallNx, 0, wallNz);
      this.physics.wallRunTimer = 0;
    } else if (this.physics.mode === MovementMode.WALL_RUNNING && (!hasWallContact || this.physics.isGrounded)) {
      this.physics.detachFromWall();
    }
  }

  private static DOWN: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
}

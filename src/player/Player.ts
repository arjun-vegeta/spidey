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
import { Spring } from '../core/Spring';

/**
 * Landing-snap window: feet snap onto a floor top only when inside
 * [top - fallSweep, top + tolerance]. Anything higher keeps falling —
 * without the lower bound every falling frame teleports down to the
 * highest floor below (winch vaults "flashing to the bottom").
 * Pure so landing behavior is unit-testable without a DOM.
 */
export function shouldSnapToGround(
  feetY: number,
  top: number,
  fallSweep: number,
  isGrounded: boolean
): boolean {
  const tolerance = isGrounded ? 0.4 : 0.2;
  return feetY <= top + tolerance && feetY >= top - fallSweep;
}

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

  // Camera recoil springs & screen shake (inspired by inspiration's punchy kinetic feel)
  public recoilPitch: Spring = new Spring(190, 17);
  public recoilYaw: Spring = new Spring(190, 17);
  public fovKick: Spring = new Spring(220, 14);
  public landDipSpring: Spring = new Spring(170, 15);
  public shakeAmt: number = 0;

  // Head bobbing & camera feel (inspiration/src/player.js lines 28, 211-214, 426-432)
  public bobPhase: number = 0;
  public bobAmt: number = 0;
  public stepDist: number = 0;
  public eyeH: number = 0.8;

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

  // Footstep audio pacing
  private footstepTimer: number = 0;

  // Failed-web feedback hook (wired to HUD reticle shake)
  public onDryWeb?: () => void;

  // Simplified collision shells (preferred over mesh sampling when bound)
  public worldCollider: WorldCollider | null = null;
  private pushScratch: PushResult = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
  private headPushScratch: PushResult = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
  private torsoPushScratch: PushResult = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
  private _upRay: THREE.Raycaster = new THREE.Raycaster();

  // Traversal & stunt score tracking
  // ARCHITECTURAL DECISION (Milestone 1 / 26 / G):
  // Slide is officially NO (CUT).
  // Web-swinging, air-brake (S), and dive-assist (Ctrl) fully provide high-velocity
  // and low-clearance traversal fantasies. Introducing a ground slide adds keybind
  // contention with crouch/reel, risk of snagging on stepped terrain, and offers
  // redundant gameplay utility.
  public isMidAir: boolean = false;
  public airTime: number = 0;
  public landingDip: number = 0;

  // Stance: crouch (C) and sprint (Shift) are ground-only and context-sensitive.
  // Shift reels rope while swinging; C reels rope while swinging.
  public isCrouching: boolean = false;
  public isSprinting: boolean = false;
  public mantleCooldown: number = 0;

  // Tap-vs-hold Space while swinging: tap slings, hold winches.
  private winchWait: number = -1;
  private readonly winchHoldTime: number = 0.18;

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

  public reset(): void {
    this.physics.reset(Player.SPAWN);
    this.physics.playerHeight = this.physics.standHeight;
    this.isCrouching = false;
    this.isSprinting = false;
    this.winchWait = -1;
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
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.stepDist = 0;
    this.eyeH = 0.8;
    this.landDipSpring.set(0);
    this.footstepTimer = 0;
    soundManager.setHeartbeat(false);
    soundManager.updateRopeStrain(false, 0, 0);
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

  /**
   * Adds trauma / screen shake impulse (damped exponentially every frame).
   */
  public addScreenShake(amount: number): void {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + amount);
  }

  /**
   * Applies recoil kick to camera pitch/yaw springs, FOV pop spring, and screen shake.
   */
  public applyFireRecoil(
    camKickPitch: number = 0.035,
    camKickYaw: number = 0.008,
    fovKickAmount: number = 2.0,
    shakeAmount: number = 0.06
  ): void {
    // Upward pitch recoil kick + subtle yaw twitch
    this.pitch = Math.max(-Math.PI / 2.05, Math.min(Math.PI / 2.05, this.pitch + camKickPitch * 0.45));
    this.recoilPitch.kick(camKickPitch * 22);
    this.recoilYaw.kick((Math.random() - 0.5) * camKickYaw * 30);
    this.fovKick.kick(fovKickAmount * 28);
    this.addScreenShake(shakeAmount);
  }

  public takeDamage(amount: number, attackerPos?: THREE.Vector3): boolean {
    if (this.isDead || this.invulnerabilityTimer > 0) return false;

    this.health = Math.max(0, this.health - amount);
    this.invulnerabilityTimer = 0.4; // 400ms i-frames
    this.lastDamageAt = performance.now() * 0.001;
    this.addScreenShake(0.22 + amount / 75.0);

    // Directional pan calculation based on attacker position relative to camera right
    let pan = 0;
    if (attackerPos) {
      const dx = attackerPos.x - this.physics.position.x;
      const dz = attackerPos.z - this.physics.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.01) {
        const rightDot = (dx * this._rightFlat.x + dz * this._rightFlat.z) / dist;
        pan = Math.max(-1, Math.min(1, rightDot));
      }
    }
    soundManager.playPlayerHurt(pan);

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
      soundManager.setHeartbeat(false);
      soundManager.updateRopeStrain(false, 0, 0);
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
    if (this.mantleCooldown > 0) {
      this.mantleCooldown -= dt;
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

    // Dynamic camera roll when swinging or strafing (inspiration: damp(this.roll, -mv.x * 0.022, 9, dt))
    let targetRoll: number;
    if (this.isSwinging) {
      targetRoll = THREE.MathUtils.clamp(-this.physics.velocity.x * 0.012, -0.3, 0.3);
    } else {
      const strafeX = (this.input.isMovingRight() ? 1 : 0) - (this.input.isMovingLeft() ? 1 : 0);
      targetRoll = -strafeX * 0.022;
    }
    this.cameraRoll = THREE.MathUtils.damp(this.cameraRoll, targetRoll, 9.0, dt);

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

    // Update camera recoil, FOV & land dip springs (damped harmonic oscillator from inspiration)
    this.recoilPitch.update(dt);
    this.recoilYaw.update(dt);
    this.fovKick.update(dt);
    this.landDipSpring.update(dt);

    // Dynamic head bob & step distance pacing (inspiration/src/player.js lines 211-214)
    const horizSpeed = Math.hypot(this.physics.velocity.x, this.physics.velocity.z);
    const isMovingGround = this.physics.isGrounded && horizSpeed > 0.6;
    const targetBobAmt = isMovingGround ? THREE.MathUtils.clamp(horizSpeed / 7.0, 0.3, 1.4) : 0;
    this.bobAmt = THREE.MathUtils.damp(this.bobAmt, targetBobAmt, 8.0, dt);

    if (isMovingGround) {
      this.bobPhase += dt * (7.0 + horizSpeed * 0.5);
      this.stepDist += horizSpeed * dt;
      const stepInterval = this.isSprinting ? 2.5 : 2.0;
      if (this.stepDist >= stepInterval) {
        this.stepDist = 0;
        soundManager.playFootstep();
      }
    } else {
      this.stepDist = 0;
    }

    // Exponential screen shake decay
    const sh = this.shakeAmt;
    this.shakeAmt = THREE.MathUtils.damp(sh, 0, 7.0, dt);
    const shk = Math.min(this.shakeAmt, 1.2);

    const shakeRotX = (Math.random() - 0.5) * shk * 0.035;
    const shakeRotY = (Math.random() - 0.5) * shk * 0.035;
    const shakeRotZ = (Math.random() - 0.5) * shk * 0.02;

    const bobRoll = Math.sin(this.bobPhase * 0.5) * 0.004 * this.bobAmt;

    this._euler.set(
      this.pitch + swayP + this.recoilPitch.value + shakeRotX,
      this.yaw + swayY + this.recoilYaw.value + shakeRotY,
      this.cameraRoll + bobRoll + shakeRotZ
    );
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

    // Web attach (tap E / right-click). The line is STICKY: it stays connected
    // until you sling (Space), grab elsewhere (E again), land, or go slack.
    if (this.input.webJustPressed) {
      if (this.isSwinging) {
        // Re-target mid-swing: drop the old line, grab the new anchor
        this.webShooter.releaseWeb(false);
        const attached = this.webShooter.shootWeb(undefined, this.physics.position);
        if (!attached) {
          soundManager.playDryWeb();
          if (this.onDryWeb) this.onDryWeb();
        }
      } else {
        const attached = this.webShooter.shootWeb(undefined, this.physics.position);
        if (!attached) {
          soundManager.playDryWeb();
          if (this.onDryWeb) this.onDryWeb();
        }
      }
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
        // Don't sling yet: tap = sling, hold = winch (decided below)
        this.winchWait = 0;
        this.physics.jumpBufferTimer = 0;
      } else if (this.physics.isGrounded || this.physics.coyoteTimer > 0) {
        this.physics.jump();
        this.physics.jumpBufferTimer = 0;
      }
    }

    // Tap-vs-hold Space while swinging. Tap yanks you to the anchor (sling);
    // holding reels you all the way to the point (winch). Letting go mid-winch
    // drops the line and keeps your momentum with a small hop.
    if (this.winchWait >= 0 && this.isSwinging) {
      this.winchWait += dt;
      if (!this.input.isJumpHeld()) {
        this.physics.slingTowardAnchor(forward);
        this.webShooter.notifyReleased();
        this.winchWait = -1;
      } else if (this.winchWait >= this.winchHoldTime) {
        this.physics.winching = true;
        this.winchWait = -1;
      }
    } else if (this.winchWait >= 0) {
      this.winchWait = -1;
    }
    if (this.physics.winching && (!this.input.isJumpHeld() || !this.isSwinging)) {
      // Let go mid-winch: line goes dead, you keep momentum and fall.
      this.physics.winching = false;
      if (this.isSwinging) {
        this.webShooter.releaseWeb(false);
      }
    }

    // 4. Stance: crouch (C) sits you down, Shift sprints — ground only.
    // Space with no web is just a plain jump (handled by the buffer below).
    const groundedNow = this.physics.isGrounded;
    const aimingNow = this.input.isZoomHolding() && !this.isSwinging;
    let crouch = this.input.isCrouchHeld() && groundedNow;
    if (!this.input.isCrouchHeld() && this.physics.crouching && this.worldCollider) {
      // Trying to stand: check headroom for the full 1.8m body first
      const needHead = this.physics.position.y + 0.95;
      const ceil = this.worldCollider.ceilingAt(
        this.physics.position.x, needHead - 0.1, this.physics.position.z
      );
      if (ceil !== null && ceil < needHead) crouch = true;
    }
    this.isCrouching = crouch;
    this.physics.crouching = crouch;
    this.physics.playerHeight = crouch ? this.physics.crouchHeight : this.physics.standHeight;

    // Sprint: Shift + forward + grounded + not aiming. ADS always wins.
    this.isSprinting =
      this.input.isSprintHeld() && groundedNow && !aimingNow && this.input.isMovingForward() && !crouch;
    this.physics.speedMultiplier = aimingNow && groundedNow
      ? 0.6
      : this.isSprinting ? this.physics.sprintMultiplier : 1.0;

    // 5. Update Physics Simulation (ADS slows feet on the ground: commitment)
    const wasGrounded = this.physics.isGrounded;
    const fallSpeedBefore = this.physics.velocity.y;
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

    // Continuous collision sub-stepping: fast-moving player (swings/falls) never tunnels through thin railings or walls
    const moveSpeed = this.physics.velocity.length();
    const maxSubStepDist = 0.20; // 20cm max distance per collision step
    const subSteps = Math.min(4, Math.max(1, Math.ceil((moveSpeed * dt) / maxSubStepDist)));
    const subDt = dt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      this.physics.update(subDt, inputDir, forward, isReelingIn, isReelingOut, braking, diving);
      this.resolveWorldCollisions(collidables, subDt);
    }

    // The line can end inside physics (winch arrival, slack timeout):
    // sync the renderer/sound state when swinging stopped but nobody told the shooter.
    if (!this.isSwinging && this.webShooter.isWebActive) {
      this.webShooter.notifyReleased();
    }
    this.physics.winching = this.physics.winching && this.isSwinging;

    // Landing dip feel & soft/hard landing thuds (inspiration lines 198-201)
    if (!wasGrounded && this.physics.isGrounded) {
      const hSpeed = Math.hypot(this.physics.velocity.x, this.physics.velocity.z);
      if (hSpeed > 9.0) {
        this.physics.landGraceTimer = 0.4;
      }
      const impact = THREE.MathUtils.clamp(-fallSpeedBefore / 14.0, 0, 1.5);
      this.landDipSpring.kick(-impact * 4.0 - 0.4);
      if (fallSpeedBefore < -25) {
        this.physics.controlDampTimer = 0.25;
        this.addScreenShake(0.18);
        soundManager.playLandHard();
      } else if (fallSpeedBefore < -8) {
        this.addScreenShake(0.08);
        soundManager.playLandSoft();
      }
    }

    // Smooth eye level transition between standing (0.8) and crouching (0.35)
    const targetEye = this.isCrouching ? 0.35 : 0.8;
    this.eyeH = THREE.MathUtils.damp(this.eyeH, targetEye, 14.0, dt);

    // Apply vertical step bounce, lateral head sway, land dip spring to eye position
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.03 * this.bobAmt;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.018 * this.bobAmt;

    this.camera.position.copy(this.physics.position);
    this.camera.position.y += this.eyeH + this.landDipSpring.value * 0.07 + bobY;
    this.camera.position.addScaledVector(rightFlat, bobX);

    // Apply positional screen shake along lateral and vertical camera axes
    if (this.shakeAmt > 0.001) {
      const shk = Math.min(this.shakeAmt, 1.2);
      this.camera.position.addScaledVector(this._rightFlat, (Math.random() - 0.5) * shk * 0.07);
      this.camera.position.y += (Math.random() - 0.5) * shk * 0.07;
    }

    // Air time tracking
    if (!this.physics.isGrounded) this.airTime += dt;
    else this.airTime = 0;
    this.isMidAir = !this.physics.isGrounded;

    // 5. Sound: Wind rush, rope strain, and sub-30HP heartbeat modulation
    const currentSpeed = this.physics.velocity.length();
    soundManager.updateWind(currentSpeed, 45.0);
    soundManager.updateRopeStrain(this.isSwinging, currentSpeed, this.physics.isWebTaut ? 1.0 : 0.25);
    soundManager.setHeartbeat(this.health < 30 && this.health > 0 && !this.isDead);

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
      const speedT = Math.min(Math.max((currentSpeed - 6) / 30.0, 0), 1);
      const targetFov = this.baseFov + speedT * 22.0; // Kicks in past a sprint, widens to 97 at full swing
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, dt * 6.0);
    }
    const effectiveFov = this.currentFov + this.fovKick.value;
    if (Math.abs(this.camera.fov - effectiveFov) > 0.01) {
      this.camera.fov = effectiveFov;
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
    if (activeWep.type !== 'sword' && activeWep.currentAmmo === 0 && !activeWep.isReloading) {
      this.weaponManager.reload();
    }

    // 9. Weapon Firing (bullets test enemies AND walls so cover blocks shots)
    let fireResult: FireResult | null = null;
    const shouldFire = this.input.fireJustPressed ||
      ((activeWep.type === 'smg' || activeWep.type === 'sword') && this.input.isFiring());

    if (shouldFire) {
      const now = performance.now() * 0.001;
      const shootOrigin = this._tempVec.copy(this.camera.position);
      const shootDir = this._tempVec2.copy(forward);

      const targets = combatTargets ?? collidables;
      fireResult = this.weaponManager.fire(now, shootOrigin, shootDir, this.isSwinging, targets, {
        moving: isMoving,
        aiming: this.input.isZoomHolding() && !this.isSwinging,
      });

      if (fireResult) {
        this.applyFireRecoil(
          activeWep.camKick[0] * (isAiming ? 0.7 : 1.0),
          activeWep.camKick[1],
          activeWep.fovKick,
          activeWep.shakeAmount
        );
      }
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

  private resolveWorldCollisions(collidables: THREE.Object3D[], dt: number): void {
    const p = this.physics.position;
    const r = this.physics.playerRadius;

    if (this.worldCollider) {
      this.resolveWithShells(p, r, dt);
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
  private resolveWithShells(p: THREE.Vector3, r: number, dt: number): void {
    const coll = this.worldCollider as WorldCollider;
    const halfH = this.physics.playerHeight * 0.5;

    // A. Ground snap via floor shells (supports roofs, terraces, slabs, street, slopes)
    const feetY = p.y - halfH;
    const isFalling = this.physics.velocity.y <= 0.5;
    // When falling, dynamic sweep allowance prevents tunneling through fast falls
    const fallSweep = isFalling ? Math.max(0.55, Math.min(2.5, -this.physics.velocity.y * dt + 0.4)) : 0.55;
    const top = coll.groundAt(p.x, feetY, p.z, fallSweep);
    if (top !== null && isFalling && shouldSnapToGround(feetY, top, fallSweep, this.physics.isGrounded)) {
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
    } else if (top === null || feetY > top + 0.45) {
      if (this.physics.isGrounded) {
        this.physics.isGrounded = false;
        if (this.physics.mode === MovementMode.GROUNDED) this.physics.mode = MovementMode.AIR;
      }
    }

    // A2. Ceiling clamp: jumping up into a slab/terrace overhead stops the head.
    // Without this, slabs are one-way — you can leap straight through floors.
    if (this.physics.velocity.y > 0.5) {
      const headY = p.y + halfH + 0.1;
      const ceiling = coll.ceilingAt(p.x, headY, p.z);
      if (ceiling !== null && headY >= ceiling) {
        p.y = ceiling - halfH - 0.12;
        this.physics.velocity.y = 0;
        soundManager.playImpactWall();
      }
    }

    // B. Horizontal push-out against wall shells
    const push = this.pushScratch;
    coll.pushOut(p.x, p.z, r, p.y - halfH, p.y + halfH, push, this.physics.velocity.x, this.physics.velocity.z);
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

    // B1. Ledge / railing mantle assist:
    // When airborne, moving forward, not in grapple/zip, and approaching a standable railing or ledge top
    if (
      !this.physics.isGrounded &&
      this.mantleCooldown <= 0 &&
      this.input.isMovingForward() &&
      this.physics.mode === MovementMode.AIR &&
      this.physics.velocity.y < 7.0
    ) {
      const fwd = this._forwardFlat;
      const probeDist = 0.55;
      const aheadX = p.x + fwd.x * probeDist;
      const aheadZ = p.z + fwd.z * probeDist;
      const probeTop = coll.groundAt(aheadX, feetY + 1.25, aheadZ, 1.4);
      if (probeTop !== null) {
        const dy = probeTop - feetY;
        if (dy >= 0.35 && dy <= 1.35) {
          const ceil = coll.ceilingAt(aheadX, probeTop + this.physics.playerHeight, aheadZ);
          if (ceil === null || ceil >= probeTop + this.physics.playerHeight) {
            // Smooth vault pop onto ledge / railing
            this.physics.velocity.y = Math.min(8.5, Math.sqrt(2 * 28.0 * (dy + 0.25)));
            this.physics.velocity.x = fwd.x * 3.2;
            this.physics.velocity.z = fwd.z * 3.2;
            this.mantleCooldown = 0.5;
            soundManager.playLandSoft();
          }
        }
      }
    }

    // B2. Head-bump: when moving upward and a wall box overlaps the head band but not lower torso
    if (this.physics.velocity.y > 0) {
      const headMinY = p.y + halfH - 0.4;
      const headMaxY = p.y + halfH + 0.3;
      const headPush = this.headPushScratch;
      coll.pushOut(p.x, p.z, r * 0.8, headMinY, headMaxY, headPush, this.physics.velocity.x, this.physics.velocity.z);

      if (headPush.pushed) {
        // If the wall does NOT overlap lower torso/feet, player's head hit an overhang/ceiling
        const torsoPush = this.torsoPushScratch;
        coll.pushOut(p.x, p.z, r * 0.8, p.y - halfH, p.y + halfH - 0.5, torsoPush, this.physics.velocity.x, this.physics.velocity.z);
        if (!torsoPush.pushed) {
          this.physics.velocity.y = 0;
          soundManager.playImpactWall();
        }
      }
    }

    // B3. Wall-run entry: airborne + fast + holding forward + side contact
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

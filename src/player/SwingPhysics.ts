import * as THREE from 'three';

export interface WebAnchor {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  object?: THREE.Object3D;
  isLedge?: boolean;
}

export enum MovementMode {
  GROUNDED,
  AIR,
  SWINGING,
  WEB_ZIPPING,
  WALL_RUNNING,
  WALL_SLIDING
}

export class SwingPhysics {
  // =========================================================================
  // TUNING & PHYSICS ARCHITECTURE (GAME_PLAN.md sections 6, 7, 24.1, 30)
  //
  // CONSTRAINT + SPRING ROPE MODEL (Junior Engineer Reference):
  // 1. Distance check: toPlayer = pos - anchor, currentDist = |toPlayer|, ropeDir = toPlayer / currentDist.
  // 2. Slack state: if currentDist < ropeLength, rope is slack (isWebTaut=false); gravity applies freely.
  // 3. Slack auto-release: if slack persists continuously for >0.5s, web auto-releases to prevent dead hangs.
  // 4. Taut constraint: if currentDist >= ropeLength (isWebTaut=true), radial outgoing velocity (v . ropeDir > 0)
  //    is strictly zeroed out, simulating an inextensible cable constraint.
  // 5. Spring restorative force: stretch = currentDist - ropeLength; force = stretch * webSpringConstant (280 N/m)
  //    pulls inward toward anchor along -ropeDir.
  // 6. Viscous damping: dampForce = radialSpeed * webDamping (18 Ns/m) suppresses longitudinal rope bounce.
  // 7. Centripetal acceleration: a_c = (v_tangent^2 / r) directed along -ropeDir keeps circular arc trajectory stable.
  // 8. Integration position clamp: soft snap pos = anchor + ropeDir * (ropeLength + stretch * 0.15) prevents drift.
  // 9. Tangential pumping: holding W projects inputDir onto plane orthogonal to ropeDir, applying pumpPower (20 m/s^2).
  // 10. Reel rates: reel-in (Shift) shortens rope at 16 m/s; reel-out (Ctrl/X) lengthens at 14 m/s (clamped 6..90m).
  //
  // FINAL DESIGN & TUNING DECISIONS (Section 24.1):
  // - Walk speed (14.0 m/s): KEPT at 14.0. Reason: With Shift dedicated strictly to web reel-in (no sprint key),
  //   a standard 7.0 m/s human walk feels sluggish across 50-80m skyscraper gaps. 14.0 m/s gives Spider-Man level
  //   parkour agility on roofs/streets, reaches full speed in 0.25s (friction 12), and ADS slows to 60% (8.4 m/s).
  // - Air brake rate (36.0 m/s^2): 2x base air acceleration (18.0 * 2.0). Holding S/back in mid-air bleeds horizontal
  //   speed down to zero smoothly in ~0.7s from 25 m/s, providing precise perch landing without reversing direction.
  // - Dive rate (+16.0 m/s^2 down, +8.0 m/s^2 forward, 0.5 rad/s pitch assist): Holding Ctrl in air adds downward
  //   momentum assist + forward glide for high-speed dive-bombs, strictly clamped at terminalVelocity (65.0 m/s).
  // - Zip ease curve (5.0m -> 2.5m, 62 m/s -> 28 m/s): Linear ease over final 5 meters ensures player arrives at
  //   mantle threshold smoothly so landing stick checks succeed without high-speed tunneling through colliders.
  // =========================================================================

  // World constants
  public gravity: number = 26.0; // Snappy superhero gravity (m/s^2)
  public airDrag: number = 0.004; // Quadratic air resistance
  public terminalVelocity: number = 65.0; // Max fall speed (m/s)

  // Player state
  public position: THREE.Vector3 = new THREE.Vector3(0, 10, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public mode: MovementMode = MovementMode.AIR;

  // Web swing state
  public webAnchor: THREE.Vector3 | null = null;
  public webAnchorNormal: THREE.Vector3 | null = null;
  public ropeLength: number = 0;
  public minRopeLength: number = 6.0;
  public maxRopeLength: number = 90.0;
  public isWebTaut: boolean = false;
  public swingTime: number = 0;
  public webSpringConstant: number = 280.0; // Web elasticity
  public webDamping: number = 18.0;

  // Slack auto-release timer (continuous slack for 0.5s auto-releases web)
  public slackTimer: number = 0;
  public maxSlackTime: number = 0.5;

  // Hard-landing control damp timer (0.25s control damp after landing > 25 m/s)
  public controlDampTimer: number = 0;

  // Air brake rate multiplier (2x faster horizontal speed bleed)
  public airBrakeMultiplier: number = 2.0;

  // Web zip state
  public zipTarget: THREE.Vector3 | null = null;
  public zipSpeed: number = 62.0; // Rapid zip pull speed
  public zipProgress: number = 0;
  public zipStartPos: THREE.Vector3 = new THREE.Vector3();

  // Wall run state
  public wallNormal: THREE.Vector3 = new THREE.Vector3();
  public wallRunTimer: number = 0;
  public maxWallRunTime: number = 2.5;

  // Ground check
  public isGrounded: boolean = false;
  public playerHeight: number = 1.8;
  public playerRadius: number = 0.6;

  // ADS move-slow multiplier (set per-frame by Player, 1 = full speed)
  public speedMultiplier: number = 1.0;

  // Feel helpers (set by Player)
  public coyoteTimer: number = 0;
  public jumpBufferTimer: number = 0;

  // Temporary vectors for zero-garbage physics computation
  private _tempVecA: THREE.Vector3 = new THREE.Vector3();
  private _tempVecB: THREE.Vector3 = new THREE.Vector3();
  private _tempVecC: THREE.Vector3 = new THREE.Vector3();

  constructor() {}

  /**
   * Attaches web to an anchor point in the city
   */
  public attachWeb(point: THREE.Vector3, normal?: THREE.Vector3): void {
    if (!Number.isFinite(point.x + point.y + point.z)) return;
    this.webAnchor = point.clone();
    this.webAnchorNormal = normal ? normal.clone() : new THREE.Vector3(0, 1, 0);
    
    // Initial rope length is current distance, clamped to usable range
    const dist = this.position.distanceTo(point);
    if (dist < 3.0) return;
    this.ropeLength = THREE.MathUtils.clamp(dist, this.minRopeLength, this.maxRopeLength);
    this.mode = MovementMode.SWINGING;
    this.swingTime = 0;
    this.slackTimer = 0;
    this.isWebTaut = true;

    // Slight momentum redirect toward swing tangent to ensure immediate smooth arc
    const toAnchor = this._tempVecA.subVectors(point, this.position).normalize();
    const radialSpeed = this.velocity.dot(toAnchor);
    if (radialSpeed < 0) {
      // If moving away from anchor, zero out outgoing velocity for instant tension
      this.velocity.addScaledVector(toAnchor, -radialSpeed * 0.75);
    }
  }

  /**
   * Releases active web line with momentum preservation and slingshot boost
   */
  public releaseWeb(jumpBoost: boolean = false, lookDir?: THREE.Vector3): THREE.Vector3 {
    if (!this.webAnchor) return this.velocity;

    this.mode = MovementMode.AIR;
    this.slackTimer = 0;
    const releasedVel = this.velocity.clone();

    // If released on upward swing with jump button, apply slingshot impulse
    if (jumpBoost) {
      const upVelocity = Math.max(this.velocity.y, 0);
      const forwardBoost = 8.0;
      const verticalBoost = 7.0 + upVelocity * 0.25;

      if (lookDir) {
        const flatLook = this._tempVecA.set(lookDir.x, 0, lookDir.z).normalize();
        this.velocity.addScaledVector(flatLook, forwardBoost);
      }
      this.velocity.y += verticalBoost;
    }

    this.webAnchor = null;
    this.webAnchorNormal = null;
    this.isWebTaut = false;

    return releasedVel;
  }

  /**
   * Initiates high-speed web zip toward an anchor / ledge
   */
  public startWebZip(target: THREE.Vector3): void {
    this.zipTarget = target.clone();
    this.zipStartPos.copy(this.position);
    this.mode = MovementMode.WEB_ZIPPING;
    this.zipProgress = 0;
    // Detach swing if any
    this.webAnchor = null;
    this.slackTimer = 0;
  }

  /**
   * Cancels active web zip into a swing-style release boost along look direction
   */
  public cancelWebZip(lookDir?: THREE.Vector3): THREE.Vector3 {
    if (this.mode !== MovementMode.WEB_ZIPPING) return this.velocity;
    this.mode = MovementMode.AIR;
    this.zipTarget = null;

    const forwardBoost = 10.0;
    const verticalBoost = 8.0;

    if (lookDir) {
      const flatLook = this._tempVecA.set(lookDir.x, 0, lookDir.z).normalize();
      this.velocity.addScaledVector(flatLook, forwardBoost);
    }
    this.velocity.y = Math.max(this.velocity.y, 0) + verticalBoost;

    // Cap at terminal velocity
    if (this.velocity.length() > this.terminalVelocity) {
      this.velocity.normalize().multiplyScalar(this.terminalVelocity);
    }

    return this.velocity;
  }

  /**
   * Updates physics simulation step
   */
  public update(
    dt: number,
    inputDir: THREE.Vector3, // Movement input relative to camera
    lookDir: THREE.Vector3,
    isReelingIn: boolean,
    isReelingOut: boolean,
    braking: boolean = false,
    diving: boolean = false
  ): void {
    // Clamp dt to prevent tunneling on frame drops
    const clampedDt = Math.min(dt, 0.05);

    // Decay hard landing control damp timer
    if (this.controlDampTimer > 0) {
      this.controlDampTimer = Math.max(0, this.controlDampTimer - clampedDt);
    }

    switch (this.mode) {
      case MovementMode.SWINGING:
        this.updateSwinging(clampedDt, inputDir, lookDir, isReelingIn, isReelingOut);
        break;
      case MovementMode.WEB_ZIPPING:
        this.updateWebZip(clampedDt);
        return;
      case MovementMode.WALL_RUNNING:
        this.updateWallRun(clampedDt, inputDir, lookDir);
        break;
      case MovementMode.GROUNDED:
        this.updateGrounded(clampedDt, inputDir);
        break;
      case MovementMode.AIR:
      default:
        this.updateAir(clampedDt, inputDir, lookDir, braking, diving);
        break;
    }

    // Apply quadratic air drag across all non-ground modes
    if (this.mode !== MovementMode.GROUNDED) {
      const speed = this.velocity.length();
      if (speed > 0.01) {
        const dragMagnitude = 0.5 * this.airDrag * speed * speed;
        const dragFactor = Math.max(0, 1 - (dragMagnitude * clampedDt) / speed);
        this.velocity.multiplyScalar(dragFactor);
      }
    }

    // Cap at terminal velocity
    if (this.velocity.length() > this.terminalVelocity) {
      this.velocity.normalize().multiplyScalar(this.terminalVelocity);
    }

    // Integrate position
    this.position.addScaledVector(this.velocity, clampedDt);
  }

  /**
   * Pendulum swing physics with tension, centrifugal force, pumping, and reel
   */
  private updateSwinging(
    dt: number,
    inputDir: THREE.Vector3,
    lookDir: THREE.Vector3,
    isReelingIn: boolean,
    isReelingOut: boolean
  ): void {
    if (!this.webAnchor) return;
    this.swingTime += dt;

    // 1. Reel in / let out rope
    if (isReelingIn && this.ropeLength > this.minRopeLength) {
      this.ropeLength = Math.max(this.minRopeLength, this.ropeLength - 16.0 * dt);
    } else if (isReelingOut && this.ropeLength < this.maxRopeLength) {
      this.ropeLength = Math.min(this.maxRopeLength, this.ropeLength + 14.0 * dt);
    }

    // 2. Vector from anchor to player
    const toPlayer = this._tempVecA.subVectors(this.position, this.webAnchor);
    const currentDist = toPlayer.length();
    const ropeDir = this._tempVecB.copy(toPlayer).normalize(); // Points from anchor to player

    // Apply gravity
    this.velocity.y -= this.gravity * dt;

    // 3. Check rope constraint & slack auto-release
    if (currentDist >= this.ropeLength) {
      this.isWebTaut = true;
      this.slackTimer = 0;

      // Radial velocity component (along rope outwards)
      const radialSpeed = this.velocity.dot(ropeDir);

      if (radialSpeed > 0) {
        // Remove outgoing velocity (rigid cable tension constraint)
        this.velocity.addScaledVector(ropeDir, -radialSpeed);
      }

      // Spring-damper tension force pulling player back toward max length
      const stretch = currentDist - this.ropeLength;
      if (stretch > 0) {
        const springForce = stretch * this.webSpringConstant;
        const dampForce = radialSpeed * this.webDamping;
        const totalTension = (springForce + dampForce) * dt;
        this.velocity.addScaledVector(ropeDir, -totalTension);

        // Soft position snap to avoid excessive stretching
        this.position.copy(this.webAnchor).addScaledVector(ropeDir, this.ropeLength + stretch * 0.15);
      }

      // Centripetal acceleration: v_tangent^2 / r directed toward anchor (-ropeDir)
      const speedSq = this.velocity.lengthSq();
      if (currentDist > 0.1) {
        const centripetalAcc = speedSq / currentDist;
        this.velocity.addScaledVector(ropeDir, -centripetalAcc * dt * 0.4);
      }
    } else {
      this.isWebTaut = false;
      this.slackTimer += dt;
      // Auto-release without boost if slack continuously for 0.5s
      if (this.slackTimer >= this.maxSlackTime) {
        this.releaseWeb(false);
        this.slackTimer = 0;
        return;
      }
    }

    // 4. Momentum Pumping (holding W accelerates along tangent)
    if (inputDir.lengthSq() > 0.01) {
      // Tangent vector forward: project input direction onto plane perpendicular to rope
      const tangentInput = this._tempVecC.copy(inputDir);
      const ropeComponent = tangentInput.dot(ropeDir);
      tangentInput.addScaledVector(ropeDir, -ropeComponent).normalize();

      // Pumping acceleration
      const pumpPower = 20.0;
      this.velocity.addScaledVector(tangentInput, pumpPower * dt);
    }

    // 5. Downward swing assist: at lowest point of swing, add forward swing thrust
    if (ropeDir.y < -0.65 && this.velocity.y < 0) {
      // Falling near nadir: accelerate forward in look direction
      const forwardThrust = this._tempVecC.set(lookDir.x, 0, lookDir.z).normalize();
      this.velocity.addScaledVector(forwardThrust, 12.0 * dt);
    }
  }

  /**
   * High-speed zip directly to target ledge / anchor with ease-out
   */
  private updateWebZip(dt: number): void {
    if (!this.zipTarget) {
      this.mode = MovementMode.AIR;
      return;
    }

    const toTarget = this._tempVecA.subVectors(this.zipTarget, this.position);
    const dist = toTarget.length();

    if (dist < 2.5) {
      // Reached destination: launch upward and forward into a clean mantle
      this.mode = MovementMode.AIR;
      const flat = this._tempVecB.set(toTarget.x, 0, toTarget.z);
      if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
      flat.normalize();
      this.velocity.copy(flat).multiplyScalar(16.0);
      this.velocity.y = 12.0; // Vault pop
      this.zipTarget = null;
      this.isGrounded = false;
      return;
    }

    // Ease-out over the last 5 meters (from 5m down to 2.5m) so landings stick cleanly
    const easeScale = dist < 5.0 ? THREE.MathUtils.clamp((dist - 2.5) / 2.5 * 0.55 + 0.45, 0.45, 1.0) : 1.0;
    const currentZipSpeed = this.zipSpeed * easeScale;

    // High velocity pull — move directly so we can't stall on drag
    toTarget.normalize();
    this.velocity.copy(toTarget).multiplyScalar(currentZipSpeed);
    this.position.addScaledVector(this.velocity, dt);
    this.velocity.multiplyScalar(0.55);
  }

  /**
   * Wall run along vertical skyscraper surfaces
   */
  private updateWallRun(dt: number, inputDir: THREE.Vector3, lookDir: THREE.Vector3): void {
    this.wallRunTimer += dt;

    if (this.wallRunTimer > this.maxWallRunTime) {
      // Wall run expired: kick off wall
      this.detachFromWall();
      return;
    }

    // Maintain horizontal speed along wall tangent
    // Wall tangent: cross normal with up vector
    const up = this._tempVecA.set(0, 1, 0);
    const wallTangent = this._tempVecB.crossVectors(this.wallNormal, up).normalize();

    // Determine forward direction along wall tangent based on look direction
    if (lookDir.dot(wallTangent) < 0) {
      wallTangent.negate();
    }

    // Wall run velocity: run speed along tangent, slight downward gravity
    const wallRunSpeed = 16.0;
    this.velocity.copy(wallTangent).multiplyScalar(wallRunSpeed);
    this.velocity.y = -3.0; // Slow descent
  }

  /**
   * Wall jump kick-off
   */
  public wallJump(): void {
    this.mode = MovementMode.AIR;
    // Impulse outward along wall normal + upward
    this.velocity.addScaledVector(this.wallNormal, 14.0);
    this.velocity.y = 14.0;
    this.wallRunTimer = 0;
  }

  public detachFromWall(): void {
    this.mode = MovementMode.AIR;
    this.velocity.addScaledVector(this.wallNormal, 4.0);
    this.velocity.y = 2.0;
    this.wallRunTimer = 0;
  }

  /**
   * Standard airborne physics with responsive air control, air brake, and diving
   */
  private updateAir(
    dt: number,
    inputDir: THREE.Vector3,
    lookDir: THREE.Vector3,
    braking: boolean = false,
    diving: boolean = false
  ): void {
    // Gravity
    this.velocity.y -= this.gravity * dt;

    // Air steering control (halved if control-damped after hard landing)
    const accelDamp = this.controlDampTimer > 0 ? 0.5 : 1.0;
    const baseAirAccel = 18.0 * accelDamp;

    // Air brake: holding S/back in midair bleeds horizontal speed 2x faster (36 m/s^2)
    if (braking) {
      const hVel = this._tempVecA.set(this.velocity.x, 0, this.velocity.z);
      const hSpeed = hVel.length();
      if (hSpeed > 0.01) {
        const brakeDecel = baseAirAccel * this.airBrakeMultiplier;
        const newSpeed = Math.max(0, hSpeed - brakeDecel * dt);
        const factor = newSpeed / hSpeed;
        this.velocity.x *= factor;
        this.velocity.z *= factor;
      }
    } else if (inputDir.lengthSq() > 0.01) {
      this.velocity.addScaledVector(inputDir, baseAirAccel * dt);
    }

    // Dive: holding Ctrl in air adds downward speed + forward assist
    if (diving) {
      this.velocity.y -= 16.0 * dt;
      const flatLook = this._tempVecB.set(lookDir.x, 0, lookDir.z);
      if (flatLook.lengthSq() > 1e-4) {
        flatLook.normalize();
        this.velocity.addScaledVector(flatLook, 8.0 * dt);
      }
    }

    // Cap downward speed to terminal velocity
    if (this.velocity.y < -this.terminalVelocity) {
      this.velocity.y = -this.terminalVelocity;
    }
  }

  /**
   * Ground movement with friction, acceleration, and step handling
   */
  private updateGrounded(dt: number, inputDir: THREE.Vector3): void {
    // Ground friction
    const friction = 12.0;
    const horizontalVel = this._tempVecA.set(this.velocity.x, 0, this.velocity.z);
    horizontalVel.multiplyScalar(Math.max(0, 1 - friction * dt));
    this.velocity.x = horizontalVel.x;
    this.velocity.z = horizontalVel.z;

    // Ground acceleration (halved if control-damped after hard landing)
    if (inputDir.lengthSq() > 0.01) {
      const accelDamp = this.controlDampTimer > 0 ? 0.5 : 1.0;
      const groundSpeed = 14.0 * this.speedMultiplier;
      const targetVel = this._tempVecB.copy(inputDir).normalize().multiplyScalar(groundSpeed);
      this.velocity.x += (targetVel.x - this.velocity.x) * (14.0 * accelDamp) * dt;
      this.velocity.z += (targetVel.z - this.velocity.z) * (14.0 * accelDamp) * dt;
    }

    this.velocity.y = 0;
  }

  /**
   * Ground jump
   */
  public jump(): void {
    if (this.isGrounded || this.coyoteTimer > 0) {
      this.velocity.y = 13.5;
      this.isGrounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.mode = MovementMode.AIR;
    }
  }

  public reset(spawn: THREE.Vector3): void {
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.mode = MovementMode.AIR;
    this.webAnchor = null;
    this.webAnchorNormal = null;
    this.zipTarget = null;
    this.isWebTaut = false;
    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.wallRunTimer = 0;
    this.slackTimer = 0;
    this.controlDampTimer = 0;
  }

  /**
   * Checks collision with ground plane or city rooftops
   */
  public resolveGround(groundY: number): void {
    const feetY = this.position.y - this.playerHeight * 0.5;
    if (feetY <= groundY) {
      this.position.y = groundY + this.playerHeight * 0.5;
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
      this.isGrounded = true;
      if (this.mode === MovementMode.AIR || this.mode === MovementMode.SWINGING) {
        this.mode = MovementMode.GROUNDED;
        this.webAnchor = null;
        this.slackTimer = 0;
      }
    } else {
      if (this.isGrounded && feetY > groundY + 0.1) {
        this.isGrounded = false;
        if (this.mode === MovementMode.GROUNDED) {
          this.mode = MovementMode.AIR;
        }
      }
    }
  }
}

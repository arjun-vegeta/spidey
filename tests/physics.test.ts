import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SwingPhysics, MovementMode } from '../src/player/SwingPhysics';

describe('SwingPhysics - Realistic Pendulum Web Mechanics', () => {
  let physics: SwingPhysics;

  beforeEach(() => {
    physics = new SwingPhysics();
    physics.position.set(0, 20, 0);
    physics.velocity.set(0, 0, 0);
    physics.mode = MovementMode.AIR;
  });

  it('attaches web to building anchor point and sets taut state', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    physics.attachWeb(anchor);

    expect(physics.mode).toBe(MovementMode.SWINGING);
    expect(physics.webAnchor).not.toBeNull();
    expect(physics.ropeLength).toBeGreaterThanOrEqual(10);
    expect(physics.isWebTaut).toBe(true);
  });

  it('applies tension constraint and removes outgoing radial velocity', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    physics.attachWeb(anchor);

    // Give player high downward and outward velocity
    physics.velocity.set(15, -10, 0);
    const dt = 0.016;
    const inputDir = new THREE.Vector3(0, 0, 0);
    const lookDir = new THREE.Vector3(1, 0, 0);

    // Step physics
    physics.update(dt, inputDir, lookDir, false, false);

    // Distance from anchor should be constrained near rope length
    const currentDist = physics.position.distanceTo(anchor);
    expect(currentDist).toBeLessThanOrEqual(physics.ropeLength + 0.5);
  });

  it('pumping forward (holding W) adds tangential acceleration', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    physics.attachWeb(anchor);
    physics.position.set(-10, 20, 0); // Displaced to the left

    const dt = 0.02;
    const inputForward = new THREE.Vector3(1, 0, 0);
    const lookForward = new THREE.Vector3(1, 0, 0);

    const initialSpeed = physics.velocity.length();
    // Update multiple steps pumping forward
    for (let i = 0; i < 5; i++) {
      physics.update(dt, inputForward, lookForward, false, false);
    }

    const finalSpeed = physics.velocity.length();
    expect(finalSpeed).toBeGreaterThan(initialSpeed);
  });

  it('releasing web with jump button applies apex slingshot boost', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    physics.attachWeb(anchor);
    physics.velocity.set(12, 8, 0); // Moving up and forward

    const lookDir = new THREE.Vector3(1, 0, 0);
    physics.releaseWeb(true, lookDir);

    expect(physics.mode).toBe(MovementMode.AIR);
    expect(physics.webAnchor).toBeNull();
    // Vertical velocity should have boost added
    expect(physics.velocity.y).toBeGreaterThan(8);
  });

  it('web zip propels player directly toward target', () => {
    const target = new THREE.Vector3(20, 35, -10);
    physics.startWebZip(target);

    expect(physics.mode).toBe(MovementMode.WEB_ZIPPING);
    expect(physics.zipTarget).not.toBeNull();

    physics.update(0.02, new THREE.Vector3(), new THREE.Vector3(), false, false);

    // Velocity should be directed straight toward zip target
    const toTarget = target.clone().sub(physics.position).normalize();
    const velDir = physics.velocity.clone().normalize();
    expect(velDir.dot(toTarget)).toBeGreaterThan(0.99);
  });

  it('eases out zip speed in the final 5 meters before arrival', () => {
    // 1. Far target (50m away) - should pull at full zipSpeed (62 m/s)
    const farTarget = new THREE.Vector3(50, 20, 0);
    physics.startWebZip(farTarget);
    physics.update(0.016, new THREE.Vector3(), new THREE.Vector3(), false, false);
    const farSpeed = physics.velocity.length() / 0.55; // account for 0.55 integration damping
    expect(farSpeed).toBeCloseTo(physics.zipSpeed, 1);

    // 2. Near target (3.5m away, inside final 5m ease window)
    const nearTarget = new THREE.Vector3(3.5, 20, 0);
    physics.startWebZip(nearTarget);
    physics.update(0.016, new THREE.Vector3(), new THREE.Vector3(), false, false);
    const nearSpeed = physics.velocity.length() / 0.55;
    expect(nearSpeed).toBeLessThan(physics.zipSpeed * 0.9);
    expect(nearSpeed).toBeGreaterThanOrEqual(physics.zipSpeed * 0.45);
  });

  it('cancels web zip with swing-style forward and vertical boost', () => {
    const target = new THREE.Vector3(0, 30, 0);
    physics.startWebZip(target);
    expect(physics.mode).toBe(MovementMode.WEB_ZIPPING);

    const lookDir = new THREE.Vector3(0, 0, -1);
    physics.cancelWebZip(lookDir);

    expect(physics.mode).toBe(MovementMode.AIR);
    expect(physics.zipTarget).toBeNull();
    // Upward boost (8.0) and forward boost (10.0) along look direction
    expect(physics.velocity.y).toBeGreaterThanOrEqual(8.0);
    expect(physics.velocity.z).toBeLessThanOrEqual(-9.0);
  });

  it('auto-releases web line when slack persists for 0.5s continuously', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    physics.attachWeb(anchor);
    expect(physics.mode).toBe(MovementMode.SWINGING);

    // Position player directly below anchor closer than rope length (slack)
    physics.position.set(0, 25, 0); // distance is 5m, ropeLength clamped to min 6m
    physics.velocity.set(0, 0, 0);

    // Step 0.3s of slack — should still be swinging
    for (let i = 0; i < 15; i++) {
      physics.update(0.02, new THREE.Vector3(), new THREE.Vector3(), false, false);
    }
    expect(physics.isWebTaut).toBe(false);
    expect(physics.mode).toBe(MovementMode.SWINGING);
    expect(physics.slackTimer).toBeGreaterThan(0.25);

    // Step another 0.25s (total > 0.5s) — should auto-release to AIR mode
    for (let i = 0; i < 15; i++) {
      physics.update(0.02, new THREE.Vector3(), new THREE.Vector3(), false, false);
    }
    expect(physics.mode).toBe(MovementMode.AIR);
    expect(physics.webAnchor).toBeNull();
  });

  it('air brake (holding S) bleeds horizontal speed 2x faster than normal flight', () => {
    // Setup two identical air physics states with high forward horizontal speed
    const freeAir = new SwingPhysics();
    freeAir.position.set(0, 100, 0);
    freeAir.velocity.set(0, 0, -30);
    freeAir.mode = MovementMode.AIR;

    const brakingAir = new SwingPhysics();
    brakingAir.position.set(0, 100, 0);
    brakingAir.velocity.set(0, 0, -30);
    brakingAir.mode = MovementMode.AIR;

    const dt = 0.05;
    const lookDir = new THREE.Vector3(0, 0, -1);
    const zeroInput = new THREE.Vector3(0, 0, 0);

    // Step 5 frames: free air has no braking, brakingAir has braking = true
    for (let i = 0; i < 5; i++) {
      freeAir.update(dt, zeroInput, lookDir, false, false, false, false);
      brakingAir.update(dt, zeroInput, lookDir, false, false, true, false);
    }

    const freeHorizSpeed = Math.hypot(freeAir.velocity.x, freeAir.velocity.z);
    const brakingHorizSpeed = Math.hypot(brakingAir.velocity.x, brakingAir.velocity.z);

    // Braking air must have bled significantly more horizontal speed
    expect(brakingHorizSpeed).toBeLessThan(freeHorizSpeed);
    expect(freeHorizSpeed - brakingHorizSpeed).toBeGreaterThan(2.5);
  });

  it('diving in air increases downward speed and forward assist within terminal velocity', () => {
    physics.position.set(0, 100, 0);
    physics.velocity.set(0, -10, 0);
    physics.mode = MovementMode.AIR;

    const lookDir = new THREE.Vector3(0, 0, -1);
    const dt = 0.05;

    // Normal airborne fall
    const normal = new SwingPhysics();
    normal.position.set(0, 100, 0);
    normal.velocity.set(0, -10, 0);
    normal.mode = MovementMode.AIR;

    normal.update(dt, new THREE.Vector3(), lookDir, false, false, false, false);
    physics.update(dt, new THREE.Vector3(), lookDir, false, false, false, true);

    // Diving gains downward speed faster and gains forward momentum
    expect(physics.velocity.y).toBeLessThan(normal.velocity.y);
    expect(physics.velocity.z).toBeLessThan(normal.velocity.z);

    // Dive cannot exceed terminal velocity
    physics.velocity.set(0, -70, 0);
    physics.update(dt, new THREE.Vector3(), lookDir, false, false, false, true);
    expect(physics.velocity.length()).toBeLessThanOrEqual(physics.terminalVelocity + 1e-3);
  });

  it('halves input acceleration response during control damp after hard landing', () => {
    physics.mode = MovementMode.GROUNDED;
    physics.isGrounded = true;
    physics.controlDampTimer = 0.25;

    const inputDir = new THREE.Vector3(0, 0, -1);
    physics.update(0.016, inputDir, new THREE.Vector3(), false, false);
    const dampedSpeed = physics.velocity.length();

    // Undamped physics
    const undamped = new SwingPhysics();
    undamped.mode = MovementMode.GROUNDED;
    undamped.isGrounded = true;
    undamped.controlDampTimer = 0;
    undamped.update(0.016, inputDir, new THREE.Vector3(), false, false);
    const undampedSpeed = undamped.velocity.length();

    // Damped acceleration rate should produce approximately half the acceleration
    expect(dampedSpeed).toBeLessThan(undampedSpeed * 0.7);
  });

  it('resolves ground contact and sets isGrounded flag', () => {
    physics.position.set(0, 0.5, 0);
    physics.velocity.set(0, -10, 0);
    physics.resolveGround(0.9);

    expect(physics.isGrounded).toBe(true);
    expect(physics.velocity.y).toBe(0);
    expect(physics.position.y).toBe(0.9 + physics.playerHeight * 0.5);
  });

  it('walks like a human: grounded top speed caps at walk speed', () => {
    physics.mode = MovementMode.GROUNDED;
    physics.isGrounded = true;
    const inputDir = new THREE.Vector3(0, 0, -1);
    for (let i = 0; i < 180; i++) {
      physics.update(0.016, inputDir, new THREE.Vector3(), false, false);
    }
    const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
    expect(speed).toBeGreaterThan(4.0);
    expect(speed).toBeLessThanOrEqual(physics.walkSpeed + 0.2);
  });

  it('air steering without a web is a nudge, not flight', () => {
    physics.position.set(0, 100, 0);
    physics.velocity.set(0, 0, 0);
    physics.mode = MovementMode.AIR;
    const inputDir = new THREE.Vector3(0, 0, -1);
    for (let i = 0; i < 60; i++) {
      physics.update(0.016, inputDir, new THREE.Vector3(), false, false, false, false);
    }
    const gained = Math.hypot(physics.velocity.x, physics.velocity.z);
    expect(gained).toBeLessThan(8.0);
  });

  it('sprints at 10.6 m/s via speed multiplier, crouch-shuffles at 3.6', () => {
    const inputDir = new THREE.Vector3(0, 0, -1);

    const sprinter = new SwingPhysics();
    sprinter.mode = MovementMode.GROUNDED;
    sprinter.isGrounded = true;
    sprinter.speedMultiplier = sprinter.sprintMultiplier;
    for (let i = 0; i < 180; i++) {
      sprinter.update(0.016, inputDir, new THREE.Vector3(), false, false);
    }
    const sprintSpeed = Math.hypot(sprinter.velocity.x, sprinter.velocity.z);
    expect(sprintSpeed).toBeGreaterThan(9.0);
    expect(sprintSpeed).toBeLessThanOrEqual(11.0);

    const croucher = new SwingPhysics();
    croucher.mode = MovementMode.GROUNDED;
    croucher.isGrounded = true;
    croucher.crouching = true;
    for (let i = 0; i < 180; i++) {
      croucher.update(0.016, inputDir, new THREE.Vector3(), false, false);
    }
    const crouchSpeed = Math.hypot(croucher.velocity.x, croucher.velocity.z);
    expect(crouchSpeed).toBeGreaterThan(2.5);
    expect(crouchSpeed).toBeLessThanOrEqual(4.0);
  });

  it('winching reels straight to the anchor and pops the line on arrival', () => {
    const anchor = new THREE.Vector3(0, 40, 0);
    physics.position.set(0, 20, 0);
    physics.velocity.set(5, 0, 0);
    physics.attachWeb(anchor);
    expect(physics.mode).toBe(MovementMode.SWINGING);

    physics.winching = true;
    physics.update(0.05, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), false, false);
    expect(physics.mode).toBe(MovementMode.SWINGING);
    expect(physics.velocity.y).toBeGreaterThan(20);
    expect(Math.abs(physics.velocity.x)).toBeLessThan(1);

    // Near the anchor: arrival releases the line with an upward vault
    physics.position.set(0, 39, 0);
    physics.velocity.set(0, -5, 0);
    physics.update(0.05, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), false, false);
    expect(physics.mode).toBe(MovementMode.AIR);
    expect(physics.webAnchor).toBeNull();
    expect(physics.winching).toBe(false);
    expect(physics.velocity.y).toBeGreaterThanOrEqual(2.9);
  });

  it('slings toward the anchor on Space while swinging', () => {
    const anchor = new THREE.Vector3(10, 30, 0);
    physics.position.set(0, 20, 0);
    physics.velocity.set(2, 0, 0);
    physics.attachWeb(anchor);
    expect(physics.mode).toBe(MovementMode.SWINGING);

    physics.slingTowardAnchor(new THREE.Vector3(1, 0, 0));

    expect(physics.mode).toBe(MovementMode.AIR);
    expect(physics.webAnchor).toBeNull();
    const toAnchor = anchor.clone().sub(new THREE.Vector3(0, 20, 0)).normalize();
    const velDir = physics.velocity.clone().normalize();
    expect(velDir.dot(toAnchor)).toBeGreaterThan(0.9);
    expect(physics.velocity.length()).toBeGreaterThanOrEqual(15.0);
  });
});

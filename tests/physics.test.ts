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

  it('resolves ground contact and sets isGrounded flag', () => {
    physics.position.set(0, 0.5, 0);
    physics.velocity.set(0, -10, 0);
    physics.resolveGround(0.9);

    expect(physics.isGrounded).toBe(true);
    expect(physics.velocity.y).toBe(0);
    expect(physics.position.y).toBe(0.9 + physics.playerHeight * 0.5);
  });
});

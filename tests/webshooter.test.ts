import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { scoreAnchor, RopeState, WebShooter } from '../src/player/WebShooter';
import { SwingPhysics, MovementMode } from '../src/player/SwingPhysics';
import { CityBuilder } from '../src/world/CityBuilder';
import { WorldCollider } from '../src/world/WorldCollider';

describe('WebShooter - scoreAnchor Pure Function & Scoring System', () => {
  it('computes exact base score for centered anchor with zero height bonus', () => {
    const angle = 0;
    const dist = 55;
    const maxDist = 110;
    const score = scoreAnchor(angle, dist, maxDist, 0);
    // 0 * 0.65 + (55 / 110) * 0.35 - 0 = 0.175
    expect(score).toBeCloseTo(0.175, 5);
  });

  describe('Ordering Guarantees', () => {
    it('prefers anchor closer to crosshair center (smaller angle) at identical distance', () => {
      const dist = 40;
      const centeredScore = scoreAnchor(0.02, dist, 110, 0);
      const offsetScore = scoreAnchor(0.25, dist, 110, 0);

      // Lower score is better
      expect(centeredScore).toBeLessThan(offsetScore);
    });

    it('prefers closer anchor at identical angle', () => {
      const angle = 0.1;
      const closeScore = scoreAnchor(angle, 25, 110, 0);
      const farScore = scoreAnchor(angle, 80, 110, 0);

      expect(closeScore).toBeLessThan(farScore);
    });

    it('strictly maintains monotonic ordering as angle increases', () => {
      const dist = 50;
      const angles = [0.0, 0.05, 0.12, 0.2, 0.28, 0.35, 0.38];
      const scores = angles.map((a) => scoreAnchor(a, dist, 110, 0));

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThan(scores[i - 1]);
      }
    });

    it('strictly maintains monotonic ordering as distance increases', () => {
      const angle = 0.15;
      const distances = [5, 15, 30, 50, 75, 95, 110];
      const scores = distances.map((d) => scoreAnchor(angle, d, 110, 0));

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThan(scores[i - 1]);
      }
    });
  });

  describe('Boundary Angles & Distances', () => {
    it('evaluates cleanly at dead-center angle (0 rad)', () => {
      const score = scoreAnchor(0, 50, 110, 0);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThan(0);
    });

    it('evaluates cleanly at maximum cone threshold boundary (0.38 rad)', () => {
      const score = scoreAnchor(0.38, 110, 110, 0);
      // 0.38 * 0.65 + 1.0 * 0.35 = 0.247 + 0.35 = 0.597
      expect(score).toBeCloseTo(0.597, 3);
    });

    it('uses default maxDist (110) and default heightBonus (0) when omitted', () => {
      const explicit = scoreAnchor(0.2, 45, 110, 0);
      const defaulted = scoreAnchor(0.2, 45);
      expect(defaulted).toBeCloseTo(explicit, 6);
    });
  });

  describe('Height Preference (Sky Bias)', () => {
    it('rewards higher anchors with lower (better) score', () => {
      const angle = 0.1;
      const dist = 40;
      const levelScore = scoreAnchor(angle, dist, 110, 0);
      const highAnchorScore = scoreAnchor(angle, dist, 110, 15); // 15m above player

      expect(highAnchorScore).toBeLessThan(levelScore);
    });

    it('orders multiple candidate anchors by height preference when angle and distance match', () => {
      const angle = 0.08;
      const dist = 60;
      const low = scoreAnchor(angle, dist, 110, 2);
      const medium = scoreAnchor(angle, dist, 110, 10);
      const high = scoreAnchor(angle, dist, 110, 25);

      expect(high).toBeLessThan(medium);
      expect(medium).toBeLessThan(low);
    });
  });
});

describe('WebShooter - State & RopeState Enum Lifecycle', () => {
  let physics: SwingPhysics;
  let shooter: WebShooter;

  beforeEach(() => {
    physics = new SwingPhysics();
    physics.position.set(0, 10, 0);
    shooter = new WebShooter(physics);
  });

  it('verifies RopeState enum contains all required states', () => {
    expect(RopeState.HIDDEN).toBe('HIDDEN');
    expect(RopeState.TAUT).toBe('TAUT');
    expect(RopeState.SLACK).toBe('SLACK');
    expect(RopeState.ZIPPING).toBe('ZIPPING');
  });

  it('starts in HIDDEN rope state and inactive', () => {
    expect(shooter.ropeState).toBe(RopeState.HIDDEN);
    expect(shooter.isWebActive).toBe(false);
  });

  it('transitions to ZIPPING state on triggerWebZip', () => {
    const target = new THREE.Vector3(10, 20, 0);
    const triggered = shooter.triggerWebZip(target);

    expect(triggered).toBe(true);
    expect(shooter.isWebActive).toBe(true);
    expect(shooter.ropeState).toBe(RopeState.ZIPPING);
    expect(physics.mode).toBe(MovementMode.WEB_ZIPPING);
  });

  it('cancels zip on cancelWebZip and transitions to AIR with boost', () => {
    const target = new THREE.Vector3(10, 20, 0);
    shooter.triggerWebZip(target);

    const lookDir = new THREE.Vector3(0, 0, -1);
    shooter.cancelWebZip(lookDir);

    expect(shooter.isWebActive).toBe(false);
    expect(shooter.ropeState).toBe(RopeState.HIDDEN);
    expect(physics.mode).toBe(MovementMode.AIR);
    expect(physics.velocity.y).toBeGreaterThan(0);
  });

  it('updates ropeState to TAUT when swinging and web is taut', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    shooter.shootWeb(anchor);
    physics.isWebTaut = true;

    shooter.update(0.016, new THREE.Vector3(0, 10, 0));
    expect(shooter.ropeState).toBe(RopeState.TAUT);
  });

  it('updates ropeState to SLACK when swinging and web is slack', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    shooter.shootWeb(anchor);
    physics.isWebTaut = false;

    shooter.update(0.016, new THREE.Vector3(0, 10, 0));
    expect(shooter.ropeState).toBe(RopeState.SLACK);
  });
});

describe('WebShooter - sticky line and mid-swing re-target', () => {
  let physics: SwingPhysics;
  let shooter: WebShooter;

  beforeEach(() => {
    physics = new SwingPhysics();
    physics.position.set(0, 20, 0);
    physics.mode = MovementMode.AIR;
    shooter = new WebShooter(physics);
  });

  it('second shot mid-swing replaces the anchor and keeps swinging', () => {
    const first = new THREE.Vector3(30, 40, 0);
    expect(shooter.shootWeb(first, physics.position)).toBe(true);
    expect(physics.mode).toBe(MovementMode.SWINGING);

    const second = new THREE.Vector3(-20, 35, 0);
    expect(shooter.shootWeb(second, physics.position)).toBe(true);
    expect(physics.mode).toBe(MovementMode.SWINGING);
    expect(shooter.isWebActive).toBe(true);
    expect(physics.webAnchor!.x).toBeCloseTo(-20, 5);
    expect(physics.webAnchor!.y).toBeCloseTo(35, 5);
  });

  it('rejects anchors at/below feet so the line always has height', () => {
    const low = new THREE.Vector3(10, 19, 0);
    expect(shooter.shootWeb(low, physics.position)).toBe(false);
    expect(physics.mode).toBe(MovementMode.AIR);
    expect(shooter.isWebActive).toBe(false);
  });
});

describe('WebShooter - latching solid geometry that never registered a mesh', () => {
  const cb = new CityBuilder();
  const collidables = cb.getCollidableMeshes();
  const anchors = cb.getWebAnchors();
  const coll = cb.getWorldCollider();

  // Mid-air vantage on the road west of the site, with a clear line up to the
  // crane's mast head (the district's buildings sit on the 3x3 parcel grid, so
  // this street corridor stays open).
  const EYE = new THREE.Vector3(-30, 20, -4);
  const CRANE_HEAD = new THREE.Vector3(2, 45.5, -2);

  function aimAtCraneHead(bindCollider: boolean) {
    const physics = new SwingPhysics();
    const shooter = new WebShooter(physics);
    if (bindCollider) shooter.worldCollider = coll;
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    cam.position.copy(EYE);
    cam.lookAt(CRANE_HEAD);
    cam.updateMatrixWorld(true);
    physics.position.copy(EYE);
    return shooter.scanForTargets(cam, collidables, physics.position, anchors);
  }

  it('the crane is barely present in the collidable mesh list', () => {
    // Its lattice struts opt out, so a mesh raycast has almost nothing to hit and
    // the web sails straight through the crane to whatever stands behind it.
    const meshOnly = aimAtCraneHead(false);
    expect(meshOnly).not.toBeNull();
    expect(meshOnly!.point.y).toBeGreaterThan(48); // sailed past the 46.9m mast head
  });

  it('latches the crane itself once the collision shells are consulted', () => {
    const withShells = aimAtCraneHead(true);
    expect(withShells).not.toBeNull();
    expect(withShells!.isValid).toBe(true);
    // Crane mast head shell spans y 44.5..46.9 around x 0.8..3.2, z -3.2..-0.8
    expect(withShells!.point.y).toBeGreaterThanOrEqual(44.5);
    expect(withShells!.point.y).toBeLessThanOrEqual(46.9);
    expect(Math.hypot(withShells!.point.x - 2, withShells!.point.z + 2)).toBeLessThan(2.5);
  });

  it('latches walls but never the floor you are standing on', () => {
    const w = new WorldCollider();
    w.addBoxCoords(-50, -2, -50, 50, 0.5, 50, 'floor'); // street slab
    w.addBoxCoords(10, 0.5, -5, 14, 30, 5, 'wall');     // a building beside it
    w.finalize();

    const down = new THREE.Vector3(0, -1, 0);
    const across = new THREE.Vector3(1, 0, 0);
    // Straight down at the deck: nothing to latch
    expect(w.raycast(new THREE.Vector3(0, 10, 0), down, 110, 'floor')).toBeNull();
    // Sideways at the building: latches its face
    const wall = w.raycast(new THREE.Vector3(0, 10, 0), across, 110, 'floor');
    expect(wall).not.toBeNull();
    expect(wall!.box.tag).toBe('wall');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  CHARACTER_HEIGHT,
  COVER_RAIL_HEIGHT,
  CROUCH_HEIGHT,
  chestY,
  eyeOffsetFromCenter,
  hitbandMaxY,
  hitbandMinY,
} from '../src/core/CoverMetrics';
import { WorldCollider } from '../src/world/WorldCollider';
import { EnemyManager } from '../src/enemies/EnemyManager';
import { InkParticles } from '../src/effects/InkParticles';
import { ThugEnemy } from '../src/enemies/ThugEnemy';
import { EnemyState } from '../src/enemies/Enemy';
import { Pistol } from '../src/weapons/Pistol';
import { CityBuilder } from '../src/world/CityBuilder';
import type { Player } from '../src/player/Player';

/**
 * BALCONY RAILINGS AS COVER.
 *
 * Every railing in the city is a solid wall exactly half a character tall.
 * Nothing special-cases "crouched behind a rail": these tests pin the geometry
 * that makes the mechanic emerge from the ordinary raycasts.
 *
 *   stand  -> shoot over the rail, and be shot
 *   crouch -> fully covered, and unable to shoot back
 *   crouch in the open -> shoot and be shot as normal (no rail, no cover)
 */

/** A rail run along the x axis at z = 0, sitting on a floor at y = floorY. */
function railWorld(floorY: number): WorldCollider {
  const w = new WorldCollider();
  w.addBoxCoords(-20, floorY - 0.2, -20, 20, floorY, 20, 'floor');
  w.addBoxCoords(-20, floorY, -0.06, 20, floorY + COVER_RAIL_HEIGHT, 0.06, 'wall');
  w.finalize();
  return w;
}

/** Capsule centre Y for a stance whose feet rest on floorY. */
const centerOn = (floorY: number, stance: number) => floorY + stance * 0.5;

describe('Railing cover metrics', () => {
  it('every railing is exactly half a character tall', () => {
    expect(CHARACTER_HEIGHT).toBe(1.8);
    expect(COVER_RAIL_HEIGHT).toBe(CHARACTER_HEIGHT / 2);
    expect(COVER_RAIL_HEIGHT).toBe(0.9);
  });

  it('the crouched silhouette is no taller than the rail it hides behind', () => {
    expect(CROUCH_HEIGHT).toBeLessThanOrEqual(COVER_RAIL_HEIGHT);
  });

  it('the standing eye clears the rail and the crouched eye sits under it', () => {
    const standEye = CHARACTER_HEIGHT * 0.5 + eyeOffsetFromCenter(false);
    const crouchEye = CROUCH_HEIGHT * 0.5 + eyeOffsetFromCenter(true);

    expect(standEye).toBeGreaterThan(COVER_RAIL_HEIGHT);
    expect(crouchEye).toBeLessThan(COVER_RAIL_HEIGHT);
    // A real margin either way, not a coin-flip on the lip
    expect(standEye - COVER_RAIL_HEIGHT).toBeGreaterThan(0.5);
    expect(COVER_RAIL_HEIGHT - crouchEye).toBeGreaterThan(0.1);
  });

  it('the standing chest is above the rail and the crouched chest below it', () => {
    const standChest = chestY(centerOn(0, CHARACTER_HEIGHT), CHARACTER_HEIGHT);
    const crouchChest = chestY(centerOn(0, CROUCH_HEIGHT), CROUCH_HEIGHT);

    expect(standChest).toBeGreaterThan(COVER_RAIL_HEIGHT);
    expect(crouchChest).toBeLessThan(COVER_RAIL_HEIGHT);
  });

  it('the crouched hitbox tops out at the rail, so no head margin leaks over it', () => {
    const crouchCenter = centerOn(0, CROUCH_HEIGHT);
    expect(hitbandMinY(crouchCenter, CROUCH_HEIGHT)).toBeCloseTo(0, 6);
    expect(hitbandMaxY(crouchCenter, CROUCH_HEIGHT)).toBeLessThanOrEqual(COVER_RAIL_HEIGHT);

    // Standing keeps its head-margin generosity, and pokes well over the rail
    const standCenter = centerOn(0, CHARACTER_HEIGHT);
    expect(hitbandMaxY(standCenter, CHARACTER_HEIGHT)).toBeGreaterThan(CHARACTER_HEIGHT);
  });
});

describe('Enemy line of sight against a half-height railing', () => {
  const floorY = 20.0;
  let world: WorldCollider;

  beforeEach(() => {
    world = railWorld(floorY);
  });

  it('sees a standing chest over the rail but not a crouched one behind it', () => {
    const muzzle = new THREE.Vector3(0, floorY + 1.2, -8);

    const standChest = new THREE.Vector3(
      0, chestY(centerOn(floorY, CHARACTER_HEIGHT), CHARACTER_HEIGHT), 5
    );
    const crouchChest = new THREE.Vector3(
      0, chestY(centerOn(floorY, CROUCH_HEIGHT), CROUCH_HEIGHT), 5
    );

    expect(world.hasLineOfSight(muzzle, standChest)).toBe(true);
    expect(world.hasLineOfSight(muzzle, crouchChest)).toBe(false);
  });

  it('makes a thug hold fire on a crouched player and open up on a standing one', () => {
    // Held at a genuine cover distance. A thug that walks right up and leans over
    // the rail CAN shoot down past it — that is correct, so the test pins the
    // stand-off rather than letting the AI close the gap and change the scenario.
    const perch = new THREE.Vector3(0, floorY, -14);

    const run = (stance: number): number => {
      const thug = new ThugEnemy(perch.clone());
      thug.bindCollider(world);
      thug.alerted = true;
      thug.spawnGrace = 0;
      thug.state = EnemyState.ATTACK;

      const center = new THREE.Vector3(0, centerOn(floorY, stance), 5);
      thug.aimTargetY = chestY(center.y, stance);
      for (let i = 0; i < 15; i++) {
        thug.group.position.copy(perch);
        thug.update(0.2, center, undefined as never, []);
      }
      const fired = thug.pendingProjectiles.length;
      thug.dispose();
      return fired;
    };

    expect(run(CROUCH_HEIGHT)).toBe(0);
    expect(run(CHARACTER_HEIGHT)).toBeGreaterThan(0);
  });
});

describe('Enemy bullets against a half-height railing', () => {
  const floorY = 20.0;
  let scene: THREE.Scene;
  let particles: InkParticles;
  let manager: EnemyManager;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new InkParticles();
    manager = new EnemyManager(scene, particles);
  });

  afterEach(() => manager.clear());

  const stub = (stance: number, onHit: () => void) =>
    ({
      position: new THREE.Vector3(0, centerOn(floorY, stance), 5),
      isDead: false,
      takeDamage: () => { onHit(); return true; },
      physics: { playerHeight: stance },
    }) as unknown as Player;

  /** One chest-high shot from the far side of the rail, travelling +z. */
  const shootAtChest = (stance: number) => {
    manager.spawnProjectile({
      origin: new THREE.Vector3(0, chestY(centerOn(floorY, stance), stance), -8),
      direction: new THREE.Vector3(0, 0, 1),
      speed: 50, damage: 9, radius: 0.16, maxDistance: 60, isSniper: false, kind: 'thug',
    });
  };

  it('stops the bullet in the rail when the player is crouched behind it', () => {
    manager.bindCollider(railWorld(floorY));

    let standHits = 0;
    shootAtChest(CHARACTER_HEIGHT);
    manager.update(0.5, stub(CHARACTER_HEIGHT, () => standHits++), undefined as never);
    expect(standHits).toBe(1);

    let crouchHits = 0;
    shootAtChest(CROUCH_HEIGHT);
    manager.update(0.5, stub(CROUCH_HEIGHT, () => crouchHits++), undefined as never);
    expect(crouchHits).toBe(0);
    // The rail ate it rather than the bullet flying on past
    expect(manager.projectiles.length).toBe(0);
  });

  it('still hits a player crouching in the open — crouch is only cover behind cover', () => {
    const open = new WorldCollider();
    open.addBoxCoords(-20, floorY - 0.2, -20, 20, floorY, 20, 'floor');
    open.finalize();
    manager.bindCollider(open);

    let hits = 0;
    shootAtChest(CROUCH_HEIGHT);
    manager.update(0.5, stub(CROUCH_HEIGHT, () => hits++), undefined as never);
    expect(hits).toBe(1);
  });
});

describe("The player's own shots against a half-height railing", () => {
  const floorY = 20.0;
  let rail: THREE.Mesh;
  let targets: THREE.Object3D[];

  beforeEach(() => {
    // Solid rail panel matching the collision shell: 0.9m tall, on z = 0
    rail = new THREE.Mesh(new THREE.BoxGeometry(40, COVER_RAIL_HEIGHT, 0.12));
    rail.position.set(0, floorY + COVER_RAIL_HEIGHT * 0.5, 0);
    rail.updateMatrixWorld(true);
    targets = [rail];
  });

  /** Fires level and forward (-z) from the eye of a player standing at z = +5. */
  const fireFromEye = (stance: number, crouching: boolean) => {
    const pistol = new Pistol();
    pistol.initAmmo();
    // Pistol spread is 0.009 rad — under 3cm of drift at this 5m range, an order
    // of magnitude smaller than the margins below, so only geometry decides.
    const eyeY = centerOn(floorY, stance) + eyeOffsetFromCenter(crouching);
    return pistol.fire(
      10, // past the initial fire-rate cooldown (lastFireTime starts at 0)
      new THREE.Vector3(0, eyeY, 5),
      new THREE.Vector3(0, 0, -1),
      false,
      targets
    );
  };

  it('clears the rail when standing, so you can shoot over it', () => {
    const res = fireFromEye(CHARACTER_HEIGHT, false);
    expect(res).not.toBeNull();
    expect(res!.hit).toBe(false);
  });

  it('hits the rail when crouched behind it, so you cannot shoot from cover', () => {
    const res = fireFromEye(CROUCH_HEIGHT, true);
    expect(res).not.toBeNull();
    expect(res!.hit).toBe(true);
    expect(res!.target).toBe(rail);
  });

  it('fires freely when crouching in the open', () => {
    targets = [];
    const res = fireFromEye(CROUCH_HEIGHT, true);
    expect(res).not.toBeNull();
    expect(res!.hit).toBe(false);
  });
});

describe('City-wide railing audit', () => {
  const city = new CityBuilder();
  const collider = city.getWorldCollider();
  const boxes = collider.dumpBounds();

  /**
   * Height of the rail shell standing on `floorTop` at (x, z).
   * Returns null when no rail is registered there.
   */
  function railHeightAt(x: number, z: number, floorTop: number): number | null {
    for (const b of boxes) {
      if (b.tag !== 'wall') continue;
      if (Math.abs(b.minY - floorTop) > 0.01) continue;
      if (x < b.minX - 0.01 || x > b.maxX + 0.01) continue;
      if (z < b.minZ - 0.01 || z > b.maxZ + 0.01) continue;
      return b.maxY - b.minY;
    }
    return null;
  }

  // One probe per railing family in the world, so a regression anywhere in the
  // city trips this rather than only the family that happened to get a test.
  const probes: Array<[string, number, number, number]> = [
    ['plaza tower roof parapet ring', 0, 38.1, 62.0],
    ['depot rooftop parapet (south)', 0, -40.2, 9.8],
    ['depot mezzanine balustrade (west)', -5.0, -50.0, 5.2],
    ['depot NE stair balustrade', 8.45, -54.0, 5.2],
    ['construction site perimeter (floor 1, south)', 0, -10.9, 5.5],
    ['construction site perimeter (floor 2, west)', -12.9, 0, 10.5],
    ['construction site floor 3 west (north of bridge)', -12.9, 5.8, 15.5],
    ['skybridge side railing (north)', -27, -1.55, 15.4],
  ];

  for (const [name, x, z, floorTop] of probes) {
    it(`${name} is exactly half a character tall`, () => {
      const h = railHeightAt(x, z, floorTop);
      expect(h, `no rail shell found for ${name}`).not.toBeNull();
      expect(h!).toBeCloseTo(COVER_RAIL_HEIGHT, 6);
    });
  }

  it('encloses every balcony on all three railed sides, not just the outer rail', () => {
    // Regression: the side rails were drawn as meshes but never registered as
    // collision shells, so you could walk straight off a balcony sideways.
    const specs = city.getBalconySpecs();
    expect(specs.length).toBeGreaterThan(0);

    for (const b of specs) {
      const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
      const r = 0.35;
      const feet = b.cy;
      const head = b.cy + CHARACTER_HEIGHT;

      // Standing on the balcony floor
      expect(collider.groundAt(b.cx, b.cy, b.cz, 0.55), `balcony floor at ${b.cx},${b.cz}`).toBeCloseTo(b.cy, 1);

      // Outward edge and BOTH tangential edges must push back
      const edges: Array<[string, number, number]> = b.nx !== 0
        ? [
            ['outer', b.cx + b.nx * (b.hw - 0.05), b.cz],
            ['side -z', b.cx, b.cz - b.hd + 0.05],
            ['side +z', b.cx, b.cz + b.hd - 0.05],
          ]
        : [
            ['outer', b.cx, b.cz + b.nz * (b.hd - 0.05)],
            ['side -x', b.cx - b.hw + 0.05, b.cz],
            ['side +x', b.cx + b.hw - 0.05, b.cz],
          ];

      for (const [label, px, pz] of edges) {
        out.pushed = false;
        collider.pushOut(px, pz, r, feet, head, out);
        expect(out.pushed, `${label} rail of balcony at ${b.cx},${b.cy},${b.cz} lets the player through`).toBe(true);
      }
    }
  });

  it('leaves the skybridge doorway in the floor-3 rail open', () => {
    // The bridge mouth (z in -1.6..1.6) must stay walkable, not railed shut
    expect(railHeightAt(-12.9, 0, 15.5)).toBeNull();
  });
});

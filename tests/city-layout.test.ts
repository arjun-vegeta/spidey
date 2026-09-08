import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CityBuilder,
  CELL_X,
  CELL_Z,
  PARCEL_W,
  PARCEL_D,
  CURB_MARGIN,
  STREET_Y,
  cellCenter,
} from '../src/world/CityBuilder';
import { WebShooter } from '../src/player/WebShooter';
import { SwingPhysics } from '../src/player/SwingPhysics';
import {
  CHARACTER_HEIGHT,
  CHEST_FRACTION,
  COVER_RAIL_HEIGHT,
  CROUCH_HEIGHT,
} from '../src/core/CoverMetrics';

/** Chest height above the deck you are standing on, per stance. */
const CROUCH_CHEST = CROUCH_HEIGHT * CHEST_FRACTION;
const STAND_CHEST = CHARACTER_HEIGHT * CHEST_FRACTION;

/**
 * DISTRICT LAYOUT — the city is a 3x3 of parcels with roads between them:
 *
 *     1   2   3      2 = the two-storey depot (the one you go inside)
 *     4   C   5      C = construction site
 *     6   7   8
 *
 * These tests pin the two things that were broken: buildings standing in the
 * roadway, and street furniture placed by hand into walls and carriageways.
 */

const city = new CityBuilder();
const coll = city.getWorldCollider();

/** The nine grid cells and what stands on each. */
const CELLS: Array<{ name: string; col: -1 | 0 | 1; row: -1 | 0 | 1; kind: 'building' | 'depot' | 'site' }> = [
  { name: '1 Hudson Works (brick warehouse)', col: -1, row: -1, kind: 'building' },
  { name: '2 Depot', col: 0, row: -1, kind: 'depot' },
  { name: '3 Mercer Loft (cast-iron)', col: 1, row: -1, kind: 'building' },
  { name: '4 Dockside Terrace', col: -1, row: 0, kind: 'building' },
  { name: 'C Construction Site', col: 0, row: 0, kind: 'site' },
  { name: '5 The Crown (art-deco)', col: 1, row: 0, kind: 'building' },
  { name: '6 The Orpheum (theatre)', col: -1, row: 1, kind: 'building' },
  { name: '7 Plaza Tower (glass, pilotis)', col: 0, row: 1, kind: 'building' },
  { name: '8 Orchard Row (tenement)', col: 1, row: 1, kind: 'building' },
];

describe('District grid', () => {
  it('leaves a road between every pair of parcels', () => {
    expect(CELL_X - PARCEL_W).toBeGreaterThanOrEqual(12);
    expect(CELL_Z - PARCEL_D).toBeGreaterThanOrEqual(12);
  });

  it('keeps the two load-bearing cells where the rest of the world expects them', () => {
    // The depot is cell 2 and the skybridge dock is cell 4. The site's skybridge
    // runs west from x = -13 to x = -41, which is the dock's east face.
    expect(cellCenter(0, -1)).toEqual({ x: 0, z: -50 });
    expect(cellCenter(-1, 0)).toEqual({ x: -54, z: 0 });
    const dock = city.getBuildingFootprints().find((b) => b.x === -54 && b.z === 0);
    expect(dock).toBeDefined();
    expect(dock!.x + dock!.w * 0.5).toBeCloseTo(-41, 5);
  });

  it('stands something on all nine cells and nothing between them', () => {
    for (const c of CELLS) {
      const { x, z } = cellCenter(c.col, c.row);
      const top = coll.groundAt(x, 300, z, 600);
      expect(top, `${c.name} has no massing`).not.toBeNull();
      expect(top!, `${c.name} is flat ground`).toBeGreaterThan(STREET_Y + 1);
    }
  });

  it('gives every cell a distinct silhouette height', () => {
    const heights = CELLS.map((c) => {
      const { x, z } = cellCenter(c.col, c.row);
      return Math.round(coll.groundAt(x, 300, z, 600) ?? 0);
    });
    // No two buildings share a roof height: the skyline has to read as a city,
    // not a row of identical boxes.
    expect(new Set(heights).size).toBe(heights.length);
    expect(Math.max(...heights)).toBeGreaterThan(60); // a real landmark tower
    expect(Math.min(...heights)).toBeLessThan(15);    // and a short brick block
  });
});

describe('Nothing stands in the road', () => {
  it('keeps every building footprint inside its own parcel', () => {
    for (const b of city.getBuildingFootprints()) {
      // Which parcel is this footprint's centre in?
      const col = Math.round(b.x / CELL_X);
      const row = Math.round(b.z / CELL_Z);
      const px = col * CELL_X;
      const pz = row * CELL_Z;

      const overhangX = Math.abs(b.x - px) + b.w * 0.5 - PARCEL_W * 0.5;
      const overhangZ = Math.abs(b.z - pz) + b.d * 0.5 - PARCEL_D * 0.5;

      expect(overhangX, `building at (${b.x},${b.z}) spills across the N-S road`)
        .toBeLessThanOrEqual(-CURB_MARGIN);
      expect(overhangZ, `building at (${b.x},${b.z}) spills across the E-W road`)
        .toBeLessThanOrEqual(-CURB_MARGIN);
    }
  });

  it('keeps the road centrelines clear at street level all the way across', () => {
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    const roadX = [-CELL_X * 0.5, CELL_X * 0.5];
    const roadZ = [-CELL_Z * 0.5, CELL_Z * 0.5];

    for (const rx of roadX) {
      for (let z = -CELL_Z * 1.5; z <= CELL_Z * 1.5; z += 2.5) {
        out.pushed = false;
        coll.pushOut(rx, z, 0.35, STREET_Y, STREET_Y + 1.8, out);
        expect(out.pushed, `N-S road at x=${rx} blocked at z=${z}`).toBe(false);
      }
    }
    for (const rz of roadZ) {
      for (let x = -CELL_X * 1.5; x <= CELL_X * 1.5; x += 2.5) {
        out.pushed = false;
        coll.pushOut(x, rz, 0.35, STREET_Y, STREET_Y + 1.8, out);
        expect(out.pushed, `E-W road at z=${rz} blocked at x=${x}`).toBe(false);
      }
    }
  });
});

describe('Zebra crossings', () => {
  /** Flat road markings near (x, z), as world-space bounding boxes. */
  function barsNear(x: number, z: number): THREE.Box3[] {
    const found: THREE.Box3[] = [];
    const group = city.getGroup();
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const box = new THREE.Box3().setFromObject(m);
      const h = box.max.y - box.min.y;
      if (h > 0.06) return;                       // markings are paper-thin
      if (box.max.y > STREET_Y + 0.06) return;    // and lie on the tarmac
      const cx = (box.min.x + box.max.x) * 0.5;
      const cz = (box.min.z + box.max.z) * 0.5;
      if (Math.hypot(cx - x, cz - z) > 6.0) return;
      found.push(box);
    });
    return found;
  }

  it('runs its bars ACROSS the road it crosses, not along it', () => {
    // A crossing over a north-south road: you walk east-west, so each bar is
    // long in x and thin in z. The bars previously ran the other way, which
    // laid the crossing lengthwise down the carriageway.
    const bars = barsNear(CELL_X * 0.5, 0).filter((b) => (b.max.x - b.min.x) > 1.0 || (b.max.z - b.min.z) > 1.0);
    expect(bars.length).toBeGreaterThanOrEqual(6);

    let acrossBars = 0;
    for (const b of bars) {
      const spanX = b.max.x - b.min.x;
      const spanZ = b.max.z - b.min.z;
      if (spanX > spanZ * 3) acrossBars++;
    }
    expect(acrossBars, 'crossing bars are not oriented across the road').toBeGreaterThanOrEqual(6);
  });

  it('spans the full width of the carriageway', () => {
    const bars = barsNear(CELL_X * 0.5, 0).filter((b) => (b.max.x - b.min.x) > 1.0);
    expect(bars.length).toBeGreaterThan(0);
    const roadW = CELL_X - PARCEL_W;
    for (const b of bars) {
      // Each bar reaches from one kerb to the other
      expect(b.max.x - b.min.x).toBeCloseTo(roadW, 1);
      expect(b.min.x).toBeCloseTo(PARCEL_W * 0.5, 1);
      expect(b.max.x).toBeCloseTo(CELL_X - PARCEL_W * 0.5, 1);
    }
  });

  it('orients the crossings over the east-west roads the other way', () => {
    const bars = barsNear(0, CELL_Z * 0.5).filter((b) => (b.max.z - b.min.z) > 1.0);
    expect(bars.length).toBeGreaterThanOrEqual(6);
    for (const b of bars) {
      expect(b.max.z - b.min.z).toBeGreaterThan((b.max.x - b.min.x) * 3);
    }
  });
});

describe('Hydrants', () => {
  const hydrants = city.getHydrantAnchors();

  it('places one at every parcel kerb, on the pavement and never in the roadway', () => {
    expect(hydrants.length).toBe(9 * 4);

    for (const h of hydrants) {
      const col = Math.round(h.x / CELL_X);
      const row = Math.round(h.z / CELL_Z);
      const dx = Math.abs(h.x - col * CELL_X);
      const dz = Math.abs(h.z - row * CELL_Z);

      // Inside the parcel it belongs to...
      expect(dx, `hydrant at (${h.x},${h.z}) is out in the road`).toBeLessThanOrEqual(PARCEL_W * 0.5);
      expect(dz, `hydrant at (${h.x},${h.z}) is out in the road`).toBeLessThanOrEqual(PARCEL_D * 0.5);
      // ...and out at the kerb rather than buried in the middle of the block
      const nearKerb = dx > PARCEL_W * 0.5 - 2.0 || dz > PARCEL_D * 0.5 - 2.0;
      expect(nearKerb, `hydrant at (${h.x},${h.z}) is not on a kerb`).toBe(true);
    }
  });

  it('never plants one inside a building', () => {
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    for (const h of hydrants) {
      for (const b of city.getBuildingFootprints()) {
        const insideX = Math.abs(h.x - b.x) < b.w * 0.5;
        const insideZ = Math.abs(h.z - b.z) < b.d * 0.5;
        expect(insideX && insideZ, `hydrant at (${h.x},${h.z}) is inside the building at (${b.x},${b.z})`).toBe(false);
      }
      // And a hydrant's own shell is the only thing at its spot
      out.pushed = false;
      coll.pushOut(h.x + 1.2, h.z, 0.3, STREET_Y, STREET_Y + 1.8, out);
      const alsoClear = !out.pushed || Math.hypot(out.x - h.x, out.z - h.z) < 2.0;
      expect(alsoClear).toBe(true);
    }
  });

  it('sits at bonnet height, low enough to be a street-level winch target', () => {
    for (const h of hydrants) {
      expect(h.y).toBeGreaterThan(STREET_Y);
      expect(h.y).toBeLessThan(STREET_Y + 1.2);
    }
  });
});

describe('Winching to a hydrant', () => {
  /** Aims a shooter from `eye` at `target` and reports what it latches. */
  function latch(eye: THREE.Vector3, target: THREE.Vector3, anchors: THREE.Vector3[]) {
    const physics = new SwingPhysics();
    const shooter = new WebShooter(physics);
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    cam.position.copy(eye);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    physics.position.copy(eye);
    // No meshes and no shells: this exercises the curated latch registry, which
    // is the path a low street anchor has to come through.
    return shooter.scanForTargets(cam, [], physics.position, anchors);
  }

  it('latches a hydrant across the street', () => {
    const hydrant = new THREE.Vector3(12.0, STREET_Y + 0.78, 0);
    const eye = new THREE.Vector3(-6.0, STREET_Y + 1.7, 0);
    const res = latch(eye, hydrant, [hydrant]);
    expect(res).not.toBeNull();
    expect(res!.point.distanceTo(hydrant)).toBeLessThan
      (0.01);
  });

  it('still refuses to latch the ground at your feet', () => {
    // Same height, but right beside you: webbing this would just pin you down.
    const underfoot = new THREE.Vector3(2.0, STREET_Y + 0.78, 0);
    const eye = new THREE.Vector3(0, STREET_Y + 1.7, 0);
    expect(latch(eye, underfoot, [underfoot])).toBeNull();
  });

  it('attaches and winches: the rope shortens toward the hydrant', () => {
    const hydrant = new THREE.Vector3(20.0, STREET_Y + 0.78, 0);
    const physics = new SwingPhysics();
    physics.position.set(0, 12.0, 0); // mid-swing, above the street
    physics.velocity.set(0, 0, 0);
    physics.attachWeb(hydrant);

    physics.winching = true;
    const startDist = physics.position.distanceTo(hydrant);
    for (let i = 0; i < 20; i++) {
      physics.update(0.05, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), false, false);
    }
    expect(physics.position.distanceTo(hydrant)).toBeLessThan(startDist);
  });

  it('exposes a low-anchor stand-off that is larger than a body radius', () => {
    expect(WebShooter.MIN_LOW_ANCHOR_HORIZ).toBeGreaterThan(2.0);
  });
});

describe('Only one building has an interior', () => {
  const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };

  it('walks straight through the plaza tower pilotis deck', () => {
    const { x, z } = cellCenter(0, 1);
    for (let pz = z - 14; pz <= z + 14; pz += 2) {
      out.pushed = false;
      coll.pushOut(x, pz, 0.35, STREET_Y, STREET_Y + 1.8, out);
      expect(out.pushed, `pilotis deck blocked at z=${pz}`).toBe(false);
    }
    // The deck is capped: its ceiling is the podium, so it reads as a garage
    expect(coll.ceilingAt(x, STREET_Y + 1.0, z)).toBeCloseTo(5.0, 5);
  });

  it('gives the pilotis deck kerb islands to fight behind, at rail height', () => {
    const { x, z } = cellCenter(0, 1);
    out.pushed = false;
    coll.pushOut(x - 7.0, z + 8.0, 0.35, STREET_Y, STREET_Y + 1.8, out);
    expect(out.pushed).toBe(true);
    // Crouch height clears it: the island is cover, not a wall
    expect(coll.ceilingAt(x - 7.0, STREET_Y + COVER_RAIL_HEIGHT + 0.1, z + 8.0)).not.toBe(STREET_Y);
  });

  it('keeps every other cell a solid closed volume at street level', () => {
    const solid = CELLS.filter((c) => c.kind === 'building' && !(c.col === 0 && c.row === 1));
    for (const c of solid) {
      const { x, z } = cellCenter(c.col, c.row);
      out.pushed = false;
      coll.pushOut(x, z, 0.35, STREET_Y, STREET_Y + 1.8, out);
      expect(out.pushed, `${c.name} is hollow at street level`).toBe(true);
    }
  });
});

describe('Facade traversal furniture', () => {
  it('builds fire-escape landings that stack a storey apart up a facade', () => {
    const landings = city.getFireEscapeLandings();
    expect(landings.length).toBeGreaterThanOrEqual(9);

    // Group by facade run and check each run climbs in even steps
    const runs = new Map<string, number[]>();
    for (const l of landings) {
      const key = `${l.face}:${Math.round(l.cx / 5)}:${Math.round(l.cz / 5)}`;
      const bucket = runs.get(key) ?? [];
      bucket.push(l.cy);
      runs.set(key, bucket);
    }
    expect(runs.size).toBeGreaterThanOrEqual(2);
  });

  it('makes every fire-escape landing genuinely standable, not a ledge you slide off', () => {
    // The first version projected 1.6m and was railed on both ends, leaving
    // ~0.25m of floor between the wall and the rail — the capsule is 1.2m
    // across, so you were permanently wedged. Walk a capsule around each
    // landing centre and require real clearance.
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    const r = 0.6;

    for (const l of city.getFireEscapeLandings()) {
      // The deck holds your feet
      expect(coll.groundAt(l.cx, l.cy, l.cz, 0.55), `landing at ${l.cx},${l.cy},${l.cz} has no floor`)
        .toBeCloseTo(l.cy, 1);

      // And standing at its centre, nothing shoves you off it
      out.pushed = false;
      coll.pushOut(l.cx, l.cz, r, l.cy, l.cy + CHARACTER_HEIGHT, out);
      const shove = Math.hypot(out.x - l.cx, out.z - l.cz);
      expect(shove, `landing at ${l.cx},${l.cy},${l.cz} wedges the capsule (${shove.toFixed(2)}m)`)
        .toBeLessThan(0.35);

      // Wherever it shoves you, you are still on the deck
      expect(coll.groundAt(out.x, l.cy, out.z, 0.55), 'shoved off the landing').toBeCloseTo(l.cy, 1);
    }
  });

  it('leaves the stair-facing end of each landing open so you can walk onto the flight', () => {
    // A landing railed on all four sides is a box you can only web into. Each
    // one must have exactly one open end.
    let openEnds = 0;
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    for (const l of city.getFireEscapeLandings()) {
      for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]] as const) {
        out.pushed = false;
        coll.pushOut(l.cx + dx, l.cz + dz, 0.35, l.cy, l.cy + CHARACTER_HEIGHT, out);
        if (!out.pushed) openEnds++;
      }
    }
    expect(openEnds).toBeGreaterThan(0);
  });

  it('joins the fire-escape landings with walkable stair ramps at a climbable slope', () => {
    // Fire-escape flights rise exactly one storey (3.5m). Other ramps in the
    // world (the depot's grand stair and roof stair) are steeper by design and
    // are not part of this run.
    const flights = coll.dumpRampBounds().filter((r) => Math.abs(Math.abs(r.y1 - r.y0) - 3.5) < 0.01);
    expect(flights.length).toBeGreaterThanOrEqual(6);

    for (const f of flights) {
      const run = f.axis === 'z' ? f.maxZ - f.minZ : f.maxX - f.minX;
      const slopeDeg = (Math.atan2(Math.abs(f.y1 - f.y0), run) * 180) / Math.PI;
      // Same slope band as the site stairs and the depot grand stair, which are
      // known to walk cleanly. Steeper than this and you slide back down.
      expect(slopeDeg, `flight slope ${slopeDeg.toFixed(1)} deg is not walkable`).toBeLessThan(36);
      expect(slopeDeg).toBeGreaterThan(15);
    }
  });

  it('lets you walk a flight from one landing up to the next', () => {
    // One run = one facade of one building. Grouping by face alone would mix the
    // loft's west face with the tenement's, which are 100m apart.
    const runs = new Map<string, ReturnType<typeof city.getFireEscapeLandings>>();
    for (const l of city.getFireEscapeLandings()) {
      const key = `${l.bx},${l.bz},${l.face}`;
      const bucket = runs.get(key) ?? [];
      bucket.push(l);
      runs.set(key, bucket);
    }
    expect(runs.size).toBeGreaterThanOrEqual(3);

    for (const [key, run] of runs) {
      run.sort((a, b) => a.cy - b.cy);
      expect(run.length, `run ${key} is too short to climb`).toBeGreaterThanOrEqual(3);

      // Landings alternate ends of the assembly one storey apart
      for (let i = 1; i < run.length; i++) {
        expect(run[i].cy - run[i - 1].cy).toBeCloseTo(3.5, 5);
      }

      // Step along the flight between the two lowest landings: the ground must
      // rise continuously with no gap to fall through.
      const lo = run[0];
      const hi = run[1];
      let prev = lo.cy;
      let climbed = 0;
      for (let f = 0; f <= 1.0001; f += 0.05) {
        const px = lo.cx + (hi.cx - lo.cx) * f;
        const pz = lo.cz + (hi.cz - lo.cz) * f;
        const top = coll.groundAt(px, prev + 0.55, pz, 0.6);
        expect(top, `run ${key} has a hole at f=${f.toFixed(2)}`).not.toBeNull();
        // Consecutive flights share the middle bay's footprint (that is what a
        // zigzag stair is), so the resolved surface can interleave by a few cm
        // between them. Anything under the 0.55m step-up is unnoticeable; a
        // real hole would drop you the whole way to the pavement.
        expect(top!, `run ${key} drops away at f=${f.toFixed(2)}`).toBeGreaterThanOrEqual(prev - 0.3);
        if (top! > prev + 0.01) climbed++;
        prev = top!;
      }
      expect(climbed, `run ${key} never gains height`).toBeGreaterThan(4);
      expect(prev, `run ${key} does not reach the next landing`).toBeCloseTo(hi.cy, 1);
    }
  });

  it('covers a player crouched on a balcony or fire-escape landing', () => {
    // Enemies aim and sight at the chest. Crouched, that sits below the rail
    // lip, so a shooter out on the open side has no line to you — while
    // standing at the same spot leaves you exposed.
    const spots = [
      ...city.getFireEscapeLandings().map((l) => ({
        x: l.cx, y: l.cy, z: l.cz, nx: l.nx, nz: l.nz, what: `landing ${l.face}`,
      })),
      ...city.getBalconySpecs().map((b) => ({
        x: b.cx, y: b.cy, z: b.cz, nx: b.nx, nz: b.nz, what: 'balcony',
      })),
    ];
    expect(spots.length).toBeGreaterThan(20);

    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    let checked = 0;

    for (const s of spots) {
      const crouchChest = new THREE.Vector3(s.x, s.y + CROUCH_CHEST, s.z);
      const standChest = new THREE.Vector3(s.x, s.y + STAND_CHEST, s.z);

      // Find a stand-off on the perch's OPEN side that is actually in open air.
      // Straight-line offsets can land inside a neighbouring block — a shooter
      // buried in a wall proves nothing either way.
      let eye: THREE.Vector3 | null = null;
      for (const d of [10, 14, 18, 22]) {
        const ex = s.x + s.nx * d;
        const ez = s.z + s.nz * d;
        out.pushed = false;
        coll.pushOut(ex, ez, 0.6, s.y, s.y + CHARACTER_HEIGHT, out);
        if (!out.pushed) {
          eye = new THREE.Vector3(ex, s.y + 1.2, ez);
          break;
        }
      }
      if (!eye) continue; // fully enclosed perch, nothing to sight from
      // Only judge perches that are genuinely exposed when you stand up
      if (!coll.hasLineOfSight(eye, standChest)) continue;

      checked++;
      expect(
        coll.hasLineOfSight(eye, crouchChest),
        `${s.what} at ${s.x.toFixed(1)},${s.y},${s.z.toFixed(1)} does not cover a crouched player`
      ).toBe(false);
    }

    // The point of the test is that this holds broadly, not on one lucky perch
    expect(checked, 'no exposed perch was found to test').toBeGreaterThan(15);
  });
});

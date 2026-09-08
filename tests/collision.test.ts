import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldCollider } from '../src/world/WorldCollider';
import { CityBuilder } from '../src/world/CityBuilder';


function buildTestCollider(): WorldCollider {
  const w = new WorldCollider();
  w.addBoxCoords(-260, -2, -260, 260, 0.5, 260, 'floor'); // street
  w.addBoxCoords(0, 0, 0, 10, 20, 10, 'wall'); // tower
  w.addBoxCoords(0, 19.8, 0, 10, 20, 10, 'floor'); // roof
  w.addBoxCoords(20, 9.9, 20, 30, 10.2, 30, 'floor'); // terrace
  w.finalize();
  return w;
}

describe('WorldCollider - simplified collision shells', () => {
  it('grounds feet on the street slab', () => {
    const w = buildTestCollider();
    expect(w.groundAt(50, 0.5, 50)).toBe(0.5);
  });

  it('grounds feet on rooftops and terraces', () => {
    const w = buildTestCollider();
    expect(w.groundAt(5, 20, 5)).toBe(20);
    expect(w.groundAt(25, 10, 25)).toBe(10.2);
  });

  it('allows a 0.55m step-up but not a full floor jump', () => {
    const w = buildTestCollider();
    expect(w.groundAt(25, 9.8, 25)).toBe(10.2);
    expect(w.groundAt(25, 9.0, 25)).toBe(0.5);
  });

  it('returns null where no floor exists', () => {
    const w = new WorldCollider();
    w.addBoxCoords(0, 0, 0, 10, 20, 10, 'wall');
    w.finalize();
    expect(w.groundAt(50, 5, 50)).toBeNull();
  });

  it('pushes a capsule out of walls with a normal', () => {
    const w = buildTestCollider();
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    w.pushOut(10.3, 5, 0.6, 0, 2, out);
    expect(out.pushed).toBe(true);
    expect(out.x).toBeCloseTo(10.6, 5);
    expect(out.nx).toBeCloseTo(1, 5);
  });

  it('ignores walls outside the capsule vertical span', () => {
    const w = buildTestCollider();
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    w.pushOut(5, 5, 0.6, 21, 23, out);
    expect(out.pushed).toBe(false);
  });

  it('leaves open space alone', () => {
    const w = buildTestCollider();
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    w.pushOut(50, 50, 0.6, 0, 2, out);
    expect(out.pushed).toBe(false);
    expect(out.x).toBe(50);
  });
});

describe('City Collision Shells Integration [8 + 29] - six-building ink district', () => {
  const cb = new CityBuilder();
  const coll = cb.getWorldCollider();

  it('blocks walking into the dockside terrace wall', () => {
    // Dockside east cheek at x=-41 (z=5 avoids the open stair-hall notch)
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-40.7, 5, 0.6, 0, 2, out);
    expect(out.pushed).toBe(true);
    expect(out.x).toBeCloseTo(-40.4, 5);
    expect(out.nx).toBeCloseTo(1, 5);
  });

  it('walks the dock stair hall from bridge deck to terrace without jumping', () => {
    // Step tops rise 15.9 -> 17.9 in 0.5 increments (0.55 step-up rule)
    const tops = [15.9, 16.4, 16.9, 17.4, 17.9];
    for (let k = 0; k < 5; k++) {
      const xc = -41.4 - k * 0.8;
      expect(coll.groundAt(xc, tops[k], 0)).toBe(tops[k]);
      if (k > 0) {
        expect(tops[k] - tops[k - 1]).toBeLessThanOrEqual(0.55);
      }
    }
    expect(coll.groundAt(-45.5, 18.0, 0)).toBe(18.0);
  });

  it('stands feet on the plaza tower roof', () => {
    expect(coll.groundAt(0, 62.0, 50.0)).toBe(62.0);
  });

  it('walks clean through the plaza tower pilotis parking deck', () => {
    // The one open ground floor in the district: bulk starts at the 5m podium,
    // so a capsule crosses the whole footprint at street level.
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    for (let z = 36; z <= 64; z += 2) {
      out.pushed = false;
      coll.pushOut(0.0, z, 0.35, 0.5, 2.3, out);
      expect(out.pushed, `pilotis deck blocked at z=${z}`).toBe(false);
    }
    // But the podium above it is solid, and its underside is a ceiling
    const above = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(0, 50, 0.35, 6.0, 7.8, above);
    expect(above.pushed).toBe(true);
    expect(coll.ceilingAt(-4.0, 1.0, 50.0)).toBe(5.0);
  });

  it('stands feet on the crown terrace ring, tiered balconies and upper roof', () => {
    // Setback ring at 52 between lower (|dx|<13) and upper (|dx|<8.58) tiers
    expect(coll.groundAt(65, 52.0, 0)).toBe(52.0);
    // Tiered balconies hang off the upper tier at 64 and 76
    expect(coll.groundAt(45, 76.0, 0)).toBe(76.0);
    expect(coll.groundAt(0 + 54, 88.0, 0)).toBe(88.0);
  });

  it('blocks walking into the crown facade', () => {
    // West face at x=41: a capsule nosing into it ejects to 40.4
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(41.3, 0, 0.6, 0, 2, out);
    expect(out.pushed).toBe(true);
    expect(out.x).toBeCloseTo(40.4, 5);
  });

  it('stands feet on a plaza tower perch ledge', () => {
    // West-face perch on the pilotis tower: 24m wide, so the ledge sits at -12.7
    expect(coll.groundAt(-12.7, 10.0, 50.0)).toBe(10.0);
  });

  it('stands feet on the warehouse roof and its tank deck', () => {
    expect(coll.groundAt(-54, 16.0, -50.0)).toBe(16.0);
    // Waterworks roof: twin tank decks stand above the roof slab
    const deck = coll.groundAt(-47.0, 22.0, -47.0, 0.55);
    expect(deck).not.toBeNull();
    expect(deck!).toBeGreaterThan(16.0);
  });

  it('blocks the smokestack and lamp posts', () => {
    const stack = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-63, -56, 0.6, 18, 20, stack);
    expect(stack.pushed).toBe(true);
    const lamp = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(16.0, 14.0, 0.6, 0.5, 2.3, lamp);
    expect(lamp.pushed).toBe(true);
  });

  it('parapets read as rails: roof edge blocks, roof center stands', () => {
    // Plaza tower roof centre stands free
    expect(coll.groundAt(0, 62.0, 50.0)).toBe(62.0);
    // North parapet strip on its z = 38 edge blocks horizontal entry
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(0, 38.1, 0.6, 62.0, 63.8, out);
    expect(out.pushed).toBe(true);
  });

  it('stands on the orchard row terrace ring and blocks the mansard bulk', () => {
    // Setback ring at 24 between lower (|dx|<13) and upper (|dx|<10.14) tiers
    expect(coll.groundAt(65.5, 24.0, 50.0)).toBe(24.0);
    // Its east face at x=67 blocks
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(66.5, 50, 0.6, 0, 2, out);
    expect(out.pushed).toBe(true);
  });

  it('walks under the theater marquee but not through the fly tower', () => {
    // Marquee floats at y 5: street-level passage beneath stays open
    const under = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-37.4, 50, 0.6, 0.5, 2.3, under);
    expect(under.pushed).toBe(false);
    // Fly tower rear block is solid
    const tower = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-63, 50, 0.6, 0, 2, tower);
    expect(tower.pushed).toBe(true);
  });

  it('stair-cutout hole has no slab, but the stair flight itself stands', () => {
    // Open hole away from the stairs (x 11.5, z -1): falls through to street
    expect(coll.groundAt(11.5, 5.5, -1.0)).toBe(0.5);

    // The stair flight at (9.5, z 1.0) is walkable: step top 3.5 stands
    expect(coll.groundAt(9.5, 3.5, 1.0)).toBe(3.5);

    // Outside the hole, solid slab stands firmly at 5.5
    expect(coll.groundAt(0, 5.5, 0)).toBe(5.5);
  });

  it('stands feet on construction site floor slabs at 5.5, 10.5, 15.5, 20.5', () => {
    for (const y of [5.5, 10.5, 15.5, 20.5]) {
      expect(coll.groundAt(0, y, 0)).toBe(y);
    }
  });

  it('construction columns block (no walking through pillars)', () => {
    // Column at (-3.5, z 0), floor 0: spans y 0.5..5.0
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-3.5, 0.2, 0.6, 0.5, 2.3, out);
    expect(out.pushed).toBe(true);
  });

  it('ceiling query finds slab undersides so jumps stop at floors', () => {
    // Head at 4.9 under floor-1 slab (underside 5.0) at (0, 0)
    expect(coll.ceilingAt(0, 4.9, 0)).toBe(5.0);
    // Open sky above the roof returns null
    expect(coll.ceilingAt(0, 30, 0)).toBeNull();
  });

  it('stair steps rise 0.5m so feet can walk up without jumping', () => {
    // Flight 0 ascends toward +z: consecutive step tops 0.5 apart
    const low = coll.groundAt(9.5, 1.0, -3.0);
    const mid = coll.groundAt(9.5, 1.5, -2.1);
    expect(low).toBe(1.0);
    expect(mid).toBe(1.5);
  });

  it('scaffold planks and crane jib are standable', () => {
    expect(coll.groundAt(0, 5.0, -12.4)).toBe(5.08);
    expect(coll.groundAt(20, 45.3, -2.0)).toBeCloseTo(45.38, 2);
  });

  it('exposes dumpBoxes() and dumpBounds() for debug toggles', () => {
    expect(coll.dumpBoxes()).toBeGreaterThan(50);
    const bounds = coll.dumpBounds();
    expect(bounds.length).toBe(coll.dumpBoxes());
    expect(bounds[0]).toHaveProperty('minX');
    expect(bounds[0]).toHaveProperty('tag');
  });
});

describe('WorldCollider - Raycasting and Line-Of-Sight (Terrace & Wall Penetration Prevention)', () => {
  it('raycast accurately detects wall hit distance, point and normal', () => {
    const w = new WorldCollider();
    w.addBoxCoords(0, 0, 0, 10, 20, 10, 'wall');
    w.finalize();

    const origin = new THREE.Vector3(5, 5, -10);
    const dir = new THREE.Vector3(0, 0, 1);
    const hit = w.raycast(origin, dir, 50);

    expect(hit).not.toBeNull();
    expect(hit!.dist).toBeCloseTo(10, 3);
    expect(hit!.point.x).toBeCloseTo(5, 3);
    expect(hit!.point.y).toBeCloseTo(5, 3);
    expect(hit!.point.z).toBeCloseTo(0, 3);
    expect(hit!.normal.z).toBeCloseTo(-1, 3);
  });

  it('raycast detects terrace floor slab from below', () => {
    const w = new WorldCollider();
    w.addBoxCoords(20, 15.0, 20, 40, 15.3, 40, 'floor'); // terrace floor slab
    w.finalize();

    const origin = new THREE.Vector3(30, 2, 30);
    const upDir = new THREE.Vector3(0, 1, 0);
    const hit = w.raycast(origin, upDir, 30);

    expect(hit).not.toBeNull();
    expect(hit!.dist).toBeCloseTo(13.0, 2);
    expect(hit!.point.y).toBeCloseTo(15.0, 2);
    expect(hit!.normal.y).toBeCloseTo(-1, 2);
  });

  it('hasLineOfSight blocks when standing behind a terrace parapet wall', () => {
    const w = new WorldCollider();
    // Terrace floor at y=20
    w.addBoxCoords(0, 19.8, 0, 30, 20.0, 30, 'floor');
    // Terrace parapet along South edge: y from 20.0 to 21.15
    w.addBoxCoords(0, 20.0, 0, 30, 21.15, 0.3, 'wall');
    w.finalize();

    // Enemy at y=20.5, south of the terrace
    const enemyMuzzle = new THREE.Vector3(15, 20.5, -15);
    // Player chest standing behind the parapet at y=20.9 (feet at 20.0)
    const playerChestCovered = new THREE.Vector3(15, 20.9, 5);

    expect(w.hasLineOfSight(enemyMuzzle, playerChestCovered)).toBe(false);

    // Player jumps above the 21.15m parapet to y=22.0: line of sight clears!
    const playerChestJumping = new THREE.Vector3(15, 22.0, 5);
    expect(w.hasLineOfSight(enemyMuzzle, playerChestJumping)).toBe(true);
  });

  it('hasLineOfSight blocks street enemies from seeing through building setback terraces', () => {
    const w = new WorldCollider();
    // Lower tier walls up to 20m
    w.addBoxCoords(-20, 0, -20, 20, 20, 20, 'wall');
    // Walkable setback terrace floor at 20m
    w.addBoxCoords(-20, 19.8, -20, 20, 20, 20, 'floor');
    // Upper tower set back from -10..10 up to 60m
    w.addBoxCoords(-10, 20, -10, 10, 60, 10, 'wall');
    w.finalize();

    // Enemy down on the street at (-25, 1.5, 0)
    const enemyStreet = new THREE.Vector3(-25, 1.5, 0);
    // Player on the setback terrace at (-15, 20.9, 0)
    const playerOnTerrace = new THREE.Vector3(-15, 20.9, 0);

    // Blocked by lower tier wall / terrace floor slab!
    expect(w.hasLineOfSight(enemyStreet, playerOnTerrace)).toBe(false);

    // Enemy on the other side of the building cannot see through upper tower
    const enemyFarSide = new THREE.Vector3(15, 20.9, 0);
    expect(w.hasLineOfSight(playerOnTerrace, enemyFarSide)).toBe(false);
  });
});

describe('North Two-Story Grand Central Atrium & Observatorium (x: 0, z: -50) - Solid Geometry & Walkthrough', () => {
  const cb = new CityBuilder();
  const coll = cb.getWorldCollider();

  it('registers on the minimap as a 24x20 footprint at (0, -50)', () => {
    const mapBuildings = cb.getMapBuildings();
    const depot = mapBuildings.find((b) => b.x === 0 && b.z === -50);
    expect(depot).toBeDefined();
    expect(depot!.w).toBe(24);
    expect(depot!.d).toBe(20);
  });

  it('main entrance double doors at (0, z: -40) are completely unobstructed', () => {
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(0.0, -40.0, 0.35, 0.6, 2.4, out);
    expect(out.pushed).toBe(false);
  });

  it('solid exterior walls beside entrance at (-6, z: -40) block and push out', () => {
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-6.0, -39.9, 0.35, 0.6, 2.4, out);
    expect(out.pushed).toBe(true);
    expect(out.nz).toBeGreaterThan(0);
  });

  it('stands on ground floor slab at y=0.6 with double-height open atrium void above', () => {
    expect(coll.groundAt(0.0, 0.6, -45.0)).toBe(0.6);
    // Atrium void is open up to the glass lantern skylight at y=10.7
    expect(coll.ceilingAt(0.0, 2.4, -45.0)).toBeCloseTo(10.7, 1);
  });

  it('ground floor twin wing archways are open to walk through', () => {
    const westOut = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    // Walking through west archway into Armory at x = -5.0, z = -48.5
    coll.pushOut(-5.0, -48.5, 0.35, 0.6, 2.4, westOut);
    expect(westOut.pushed).toBe(false);

    const eastOut = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    // Walking through east archway into Library at x = 5.0, z = -48.5
    coll.pushOut(5.0, -48.5, 0.35, 0.6, 2.4, eastOut);
    expect(eastOut.pushed).toBe(false);
  });

  it('armory crates and stacked crates are solid and climbable', () => {
    expect(coll.groundAt(-10.0, 2.2, -44.0)).toBe(2.2);
    expect(coll.groundAt(-9.1, 3.3, -44.1)).toBeCloseTo(3.3, 1);
  });

  it('central grand staircase steps are 100% solid with smooth continuous ramp ascent', () => {
    // Bottom step near entrance (z = -48.5)
    const yBottom = coll.groundAt(0.0, 1.0, -48.5);
    expect(yBottom).not.toBeNull();
    expect(yBottom!).toBeGreaterThan(0.6);
    expect(yBottom!).toBeLessThan(1.5);

    // Mid-flight step (z = -52.0)
    const yMid = coll.groundAt(0.0, 3.0, -52.0);
    expect(yMid).not.toBeNull();
    expect(yMid!).toBeCloseTo(3.2, 1);

    // Top step near 2nd floor landing (z = -55.5)
    const yTop = coll.groundAt(0.0, 5.0, -55.5);
    expect(yTop).not.toBeNull();
    expect(yTop!).toBeGreaterThan(4.8);
    expect(yTop!).toBeLessThanOrEqual(5.2);

    // Staircase side balustrade wall at x = -2.55 blocks stepping off the side
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-2.55, -52.0, 0.35, 2.0, 3.8, out);
    expect(out.pushed).toBe(true);
  });

  it('second floor mezzanine slabs stand at y=5.2 with solid balustrades overlooking the atrium', () => {
    // South walkway standing
    expect(coll.groundAt(0.0, 5.2, -41.5)).toBe(5.2);
    // West gallery standing
    expect(coll.groundAt(-8.0, 5.2, -48.0)).toBe(5.2);
    // Ceiling above West gallery is roof slab at 9.4
    expect(coll.ceilingAt(-8.0, 7.0, -48.0)).toBe(9.4);

    // Mezzanine balustrade wall at z = -43.0 blocks walking off into atrium void
    const railOut = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(0.0, -42.95, 0.35, 5.2, 7.0, railOut);
    expect(railOut.pushed).toBe(true);
  });

  it('NE corner staircase provides solid smooth ascent to rooftop cupola', () => {
    const yMid = coll.groundAt(10.0, 7.5, -54.8);
    expect(yMid).not.toBeNull();
    expect(yMid!).toBeCloseTo(7.8, 1);
  });

  it('rooftop terrace is solid at y=9.8, parapets block perimeter, and cupola door is open', () => {
    // Rooftop floor
    expect(coll.groundAt(-2.0, 9.8, -42.0)).toBe(9.8);
    // Open sky above rooftop
    expect(coll.ceilingAt(-2.0, 11.6, -42.0)).toBeNull();

    // South parapet wall blocks walk-off
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(0.0, -40.1, 0.35, 9.8, 11.6, out);
    expect(out.pushed).toBe(true);

    // Cupola door exit at x = 8.0, z = -57.0 is open onto the roof
    const cupolaDoorOut = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(8.0, -57.0, 0.35, 9.8, 11.6, cupolaDoorOut);
    expect(cupolaDoorOut.pushed).toBe(false);

    // Raised central glass lantern skylight has standable glass top
    expect(coll.groundAt(0.0, 10.9, -47.5)).toBeCloseTo(10.9, 1);
  });

  it('simulates walking from ground level up the grand stairs to the 2nd floor smoothly without jumping', () => {
    let px = 0;
    let pz = -46.0;
    let feetY = 0.6;
    const r = 0.35;
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };

    let blockedSteps: Array<{ pz: number, feetY: number, pushedZ: number, nz: number }> = [];

    for (let step = 0; step < 300; step++) {
      pz -= 0.05;
      const top = coll.groundAt(px, feetY, pz, 0.55);
      if (top !== null) {
        feetY = top;
      }
      coll.pushOut(px, pz, r, feetY, feetY + 1.8, out);
      if (out.pushed) {
        blockedSteps.push({ pz, feetY, pushedZ: out.z, nz: out.nz });
        pz = out.z;
        px = out.x;
      }
      if (pz <= -58.0) {
        break;
      }
    }

    expect(blockedSteps.length).toBe(0);
    expect(pz).toBeLessThanOrEqual(-58.0);
    expect(feetY).toBeCloseTo(5.2, 1);
  });

  it('allows unobstructed turning left and right from the 2nd floor stair landing', () => {
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };

    // At z = -56.5 (landing), turn left towards West Gallery
    for (let x = 0; x >= -4.5; x -= 0.2) {
      coll.pushOut(x, -56.5, 0.35, 5.2, 7.0, out);
      expect(out.pushed).toBe(false);
      expect(coll.groundAt(x, 5.2, -56.5)).toBeCloseTo(5.2, 1);
    }

    // At z = -56.5 (landing), turn right towards East Gallery
    for (let x = 0; x <= 4.5; x += 0.2) {
      coll.pushOut(x, -56.5, 0.35, 5.2, 7.0, out);
      expect(out.pushed).toBe(false);
      expect(coll.groundAt(x, 5.2, -56.5)).toBeCloseTo(5.2, 1);
    }
  });

  it('simulates walking up the NE roof staircase from 2nd floor to rooftop cupola without jumping', () => {
    let px = 10.0;
    let pz = -51.0;
    let feetY = 5.2;
    const r = 0.35;
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };

    let blockedSteps: Array<{ pz: number, feetY: number, pushedZ: number, nz: number }> = [];

    for (let step = 0; step < 200; step++) {
      pz -= 0.05;
      const top = coll.groundAt(px, feetY, pz, 0.55);
      if (top !== null) {
        feetY = top;
      }
      coll.pushOut(px, pz, r, feetY, feetY + 1.8, out);
      if (out.pushed) {
        blockedSteps.push({ pz, feetY, pushedZ: out.z, nz: out.nz });
        pz = out.z;
        px = out.x;
      }
      if (pz <= -57.6) {
        break;
      }
    }

    expect(blockedSteps.length).toBe(0);
    expect(pz).toBeLessThanOrEqual(-57.6);
    expect(feetY).toBeCloseTo(9.8, 1);

    // From top of stair (x = 10.0, z = -57.6, y = 9.8), walk through cupola door at x = 8.0, z = -57.0 onto roof
    for (let x = 10.0; x >= 6.0; x -= 0.2) {
      coll.pushOut(x, -57.2, 0.35, 9.8, 11.6, out);
      expect(out.pushed).toBe(false);
    }
    // Now standing outside cupola on rooftop deck
    expect(coll.groundAt(6.0, 9.8, -57.2)).toBeCloseTo(9.8, 1);
  });

  it('ground floor solid back wall prevents walking into the underside of the stairs', () => {
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    // Walking south from z = -56.5 towards the stairs at x = 0 on ground floor (y = 0.6)
    coll.pushOut(0.0, -56.1, 0.35, 0.6, 2.4, out);
    expect(out.pushed).toBe(true);
    expect(out.nz).toBeLessThan(0); // Pushed north away from back wall
  });
});




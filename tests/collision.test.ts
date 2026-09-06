import { describe, it, expect } from 'vitest';
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

  it('stands feet on the brick walkup roof terrace', () => {
    expect(coll.groundAt(0, 15.0, 42.0)).toBe(15.0);
  });

  it('stands feet on the deco crown terrace ring and upper roof', () => {
    // Terrace ring between lower (|x|<13) and upper (|x|<9.36) tiers at 56
    expect(coll.groundAt(11, 56.0, 68.0)).toBe(56.0);
    expect(coll.groundAt(0, 88.0, 68.0)).toBe(88.0);
  });

  it('blocks walking into the glass slab', () => {
    // West face at x=42: a capsule nosing into the facade ejects to 41.4
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(42.3, 0, 0.6, 0, 2, out);
    expect(out.pushed).toBe(true);
    expect(out.x).toBeCloseTo(41.4, 5);
  });

  it('stands feet on a ledge-tower perch ledge', () => {
    // West-face perch at world x=55.7, first level y=10
    expect(coll.groundAt(55.7, 10.0, 46.0)).toBe(10.0);
  });

  it('stands feet on the waterworks roof and the walkup tank deck', () => {
    expect(coll.groundAt(-46, 13.0, -44.0)).toBe(13.0);
    // Walkup tank deck ring top at 15 + 4.5 + 0.25 = 19.75
    expect(coll.groundAt(4.2, 19.75, 44.8)).toBe(19.75);
  });

  it('blocks the smokestack and lamp posts', () => {
    const stack = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-55, -50, 0.6, 13, 15, stack);
    expect(stack.pushed).toBe(true);
    const lamp = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(28.2, 28, 0.6, 0, 2, lamp);
    expect(lamp.pushed).toBe(true);
  });

  it('parapets read as rails: roof edge blocks, roof center stands', () => {    // Walkup roof center stands free
    expect(coll.groundAt(0, 15.0, 42.0)).toBe(15.0);
    // North parapet strip at z=50-0.175..50 blocks horizontal entry
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(0, 49.9, 0.6, 15.0, 16.8, out);
    expect(out.pushed).toBe(true);
  });

  it('stands on the copper terrace ring and blocks the mansard bulk', () => {
    // Setback ring at 24 between lower (|x|<11) and upper (|x|<7.92) tiers
    expect(coll.groundAt(57.5, 24.0, -48.0)).toBe(24.0);
    // Copper east face at x=59 blocks
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(58.5, -48, 0.6, 0, 2, out);
    expect(out.pushed).toBe(true);
  });

  it('walks under the theater marquee but not through the fly tower', () => {
    // Marquee floats at y 5: street-level passage beneath stays open
    const under = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-31.4, 48, 0.6, 0.5, 2.3, under);
    expect(under.pushed).toBe(false);
    // Fly tower rear block is solid
    const tower = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(-54, 48, 0.6, 0, 2, tower);
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


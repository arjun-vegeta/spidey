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

describe('City Collision Shells Integration [8 + 29]', () => {
  const cb = new CityBuilder();
  const coll = cb.getWorldCollider();

  it('stands feet on balcony floor', () => {
    // Balcony on East-1 tower at x=42.9, y=18, z=0
    expect(coll.groundAt(42.9, 18.0, 0.0)).toBe(18.0);
  });

  it('blocks walk-off at balcony outer railing (push-out)', () => {
    // Outer rail at x=41.8..41.95 on balcony level y=18
    const out = { x: 0, z: 0, nx: 0, nz: 0, pushed: false };
    coll.pushOut(41.7, 0, 0.6, 18.0, 19.8, out);
    expect(out.pushed).toBe(true);
    expect(out.nx).toBe(-1);
  });

  it('stands feet on artdeco setback terrace ring', () => {
    // North-1 setback terrace ring at z=75.5, y=52
    expect(coll.groundAt(0, 52.0, 75.5)).toBe(52.0);
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


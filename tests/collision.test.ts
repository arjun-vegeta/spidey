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

  it('stair-cutout hole is NOT ground (falls through to street)', () => {
    // In stairwell cutout (x: 6..13, z: -4..6), floor 1 at 5.5 is open
    expect(coll.groundAt(9.5, 5.5, 1.0)).not.toBe(5.5);
    expect(coll.groundAt(9.5, 5.5, 1.0)).toBe(0.5);

    // Outside the hole, solid slab stands firmly at 5.5
    expect(coll.groundAt(0, 5.5, 0)).toBe(5.5);
  });

  it('stands feet on construction site floor slabs at 5.5, 10.5, 15.5, 20.5', () => {
    for (const y of [5.5, 10.5, 15.5, 20.5]) {
      expect(coll.groundAt(0, y, 0)).toBe(y);
    }
  });

  it('exposes dumpBoxes() and dumpBounds() for debug toggles', () => {
    expect(coll.dumpBoxes()).toBeGreaterThan(50);
    const bounds = coll.dumpBounds();
    expect(bounds.length).toBe(coll.dumpBoxes());
    expect(bounds[0]).toHaveProperty('minX');
    expect(bounds[0]).toHaveProperty('tag');
  });
});


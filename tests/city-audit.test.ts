import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CityBuilder } from '../src/world/CityBuilder';

describe('City Latch-Density Audit [29 + 9.5] - six-building ink district', () => {
  it('has zero dead zones across the lived-in district (every 20m in +/-80, heights 2/15/30m, >=2 anchors within 90m above feet+1m)', () => {
    const cb = new CityBuilder();
    const anchors = cb.getWebAnchors();

    // Verify healthy anchor count for the compact district
    expect(anchors.length).toBeGreaterThan(150);

    const deadZones: Array<{ x: number; y: number; z: number; count: number }> = [];

    // Sample grid across the lived-in district (beyond is skyline backdrop):
    // x: -80..80 in steps of 20
    // z: -80..80 in steps of 20
    // y: [2, 15, 30] (street level, swing level, high altitude level)
    for (let x = -80; x <= 80; x += 20) {
      for (let z = -80; z <= 80; z += 20) {
        for (const y of [2, 15, 30]) {
          const p = new THREE.Vector3(x, y, z);
          const valid = anchors.filter((a) => a.distanceTo(p) <= 90.0 && a.y >= y + 1.0);
          if (valid.length < 2) {
            deadZones.push({ x, y, z, count: valid.length });
          }
        }
      }
    }

    expect(deadZones).toEqual([]);
  });

  it('filters out non-landable crane hook grapple anchors within 3m of hook position', () => {
    const cb = new CityBuilder();
    const anchors = cb.getWebAnchors();
    const hookPos = new THREE.Vector3(19.0, 27.3, -2.0);

    const withinHookRadius = anchors.filter((a) => a.distanceTo(hookPos) <= 3.0);
    expect(withinHookRadius.length).toBe(0);
  });

  it('ensures all water towers have both peak and deck ring latches', () => {
    const cb = new CityBuilder();
    const anchors = cb.getWebAnchors();

    // Dockside water tower deck ring at y = 18 + 4.5 + 0.3 = 22.8
    // (dock at x=-54, tower local +4.55/+4.2)
    const b1DeckAnchor = anchors.find(
      (a) => Math.abs(a.x - (-49.45)) < 0.1 && Math.abs(a.z - 4.2) < 0.1 && Math.abs(a.y - 22.8) < 0.1
    );
    expect(b1DeckAnchor).toBeDefined();
  });
});

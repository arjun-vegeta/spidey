import * as THREE from 'three';
import { CHARACTER_HEIGHT } from '../core/CoverMetrics';

/**
 * SPAWN SELECTION for deathmatch.
 *
 * The spawn set is borrowed from the AI patrol nodes, which is not laziness:
 * those points are already proven to be standable floor across every level of
 * the building, spread over the whole play space. Reusing them means PvP
 * spawns can never drop somebody inside geometry.
 */
export class DeathmatchSpawns {
  /** Capsule-centre positions, ready to hand straight to `physics.reset`. */
  private readonly points: THREE.Vector3[] = [];
  private lastIndex = -1;

  /**
   * @param footPositions Floor-level positions (feet), as the AI nodes store them.
   */
  constructor(footPositions: THREE.Vector3[]) {
    const seen = new Set<string>();
    for (const p of footPositions) {
      // Dedupe: several patrol nodes share a floor position.
      const key = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.points.push(new THREE.Vector3(p.x, p.y + CHARACTER_HEIGHT * 0.5, p.z));
    }
    if (this.points.length === 0) {
      this.points.push(new THREE.Vector3(0, 4.0, 18.0));
    }
  }

  public get count(): number {
    return this.points.length;
  }

  /**
   * Picks the spawn furthest from every living opponent, so you rarely
   * materialise in someone's crosshair. Ties break away from the spawn we used
   * last time, which stops two consecutive deaths putting you back on the same
   * rooftop for a camper to farm.
   */
  public pick(opponents: THREE.Vector3[]): THREE.Vector3 {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      let nearest = Infinity;
      for (const o of opponents) {
        const d = p.distanceToSquared(o);
        if (d < nearest) nearest = d;
      }
      // With nobody alive to avoid, every point scores equally and the
      // repeat penalty alone decides — which is what rotates spawns.
      let score = opponents.length === 0 ? 0 : nearest;
      if (i === this.lastIndex) score -= 400;
      score += Math.random() * 25; // Break exact ties without clumping.

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    this.lastIndex = bestIndex;
    return this.points[bestIndex].clone();
  }
}

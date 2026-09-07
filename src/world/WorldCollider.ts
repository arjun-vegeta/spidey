import * as THREE from 'three';

export type ColliderTag = 'wall' | 'floor' | 'solid';

export interface PushResult {
  x: number; z: number; nx: number; nz: number; pushed: boolean;
}

export interface BoxBounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  tag: ColliderTag;
}

export interface RampBounds {
  minX: number; minZ: number;
  maxX: number; maxZ: number;
  axis: 'x' | 'z';
  y0: number; // Y height at min coordinate (minZ or minX)
  y1: number; // Y height at max coordinate (maxZ or maxX)
  thickness: number;
}

export interface WorldRaycastHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  box: BoxBounds;
}

/**
 * Simplified collision shells for the city. Visuals are NEVER colliders:
 * each building registers a few big boxes and sloped ramps here. Spatial hash grid (8m cells)
 * keeps queries cheap. Zero allocations after finalize().
 */
export class WorldCollider {
  private boxes: BoxBounds[] = [];
  private ramps: RampBounds[] = [];
  private grid: Map<string, number[]> = new Map();
  private rampGrid: Map<string, number[]> = new Map();
  private readonly cell: number = 8;
  private finalized: boolean = false;

  private boxQueryMarks: Int32Array = new Int32Array(1024);
  private rampQueryMarks: Int32Array = new Int32Array(256);
  private queryId: number = 0;
  private tempIndices: number[] = [];
  private tempRampIndices: number[] = [];

  private cachedHit: WorldRaycastHit = {
    dist: 0,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    box: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, tag: 'wall' },
  };

  /** Total number of collider boxes registered. */
  public dumpBoxes(): number {
    return this.boxes.length;
  }

  /** Total number of collider ramps registered. */
  public dumpRamps(): number {
    return this.ramps.length;
  }

  /** Read-only snapshot of all collider boxes for debugging/visualization. */
  public dumpBounds(): BoxBounds[] {
    return this.boxes.map((b) => ({ ...b }));
  }

  /** Read-only snapshot of all collider ramps. */
  public dumpRampBounds(): RampBounds[] {
    return this.ramps.map((r) => ({ ...r }));
  }

  public addBox(min: THREE.Vector3, max: THREE.Vector3, tag: ColliderTag): void {
    this.boxes.push({
      minX: Math.min(min.x, max.x), minY: Math.min(min.y, max.y), minZ: Math.min(min.z, max.z),
      maxX: Math.max(min.x, max.x), maxY: Math.max(min.y, max.y), maxZ: Math.max(min.z, max.z),
      tag,
    });
    this.finalized = false;
  }

  public addBoxCoords(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tag: ColliderTag): void {
    this.boxes.push({ minX, minY, minZ, maxX, maxY, maxZ, tag });
    this.finalized = false;
  }

  /**
   * Registers a continuous sloped roof / ramp shell.
   * axis === 'z': rises from y0 at minZ to y1 at maxZ.
   * axis === 'x': rises from y0 at minX to y1 at maxX.
   */
  public addRampCoords(
    minX: number, minZ: number, maxX: number, maxZ: number,
    axis: 'x' | 'z', y0: number, y1: number, thickness: number = 0.3
  ): void {
    this.ramps.push({
      minX: Math.min(minX, maxX),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxZ: Math.max(minZ, maxZ),
      axis,
      y0,
      y1,
      thickness,
    });
    this.finalized = false;
  }

  public finalize(): void {
    this.grid.clear();
    this.rampGrid.clear();
    const m = 1.0;

    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      const x0 = Math.floor((b.minX - m) / this.cell);
      const x1 = Math.floor((b.maxX + m) / this.cell);
      const z0 = Math.floor((b.minZ - m) / this.cell);
      const z1 = Math.floor((b.maxZ + m) / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cx + ',' + cz;
          let arr = this.grid.get(key);
          if (!arr) {
            arr = [];
            this.grid.set(key, arr);
          }
          arr.push(i);
        }
      }
    }

    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      const x0 = Math.floor((r.minX - m) / this.cell);
      const x1 = Math.floor((r.maxX + m) / this.cell);
      const z0 = Math.floor((r.minZ - m) / this.cell);
      const z1 = Math.floor((r.maxZ + m) / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cx + ',' + cz;
          let arr = this.rampGrid.get(key);
          if (!arr) {
            arr = [];
            this.rampGrid.set(key, arr);
          }
          arr.push(i);
        }
      }
    }

    this.finalized = true;
  }

  /**
   * Queries all overlapping boxes within an AABB query range across grid cells with deduplication.
   */
  private queryBoxIndices(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): void {
    if (!this.finalized) this.finalize();
    out.length = 0;
    const x0 = Math.floor(minX / this.cell);
    const x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell);
    const z1 = Math.floor(maxZ / this.cell);

    if (x0 === x1 && z0 === z1) {
      const arr = this.grid.get(x0 + ',' + z0);
      if (arr) {
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
      return;
    }

    this.queryId++;
    if (this.boxQueryMarks.length < this.boxes.length) {
      this.boxQueryMarks = new Int32Array(Math.max(this.boxes.length * 2, 1024));
    }
    const qid = this.queryId;
    const marks = this.boxQueryMarks;

    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(cx + ',' + cz);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const idx = arr[i];
          if (marks[idx] !== qid) {
            marks[idx] = qid;
            out.push(idx);
          }
        }
      }
    }
  }

  /**
   * Queries all overlapping ramps within an AABB query range across grid cells with deduplication.
   */
  private queryRampIndices(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): void {
    if (!this.finalized) this.finalize();
    out.length = 0;
    const x0 = Math.floor(minX / this.cell);
    const x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell);
    const z1 = Math.floor(maxZ / this.cell);

    if (x0 === x1 && z0 === z1) {
      const arr = this.rampGrid.get(x0 + ',' + z0);
      if (arr) {
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
      return;
    }

    this.queryId++;
    if (this.rampQueryMarks.length < this.ramps.length) {
      this.rampQueryMarks = new Int32Array(Math.max(this.ramps.length * 2, 256));
    }
    const qid = this.queryId;
    const marks = this.rampQueryMarks;

    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.rampGrid.get(cx + ',' + cz);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const idx = arr[i];
          if (marks[idx] !== qid) {
            marks[idx] = qid;
            out.push(idx);
          }
        }
      }
    }
  }

  /**
   * Highest floor or sloped roof top at (x,z) that feet can stand on (allows maxStepUp step-up, default 0.55m).
   * Returns floor top Y or null.
   */
  public groundAt(x: number, feetY: number, z: number, maxStepUp: number = 0.55): number | null {
    let best: number | null = null;
    const margin = 0.4;

    // 1. Box floors and solid tops
    this.queryBoxIndices(x - margin, z - margin, x + margin, z + margin, this.tempIndices);
    const idx = this.tempIndices;
    for (let k = 0; k < idx.length; k++) {
      const b = this.boxes[idx[k]];
      if (b.tag !== 'floor' && b.tag !== 'solid') continue;
      if (x < b.minX - 0.3 || x > b.maxX + 0.3 || z < b.minZ - 0.3 || z > b.maxZ + 0.3) continue;
      if (b.maxY > feetY + maxStepUp) continue;
      if (best === null || b.maxY > best) best = b.maxY;
    }

    // 2. Sloped roofs / ramps (continuous height function)
    this.queryRampIndices(x - margin, z - margin, x + margin, z + margin, this.tempRampIndices);
    const rIdx = this.tempRampIndices;
    for (let k = 0; k < rIdx.length; k++) {
      const r = this.ramps[rIdx[k]];
      if (x < r.minX - 0.3 || x > r.maxX + 0.3 || z < r.minZ - 0.3 || z > r.maxZ + 0.3) continue;
      const t = r.axis === 'z'
        ? ((r.maxZ - r.minZ > 1e-5) ? (Math.max(r.minZ, Math.min(z, r.maxZ)) - r.minZ) / (r.maxZ - r.minZ) : 0)
        : ((r.maxX - r.minX > 1e-5) ? (Math.max(r.minX, Math.min(x, r.maxX)) - r.minX) / (r.maxX - r.minX) : 0);
      const slopeY = r.y0 + t * (r.y1 - r.y0);
      if (slopeY > feetY + maxStepUp) continue;
      if (best === null || slopeY > best) best = slopeY;
    }

    return best;
  }

  /**
   * Lowest floor underside above the head at (x,z). Null when open sky.
   * Used for the ceiling clamp so jumps can't pass through slabs or sloped ceilings.
   */
  public ceilingAt(x: number, headY: number, z: number): number | null {
    let best: number | null = null;
    const margin = 0.4;

    // 1. Box ceilings and solid undersides
    this.queryBoxIndices(x - margin, z - margin, x + margin, z + margin, this.tempIndices);
    const idx = this.tempIndices;
    for (let k = 0; k < idx.length; k++) {
      const b = this.boxes[idx[k]];
      if (b.tag !== 'floor' && b.tag !== 'solid') continue;
      if (x < b.minX - 0.3 || x > b.maxX + 0.3 || z < b.minZ - 0.3 || z > b.maxZ + 0.3) continue;
      if (b.minY < headY) continue;
      if (best === null || b.minY < best) best = b.minY;
    }

    // 2. Sloped roof undersides
    this.queryRampIndices(x - margin, z - margin, x + margin, z + margin, this.tempRampIndices);
    const rIdx = this.tempRampIndices;
    for (let k = 0; k < rIdx.length; k++) {
      const r = this.ramps[rIdx[k]];
      if (x < r.minX - 0.3 || x > r.maxX + 0.3 || z < r.minZ - 0.3 || z > r.maxZ + 0.3) continue;
      const t = r.axis === 'z'
        ? ((r.maxZ - r.minZ > 1e-5) ? (Math.max(r.minZ, Math.min(z, r.maxZ)) - r.minZ) / (r.maxZ - r.minZ) : 0)
        : ((r.maxX - r.minX > 1e-5) ? (Math.max(r.minX, Math.min(x, r.maxX)) - r.minX) / (r.maxX - r.minX) : 0);
      const underY = r.y0 + t * (r.y1 - r.y0) - (r.thickness ?? 0.3);
      if (underY < headY) continue;
      if (best === null || underY < best) best = underY;
    }

    return best;
  }

  /**
   * Horizontal push-out of a circle (x,z,r) against wall boxes overlapping [minY,maxY].
   * Writes resolved position + normal into out (reuse one scratch object, zero garbage).
   */
  public pushOut(
    x: number, z: number, r: number,
    minY: number, maxY: number,
    out: PushResult,
    _velX?: number, _velZ?: number
  ): void {
    out.x = x;
    out.z = z;
    out.nx = 0;
    out.nz = 0;
    out.pushed = false;

    let px = x;
    let pz = z;

    // 3-pass relaxation to cleanly resolve acute and 90-degree internal corners
    for (let pass = 0; pass < 3; pass++) {
      this.queryBoxIndices(px - r, pz - r, px + r, pz + r, this.tempIndices);
      const idx = this.tempIndices;

      for (let k = 0; k < idx.length; k++) {
        const b = this.boxes[idx[k]];
        if (b.tag !== 'wall' && b.tag !== 'solid') continue;
        // Exact vertical interval overlap between wall box [b.minY, b.maxY] and player capsule [minY, maxY]
        // 0.04m tolerance so feet standing on a solid box top do not get pushed horizontally
        if (b.maxY <= minY + 0.04 || b.minY >= maxY) continue;

        // If standing on or near the top of a solid box (rooftop/terrace/parapet), the box is a floor beneath feet, not a wall
        if (b.tag === 'solid' && minY >= b.maxY - 0.25) continue;

        const cx = Math.max(b.minX, Math.min(px, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
        const dx = px - cx;
        const dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;

        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          px += dx * push;
          pz += dz * push;
          out.nx = dx / d;
          out.nz = dz / d;
          out.pushed = true;
        } else {
          // Inside box: resolve along axis of minimum penetration (closest boundary)
          const exMin = px - b.minX;
          const exMax = b.maxX - px;
          const ezMin = pz - b.minZ;
          const ezMax = b.maxZ - pz;
          const m = Math.min(exMin, exMax, ezMin, ezMax);
          if (m === exMin) { px = b.minX - r; out.nx = -1; out.nz = 0; }
          else if (m === exMax) { px = b.maxX + r; out.nx = 1; out.nz = 0; }
          else if (m === ezMin) { pz = b.minZ - r; out.nx = 0; out.nz = -1; }
          else { pz = b.maxZ + r; out.nx = 0; out.nz = 1; }
          out.pushed = true;
        }
      }
    }

    out.x = px;
    out.z = pz;
  }

  /**
   * Raycast against solid collider boxes and sloped ramps using the slab algorithm.
   * Reuses a single preallocated hit object for zero runtime allocations.
   * If caller needs to preserve the hit across queries, clone/copy point and normal.
   */
  public raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDist: number = 1000,
    ignoreTag?: ColliderTag
  ): WorldRaycastHit | null {
    if (!this.finalized) this.finalize();
    if (maxDist <= 0) return null;

    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    const endX = ox + dx * maxDist;
    const endZ = oz + dz * maxDist;
    const minX = Math.min(ox, endX) - 0.2;
    const maxX = Math.max(ox, endX) + 0.2;
    const minZ = Math.min(oz, endZ) - 0.2;
    const maxZ = Math.max(oz, endZ) + 0.2;

    const cellSpanX = Math.ceil((maxX - minX) / this.cell);
    const cellSpanZ = Math.ceil((maxZ - minZ) / this.cell);

    let candidates: number[] | null;
    let count: number;

    // Use grid when query AABB is local (< 36 cells); fallback to all boxes if long ray
    if (cellSpanX * cellSpanZ <= 36) {
      this.queryBoxIndices(minX, minZ, maxX, maxZ, this.tempIndices);
      candidates = this.tempIndices;
      count = candidates.length;
    } else {
      count = this.boxes.length;
      candidates = null;
    }

    let bestDist = maxDist;
    let bestBox: BoxBounds | null = null;
    let bestAxis = -1;
    let bestSign = 0;

    for (let i = 0; i < count; i++) {
      const b = candidates ? this.boxes[candidates[i]] : this.boxes[i];
      if (ignoreTag && b.tag === ignoreTag) continue;

      // Slab test
      let tmin = 1e-4; // Small epsilon to avoid self-intersection on boundary
      let tmax = bestDist;
      let nAxis = -1;
      let nSign = 0;
      let hit = true;

      // Axis X
      if (Math.abs(dx) < 1e-9) {
        if (ox < b.minX || ox > b.maxX) hit = false;
      } else {
        const inv = 1.0 / dx;
        let t1 = (b.minX - ox) * inv;
        let t2 = (b.maxX - ox) * inv;
        let s = -1;
        if (t1 > t2) {
          const temp = t1; t1 = t2; t2 = temp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nAxis = 0;
          nSign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      // Axis Y
      if (Math.abs(dy) < 1e-9) {
        if (oy < b.minY || oy > b.maxY) hit = false;
      } else {
        const inv = 1.0 / dy;
        let t1 = (b.minY - oy) * inv;
        let t2 = (b.maxY - oy) * inv;
        let s = -1;
        if (t1 > t2) {
          const temp = t1; t1 = t2; t2 = temp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nAxis = 1;
          nSign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      // Axis Z
      if (Math.abs(dz) < 1e-9) {
        if (oz < b.minZ || oz > b.maxZ) hit = false;
      } else {
        const inv = 1.0 / dz;
        let t1 = (b.minZ - oz) * inv;
        let t2 = (b.maxZ - oz) * inv;
        let s = -1;
        if (t1 > t2) {
          const temp = t1; t1 = t2; t2 = temp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          nAxis = 2;
          nSign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      // If origin was strictly inside the box, tmin remained 1e-4 and nAxis is -1
      if (nAxis < 0) {
        bestDist = 0;
        bestBox = b;
        bestAxis = 1;
        bestSign = 1;
        break;
      }

      if (tmin < bestDist) {
        bestDist = tmin;
        bestBox = b;
        bestAxis = nAxis;
        bestSign = nSign;
      }
    }

    // Also check ramps
    if (this.ramps.length > 0) {
      for (let rIdx = 0; rIdx < this.ramps.length; rIdx++) {
        const r = this.ramps[rIdx];
        const rMinY = Math.min(r.y0, r.y1) - (r.thickness ?? 0.3);
        const rMaxY = Math.max(r.y0, r.y1);

        let tmin = 1e-4;
        let tmax = bestDist;
        let nAxis = -1;
        let nSign = 0;
        let hit = true;

        if (Math.abs(dx) < 1e-9) {
          if (ox < r.minX || ox > r.maxX) hit = false;
        } else {
          const inv = 1.0 / dx;
          let t1 = (r.minX - ox) * inv;
          let t2 = (r.maxX - ox) * inv;
          let s = -1;
          if (t1 > t2) { const temp = t1; t1 = t2; t2 = temp; s = 1; }
          if (t1 > tmin) { tmin = t1; nAxis = 0; nSign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) hit = false;
        }
        if (!hit) continue;

        if (Math.abs(dy) < 1e-9) {
          if (oy < rMinY || oy > rMaxY) hit = false;
        } else {
          const inv = 1.0 / dy;
          let t1 = (rMinY - oy) * inv;
          let t2 = (rMaxY - oy) * inv;
          let s = -1;
          if (t1 > t2) { const temp = t1; t1 = t2; t2 = temp; s = 1; }
          if (t1 > tmin) { tmin = t1; nAxis = 1; nSign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) hit = false;
        }
        if (!hit) continue;

        if (Math.abs(dz) < 1e-9) {
          if (oz < r.minZ || oz > r.maxZ) hit = false;
        } else {
          const inv = 1.0 / dz;
          let t1 = (r.minZ - oz) * inv;
          let t2 = (r.maxZ - oz) * inv;
          let s = -1;
          if (t1 > t2) { const temp = t1; t1 = t2; t2 = temp; s = 1; }
          if (t1 > tmin) { tmin = t1; nAxis = 2; nSign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) hit = false;
        }
        if (!hit) continue;

        if (nAxis < 0) {
          bestDist = 0;
          bestBox = { minX: r.minX, minY: rMinY, minZ: r.minZ, maxX: r.maxX, maxY: rMaxY, maxZ: r.maxZ, tag: 'floor' };
          bestAxis = 1;
          bestSign = 1;
          break;
        }

        if (tmin < bestDist) {
          bestDist = tmin;
          bestBox = { minX: r.minX, minY: rMinY, minZ: r.minZ, maxX: r.maxX, maxY: rMaxY, maxZ: r.maxZ, tag: 'floor' };
          bestAxis = nAxis;
          bestSign = nSign;
        }
      }
    }

    if (!bestBox) return null;

    const hitResult = this.cachedHit;
    hitResult.dist = bestDist;
    hitResult.point.set(ox + dx * bestDist, oy + dy * bestDist, oz + dz * bestDist);
    hitResult.normal.set(
      bestAxis === 0 ? bestSign : 0,
      bestAxis === 1 ? bestSign : 0,
      bestAxis === 2 ? bestSign : 0
    );
    hitResult.box = bestBox;
    return hitResult;
  }

  /**
   * Fast analytical line-of-sight test between points a and b.
   * Returns false as soon as any solid, wall, or floor box obstructs the line segment.
   * Zero heap allocations.
   */
  public hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (!this.finalized) this.finalize();

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < 1e-6) return true;

    const dist = Math.sqrt(distSq);
    const invDist = 1.0 / dist;
    const dirX = dx * invDist;
    const dirY = dy * invDist;
    const dirZ = dz * invDist;

    // Small clearance margin at the ends (0.1m) so standing on a floor doesn't self-occlude target
    const maxT = dist - 0.1;
    if (maxT <= 0.05) return true;

    const ox = a.x;
    const oy = a.y;
    const oz = a.z;

    const minX = Math.min(ox, b.x) - 0.2;
    const maxX = Math.max(ox, b.x) + 0.2;
    const minZ = Math.min(oz, b.z) - 0.2;
    const maxZ = Math.max(oz, b.z) + 0.2;

    const cellSpanX = Math.ceil((maxX - minX) / this.cell);
    const cellSpanZ = Math.ceil((maxZ - minZ) / this.cell);

    let candidates: number[] | null;
    let count: number;

    if (cellSpanX * cellSpanZ <= 36) {
      this.queryBoxIndices(minX, minZ, maxX, maxZ, this.tempIndices);
      candidates = this.tempIndices;
      count = candidates.length;
    } else {
      count = this.boxes.length;
      candidates = null;
    }

    for (let i = 0; i < count; i++) {
      const box = candidates ? this.boxes[candidates[i]] : this.boxes[i];

      let tmin = 1e-4;
      let tmax = maxT;
      let hit = true;

      // Axis X
      if (Math.abs(dirX) < 1e-9) {
        if (ox < box.minX || ox > box.maxX) hit = false;
      } else {
        const inv = 1.0 / dirX;
        let t1 = (box.minX - ox) * inv;
        let t2 = (box.maxX - ox) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      // Axis Y
      if (Math.abs(dirY) < 1e-9) {
        if (oy < box.minY || oy > box.maxY) hit = false;
      } else {
        const inv = 1.0 / dirY;
        let t1 = (box.minY - oy) * inv;
        let t2 = (box.maxY - oy) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      // Axis Z
      if (Math.abs(dirZ) < 1e-9) {
        if (oz < box.minZ || oz > box.maxZ) hit = false;
      } else {
        const inv = 1.0 / dirZ;
        let t1 = (box.minZ - oz) * inv;
        let t2 = (box.maxZ - oz) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      return false; // Obstructed by box!
    }

    // Check ramps
    for (let rIdx = 0; rIdx < this.ramps.length; rIdx++) {
      const r = this.ramps[rIdx];
      const rMinY = Math.min(r.y0, r.y1) - (r.thickness ?? 0.3);
      const rMaxY = Math.max(r.y0, r.y1);

      let tmin = 1e-4;
      let tmax = maxT;
      let hit = true;

      if (Math.abs(dirX) < 1e-9) {
        if (ox < r.minX || ox > r.maxX) hit = false;
      } else {
        const inv = 1.0 / dirX;
        let t1 = (r.minX - ox) * inv;
        let t2 = (r.maxX - ox) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      if (Math.abs(dirY) < 1e-9) {
        if (oy < rMinY || oy > rMaxY) hit = false;
      } else {
        const inv = 1.0 / dirY;
        let t1 = (rMinY - oy) * inv;
        let t2 = (rMaxY - oy) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      if (Math.abs(dirZ) < 1e-9) {
        if (oz < r.minZ || oz > r.maxZ) hit = false;
      } else {
        const inv = 1.0 / dirZ;
        let t1 = (r.minZ - oz) * inv;
        let t2 = (r.maxZ - oz) * inv;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (!hit) continue;

      return false; // Obstructed by ramp!
    }

    return true; // Clear line of sight!
  }
}

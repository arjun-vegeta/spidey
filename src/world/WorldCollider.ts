import * as THREE from 'three';

export type ColliderTag = 'wall' | 'floor';

export interface PushResult {
  x: number; z: number; nx: number; nz: number; pushed: boolean;
}

export interface BoxBounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  tag: ColliderTag;
}

/**
 * Simplified collision shells for the city. Visuals are NEVER colliders:
 * each building registers a few big boxes here. Spatial hash grid (8m cells)
 * keeps queries cheap. Zero allocations after finalize().
 */
export class WorldCollider {
  private boxes: BoxBounds[] = [];
  private grid: Map<string, number[]> = new Map();
  private readonly cell: number = 8;
  private finalized: boolean = false;

  /** Total number of collider boxes registered. */
  public dumpBoxes(): number {
    return this.boxes.length;
  }

  /** Read-only snapshot of all collider boxes for debugging/visualization. */
  public dumpBounds(): BoxBounds[] {
    return this.boxes.map((b) => ({ ...b }));
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

  public finalize(): void {
    this.grid.clear();
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
    this.finalized = true;
  }

  private cellBoxes(x: number, z: number): number[] | undefined {
    if (!this.finalized) this.finalize();
    return this.grid.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell));
  }

  /**
   * Highest floor top at (x,z) that feet can stand on (allows 0.55m step-up).
   * Returns floor top Y or null.
   */
  public groundAt(x: number, feetY: number, z: number): number | null {
    const idx = this.cellBoxes(x, z);
    if (!idx) return null;
    let best: number | null = null;
    for (let k = 0; k < idx.length; k++) {
      const b = this.boxes[idx[k]];
      if (b.tag !== 'floor') continue;
      if (x < b.minX - 0.3 || x > b.maxX + 0.3 || z < b.minZ - 0.3 || z > b.maxZ + 0.3) continue;
      if (b.maxY > feetY + 0.55) continue;
      if (best === null || b.maxY > best) best = b.maxY;
    }
    return best;
  }

  /**
   * Horizontal push-out of a circle (x,z,r) against wall boxes overlapping [minY,maxY].
   * Writes resolved position + normal into out (reuse one scratch object, zero garbage).
   */
  public pushOut(x: number, z: number, r: number, minY: number, maxY: number, out: PushResult): void {
    out.x = x;
    out.z = z;
    out.nx = 0;
    out.nz = 0;
    out.pushed = false;
    const idx = this.cellBoxes(x, z);
    if (!idx) return;
    let px = x;
    let pz = z;
    for (let k = 0; k < idx.length; k++) {
      const b = this.boxes[idx[k]];
      if (b.tag !== 'wall') continue;
      if (b.maxY < minY + 0.3 || b.minY > maxY - 0.3) continue;
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
    out.x = px;
    out.z = pz;
  }
}

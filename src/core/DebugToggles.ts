import * as THREE from 'three';
import { WorldCollider } from '../world/WorldCollider';
import type { HUD } from '../ui/HUD';

/**
 * DebugToggles - Live inspection tools for collision shells, latch highways,
 * courtyard traversal timing, and ballistics ranges (GAME_PLAN.md 6.7, 30, 31, 33).
 *
 * Supported flags via URL query parameters or window global flags:
 * - ?showcolliders (Key 7): Translucent wireframe boxes of all WorldCollider shells.
 * - ?showlatches (Key 8): Marker beacons at all curated web grapple anchors.
 * - ?debugyard (Key 9): 10m / 25m / 50m concentric ground markings and distance pillars.
 * - ?debugrange (Key 0): Measured ballistics firing targets at 10m, 25m, 50m, 75m, 100m.
 */
export class DebugToggles {
  public showColliders: boolean = false;
  public showLatches: boolean = false;
  public debugYard: boolean = false;
  public debugRange: boolean = false;

  private scene: THREE.Scene;
  private worldCollider: WorldCollider;
  private webAnchors: THREE.Vector3[];
  private hud: HUD;

  private collidersGroup: THREE.Group | null = null;
  private latchesGroup: THREE.Group | null = null;
  private yardGroup: THREE.Group | null = null;
  private rangeGroup: THREE.Group | null = null;

  constructor(
    scene: THREE.Scene,
    worldCollider: WorldCollider,
    webAnchors: THREE.Vector3[],
    hud: HUD
  ) {
    this.scene = scene;
    this.worldCollider = worldCollider;
    this.webAnchors = webAnchors;
    this.hud = hud;

    this.parseInitialFlags();
    this.setupKeyListeners();
    this.applyAll();
  }

  private parseInitialFlags(): void {
    if (typeof window === 'undefined') return;

    try {
      const search = window.location.search.toLowerCase();
      const params = new URLSearchParams(search);

      const win = window as unknown as Record<string, unknown>;

      this.showColliders = params.has('showcolliders') || !!win.__SHOW_COLLIDERS;
      this.showLatches = params.has('showlatches') || !!win.__SHOW_LATCHES;
      this.debugYard = params.has('debugyard') || !!win.__DEBUG_YARD;
      this.debugRange = params.has('debugrange') || !!win.__DEBUG_RANGE;
    } catch {
      // Ignore URL parsing errors in non-browser environments
    }
  }

  private setupKeyListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Only trigger if not actively typing into input/select fields
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;

      if (e.key === '7') {
        this.showColliders = !this.showColliders;
        this.applyColliders();
        this.syncHud();
      } else if (e.key === '8') {
        this.showLatches = !this.showLatches;
        this.applyLatches();
        this.syncHud();
      } else if (e.key === '9') {
        this.debugYard = !this.debugYard;
        this.applyYard();
        this.syncHud();
      } else if (e.key === '0') {
        this.debugRange = !this.debugRange;
        this.applyRange();
        this.syncHud();
      }
    });
  }

  public applyAll(): void {
    this.applyColliders();
    this.applyLatches();
    this.applyYard();
    this.applyRange();
    this.syncHud();
  }

  private syncHud(): void {
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;
      win.__SHOW_COLLIDERS = this.showColliders;
      win.__SHOW_LATCHES = this.showLatches;
      win.__DEBUG_YARD = this.debugYard;
      win.__DEBUG_RANGE = this.debugRange;
    }

    if (!this.showColliders && !this.showLatches && !this.debugYard && !this.debugRange) {
      this.hud.updateDebugOverlay(null);
      return;
    }

    const colStr = this.showColliders ? 'ON' : 'off';
    const latStr = this.showLatches ? 'ON' : 'off';
    const yrdStr = this.debugYard ? 'ON' : 'off';
    const rngStr = this.debugRange ? 'ON' : 'off';

    this.hud.updateDebugOverlay(
      `[7] COLLIDERS: ${colStr}  [8] LATCHES: ${latStr}  [9] YARD: ${yrdStr}  [0] RANGE: ${rngStr}`
    );
  }

  private applyColliders(): void {
    if (this.showColliders && !this.collidersGroup) {
      this.buildCollidersGroup();
    }
    if (this.collidersGroup) {
      this.collidersGroup.visible = this.showColliders;
    }
  }

  private buildCollidersGroup(): void {
    this.collidersGroup = new THREE.Group();
    this.collidersGroup.name = 'DebugCollidersGroup';

    const bounds = this.worldCollider.dumpBounds();
    const wallMat = new THREE.LineBasicMaterial({ color: 0xd63031 });
    const floorMat = new THREE.LineBasicMaterial({ color: 0x0984e3 });

    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      const sx = b.maxX - b.minX;
      const sy = b.maxY - b.minY;
      const sz = b.maxZ - b.minZ;
      if (sx <= 0.01 || sy <= 0.01 || sz <= 0.01) continue;

      const geom = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.EdgesGeometry(geom);
      const wire = new THREE.LineSegments(edges, b.tag === 'wall' ? wallMat : floorMat);
      wire.position.set(
        (b.minX + b.maxX) * 0.5,
        (b.minY + b.maxY) * 0.5,
        (b.minZ + b.maxZ) * 0.5
      );
      wire.raycast = () => {};
      this.collidersGroup.add(wire);
      geom.dispose();
    }

    this.scene.add(this.collidersGroup);
  }

  private applyLatches(): void {
    if (this.showLatches && !this.latchesGroup) {
      this.buildLatchesGroup();
    }
    if (this.latchesGroup) {
      this.latchesGroup.visible = this.showLatches;
    }
  }

  private buildLatchesGroup(): void {
    this.latchesGroup = new THREE.Group();
    this.latchesGroup.name = 'DebugLatchesGroup';

    const geom = new THREE.OctahedronGeometry(0.75, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00cec9, wireframe: true });

    for (let i = 0; i < this.webAnchors.length; i++) {
      const pos = this.webAnchors[i];
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.raycast = () => {};
      this.latchesGroup.add(mesh);
    }

    this.scene.add(this.latchesGroup);
  }

  private applyYard(): void {
    if (this.debugYard && !this.yardGroup) {
      this.buildYardGroup();
    }
    if (this.yardGroup) {
      this.yardGroup.visible = this.debugYard;
    }
  }

  private buildYardGroup(): void {
    this.yardGroup = new THREE.Group();
    this.yardGroup.name = 'DebugYardGroup';

    const spawnY = 0.55;
    const ringMat = new THREE.LineBasicMaterial({ color: 0x27ae60 });

    // Concentric ground rings at 10m, 25m, 50m
    const radii = [10, 25, 50];
    for (let rIdx = 0; rIdx < radii.length; rIdx++) {
      const r = radii[rIdx];
      const points: THREE.Vector3[] = [];
      const segments = 48;
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * r, spawnY, Math.sin(theta) * r));
      }
      const ringGeom = new THREE.BufferGeometry().setFromPoints(points);
      const ringLine = new THREE.Line(ringGeom, ringMat);
      ringLine.raycast = () => {};
      this.yardGroup.add(ringLine);

      // Distance marker post
      const pillarGeom = new THREE.CylinderGeometry(0.18, 0.18, 3.0, 8);
      const pillarMat = new THREE.MeshBasicMaterial({ color: 0x27ae60, wireframe: true });
      const pillar = new THREE.Mesh(pillarGeom, pillarMat);
      pillar.position.set(0, spawnY + 1.5, r);
      pillar.raycast = () => {};
      this.yardGroup.add(pillar);
    }

    this.scene.add(this.yardGroup);
  }

  private applyRange(): void {
    if (this.debugRange && !this.rangeGroup) {
      this.buildRangeGroup();
    }
    if (this.rangeGroup) {
      this.rangeGroup.visible = this.debugRange;
    }
  }

  private buildRangeGroup(): void {
    this.rangeGroup = new THREE.Group();
    this.rangeGroup.name = 'DebugRangeGroup';

    const laneX = -20.0;
    const laneY = 1.5;
    const distances = [10, 25, 50, 75, 100];

    const targetFrameMat = new THREE.MeshBasicMaterial({ color: 0x0e1c4e, wireframe: true });
    const bullseyeMat = new THREE.MeshBasicMaterial({ color: 0xd63031 });

    for (let i = 0; i < distances.length; i++) {
      const dist = distances[i];
      const targetPos = new THREE.Vector3(laneX, laneY, -dist);

      // Outer target square board (1.2m x 1.8m)
      const boardGeom = new THREE.BoxGeometry(1.2, 1.8, 0.1);
      const board = new THREE.Mesh(boardGeom, targetFrameMat);
      board.position.copy(targetPos);
      board.raycast = () => {};
      this.rangeGroup.add(board);

      // Bullseye red dot
      const bullseyeGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16);
      bullseyeGeom.rotateX(Math.PI / 2);
      const bullseye = new THREE.Mesh(bullseyeGeom, bullseyeMat);
      bullseye.position.copy(targetPos);
      bullseye.raycast = () => {};
      this.rangeGroup.add(bullseye);

      // Stand post
      const standGeom = new THREE.CylinderGeometry(0.06, 0.06, targetPos.y, 6);
      const stand = new THREE.Mesh(standGeom, targetFrameMat);
      stand.position.set(targetPos.x, targetPos.y * 0.5, targetPos.z);
      stand.raycast = () => {};
      this.rangeGroup.add(stand);
    }

    this.scene.add(this.rangeGroup);
  }

  public dispose(): void {
    if (this.collidersGroup) {
      this.scene.remove(this.collidersGroup);
      this.collidersGroup = null;
    }
    if (this.latchesGroup) {
      this.scene.remove(this.latchesGroup);
      this.latchesGroup = null;
    }
    if (this.yardGroup) {
      this.scene.remove(this.yardGroup);
      this.yardGroup = null;
    }
    if (this.rangeGroup) {
      this.scene.remove(this.rangeGroup);
      this.rangeGroup = null;
    }
  }
}

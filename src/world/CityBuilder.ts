import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { ConstructionSite } from './ConstructionSite';
import { WebAnchor } from '../player/SwingPhysics';
import { WorldCollider } from './WorldCollider';
import { LANDABLE_TRIM } from './LandableTrim';

export { LANDABLE_TRIM } from './LandableTrim';

export interface SkyscraperConfig {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  hasWaterTower?: boolean;
  hasHvac?: boolean;
  hasAntenna?: boolean;
  setbackHeight?: number; // Height at which setback begins (if tiered)
  setbackScale?: number;  // Scale of setback section (e.g. 0.75)
  style?: 'modern' | 'artdeco' | 'industrial' | 'terrace';
}

interface CloudData {
  mesh: THREE.Group;
  speed: number;
  initialY: number;
  bobPhase: number;
}

/**
 * Procedural Manhattan-style Skyscraper District surrounding the Construction Site.
 * Features:
 * - 20+ skyscrapers of diverse heights (35m to 130m) with setbacks and cornices
 * - Rooftop details: wooden water towers on 4-legged trestles, industrial HVAC chillers, radio antennae, parapets
 * - Connected adjacent building that docks directly to the construction sky bridge
 * - Street ground plane with cross-hatched tarmac, curbs, and perimeter barrier walls
 * - Drifting sketched puffy clouds and distant city skyline silhouette
 * - Fast spatial raycasting with grapple-assist target magnet for web swinging
 * - Strictly typed, zero any, 60+ FPS optimized
 */
export class CityBuilder {
  public group: THREE.Group;
  public constructionSite: ConstructionSite;

  private collidableMeshes: THREE.Mesh[] = [];
  private webAnchors: THREE.Vector3[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private clouds: CloudData[] = [];
  private elapsed: number = 0;
  private worldCollider: WorldCollider | null = null;
  private mapBuildingList: Array<{ x: number; z: number; w: number; d: number }> = [];
  private balconySpecs: Array<{ cx: number; cy: number; cz: number; hw: number; hd: number; nx: number; nz: number }> = [];
  private terraceHvacSpecs: Array<{ cx: number; cy: number; cz: number; w: number; h: number; d: number }> = [];
  private glintMat: THREE.MeshBasicMaterial | null = null;
  private glintGeom: THREE.OctahedronGeometry | null = null;

  // Shared ink materials
  private facadeMat: THREE.ShaderMaterial;
  private trimMat: THREE.ShaderMaterial;
  private roofMat: THREE.ShaderMaterial;
  private groundMat: THREE.ShaderMaterial;
  private sidewalkMat: THREE.ShaderMaterial;
  private woodMat: THREE.ShaderMaterial;
  private metalMat: THREE.ShaderMaterial;
  private accentMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private silhouetteMat: THREE.ShaderMaterial;
  private landableTrimMat: THREE.ShaderMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'CityBuilder_Root';

    // 1. Initialize shared materials
    this.facadeMat = InkShaderMaterial.create();
    this.trimMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x0e1c4e) });
    this.roofMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x18285c) });
    this.groundMat = InkShaderMaterial.create();
    this.sidewalkMat = InkShaderMaterial.create();
    this.woodMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x1b2d6b) });
    this.metalMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x0a1435) });
    this.accentMat = InkShaderMaterial.create({ isAccent: true });
    this.cloudMat = InkShaderMaterial.create();
    this.silhouetteMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x3a4b7c) });
    this.landableTrimMat = InkShaderMaterial.create({ inkColor: LANDABLE_TRIM });

    this.materials.push(
      this.facadeMat,
      this.trimMat,
      this.roofMat,
      this.groundMat,
      this.sidewalkMat,
      this.woodMat,
      this.metalMat,
      this.accentMat,
      this.cloudMat,
      this.silhouetteMat,
      this.landableTrimMat
    );

    // 2. Instantiate and add ConstructionSite at center
    this.constructionSite = new ConstructionSite();
    this.group.add(this.constructionSite.getGroup());

    // Merge construction site collidables and grapple points
    this.collidableMeshes.push(...this.constructionSite.getCollidableMeshes());
    this.webAnchors.push(...this.constructionSite.getGrapplePoints());

    // Filter out any anchors within 3m of the crane hook (moving/non-landable)
    const hookPos = new THREE.Vector3(19.0, 27.3, -2.0);
    this.webAnchors = this.webAnchors.filter((a) => a.distanceTo(hookPos) > 3.0);

    // 3. Build city elements
    this.buildGroundAndStreets();
    this.buildSkyscrapers();
    this.buildSkyClouds();
    this.buildDistantSkyline();
  }

  /**
   * Helper to create a mesh with attached ballpoint blue edge lines
   */
  private addMeshWithEdges(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    edgeColor: THREE.Color = InkShaderMaterial.defaultInkColor,
    isCollidable: boolean = true
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const edges = InkShaderMaterial.createEdgeLines(geometry, edgeColor);
    edges.raycast = () => {};
    mesh.add(edges);

    parent.add(mesh);

    if (isCollidable) {
      this.collidableMeshes.push(mesh);
    }

    return mesh;
  }

  /**
   * Builds ground tarmac plane, raised sidewalks, and perimeter boundary barriers
   */
  private buildGroundAndStreets(): void {
    const streetsGroup = new THREE.Group();
    streetsGroup.name = 'StreetsAndGround';

    const citySize = 520.0;
    const halfCity = citySize * 0.5;

    // Ground tarmac slab
    const groundGeom = new THREE.BoxGeometry(citySize, 1.0, citySize);
    const ground = this.addMeshWithEdges(streetsGroup, groundGeom, this.groundMat, InkShaderMaterial.defaultInkColor, true);
    ground.position.set(0, -0.5, 0);

    // Raised sidewalks around city blocks
    const sidewalkBlocks: Array<[number, number, number, number]> = [
      // [x, z, width, depth]
      // Central construction block plaza
      [-10, 0, 75, 65],
      // East block 1
      [60, 0, 42, 45],
      // East block 2 (North)
      [60, 70, 42, 60],
      // East block 3 (South)
      [60, -70, 42, 60],
      // North block 1
      [0, 65, 40, 45],
      // North block 2 (West)
      [-55, 65, 42, 45],
      // South block 1
      [0, -65, 40, 45],
      // South block 2 (West)
      [-55, -65, 42, 45],
      // West block 1
      [-110, 0, 45, 45],
      // West block 2 (North)
      [-110, 70, 45, 60],
      // West block 3 (South)
      [-110, -70, 45, 60]
    ];

    const curbHeight = 0.2;
    for (const [bx, bz, bw, bd] of sidewalkBlocks) {
      const swGeom = new THREE.BoxGeometry(bw, curbHeight, bd);
      const sw = this.addMeshWithEdges(streetsGroup, swGeom, this.sidewalkMat, InkShaderMaterial.defaultInkColor, true);
      sw.position.set(bx, curbHeight * 0.5, bz);
    }

    // Road crosswalk zebra markings (ink line decals / flat boxes)
    const crosswalkPositions: Array<[number, number, number, boolean]> = [
      [28, 0, 24, false], // East-West crosswalk
      [-28, 0, 24, false],
      [0, 36, 24, true],  // North-South crosswalk
      [0, -36, 24, true],
      [60, 38, 20, true],
      [60, -38, 20, true],
      [-55, 38, 20, true],
      [-55, -38, 20, true]
    ];

    for (const [cx, cz, cLength, isRotated] of crosswalkPositions) {
      const numStripes = 6;
      const stripeW = 0.8;
      const stripeL = 3.8;
      const spacing = cLength / numStripes;

      for (let s = 0; s < numStripes; s++) {
        const offset = -cLength * 0.5 + s * spacing + spacing * 0.5;
        const stripeGeom = new THREE.BoxGeometry(isRotated ? stripeL : stripeW, 0.02, isRotated ? stripeW : stripeL);
        const stripe = this.addMeshWithEdges(streetsGroup, stripeGeom, this.sidewalkMat, InkShaderMaterial.defaultInkColor, false);
        stripe.position.set(isRotated ? cx + offset : cx, 0.02, isRotated ? cz : cz + offset);
      }
    }

    // Perimeter boundary barrier walls (bounding the playable area)
    const wallHeight = 8.0;
    const wallThick = 1.0;

    // North wall
    const nWallGeom = new THREE.BoxGeometry(citySize, wallHeight, wallThick);
    const nWall = this.addMeshWithEdges(streetsGroup, nWallGeom, this.groundMat, InkShaderMaterial.defaultInkColor, true);
    nWall.position.set(0, wallHeight * 0.5, halfCity - wallThick * 0.5);

    // South wall
    const sWall = this.addMeshWithEdges(streetsGroup, nWallGeom, this.groundMat, InkShaderMaterial.defaultInkColor, true);
    sWall.position.set(0, wallHeight * 0.5, -halfCity + wallThick * 0.5);

    // East wall
    const eWallGeom = new THREE.BoxGeometry(wallThick, wallHeight, citySize);
    const eWall = this.addMeshWithEdges(streetsGroup, eWallGeom, this.groundMat, InkShaderMaterial.defaultInkColor, true);
    eWall.position.set(halfCity - wallThick * 0.5, wallHeight * 0.5, 0);

    // West wall
    const wWall = this.addMeshWithEdges(streetsGroup, eWallGeom, this.groundMat, InkShaderMaterial.defaultInkColor, true);
    wWall.position.set(-halfCity + wallThick * 0.5, wallHeight * 0.5, 0);

    // 7. [9.6] Torn-paper edge: thin accent stripe along the top of the 4 perimeter walls
    const stripeH = 0.25;
    const stripeT = wallThick + 0.2;
    const stripeY = wallHeight + stripeH * 0.5;

    // North wall stripe
    const nsStripeGeom = new THREE.BoxGeometry(citySize, stripeH, stripeT);
    const nStripe = this.addMeshWithEdges(streetsGroup, nsStripeGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
    nStripe.position.set(0, stripeY, halfCity - wallThick * 0.5);

    // South wall stripe
    const sStripe = this.addMeshWithEdges(streetsGroup, nsStripeGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
    sStripe.position.set(0, stripeY, -halfCity + wallThick * 0.5);

    // East wall stripe
    const ewStripeGeom = new THREE.BoxGeometry(stripeT, stripeH, citySize);
    const eStripe = this.addMeshWithEdges(streetsGroup, ewStripeGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
    eStripe.position.set(halfCity - wallThick * 0.5, stripeY, 0);

    // West wall stripe
    const wStripe = this.addMeshWithEdges(streetsGroup, ewStripeGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
    wStripe.position.set(-halfCity + wallThick * 0.5, stripeY, 0);

    this.group.add(streetsGroup);
  }

  /**
   * Generates the 20+ skyscrapers of varying heights with detailed rooftops
   */
  private buildSkyscrapers(): void {
    const buildingsGroup = new THREE.Group();
    buildingsGroup.name = 'Skyscrapers';

    // Skyscraper architectural specifications
    const configs: SkyscraperConfig[] = [
      // 1. Connected Adjacent Building (docks to construction site skybridge at x = -35m, y = 15m)
      {
        x: -48.0,
        z: 0.0,
        width: 26.0,
        depth: 24.0,
        height: 18.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'terrace'
      },
      // 2. East-1: Mid-rise tower facing construction site
      {
        x: 58.0,
        z: 0.0,
        width: 28.0,
        depth: 26.0,
        height: 65.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern'
      },
      // 3. East-2: Art-Deco stepped skyscraper
      {
        x: 60.0,
        z: 70.0,
        width: 26.0,
        depth: 26.0,
        height: 95.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 60.0,
        setbackScale: 0.72,
        style: 'artdeco'
      },
      // 4. East-3: Sleek office tower
      {
        x: 60.0,
        z: -70.0,
        width: 26.0,
        depth: 26.0,
        height: 78.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: true,
        style: 'modern'
      },
      // 5. North-1: Tall setback high-rise
      {
        x: 0.0,
        z: 65.0,
        width: 24.0,
        depth: 24.0,
        height: 85.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 52.0,
        setbackScale: 0.75,
        style: 'artdeco'
      },
      // 6. North-2: Mid-rise commercial office
      {
        x: -55.0,
        z: 65.0,
        width: 22.0,
        depth: 22.0,
        height: 48.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'industrial'
      },
      // 7. North-3: Supertall tower
      {
        x: 55.0,
        z: 135.0,
        width: 28.0,
        depth: 26.0,
        height: 110.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 75.0,
        setbackScale: 0.7,
        style: 'artdeco'
      },
      // 8. North-4: Towering Art-Deco Landmark (125m)
      {
        x: -15.0,
        z: 140.0,
        width: 32.0,
        depth: 30.0,
        height: 125.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 80.0,
        setbackScale: 0.60,
        style: 'artdeco'
      },
      // 9. North-5: Residential high-rise
      {
        x: -75.0,
        z: 135.0,
        width: 26.0,
        depth: 24.0,
        height: 72.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern'
      },
      // 10. South-1: Corporate headquarters
      {
        x: 0.0,
        z: -65.0,
        width: 25.0,
        depth: 25.0,
        height: 74.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: true,
        style: 'modern'
      },
      // 11. South-2: Mid-rise brick style
      {
        x: -55.0,
        z: -65.0,
        width: 22.0,
        depth: 22.0,
        height: 42.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'industrial'
      },
      // 12. South-3: Setback skyscraper
      {
        x: 55.0,
        z: -135.0,
        width: 26.0,
        depth: 26.0,
        height: 105.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 70.0,
        setbackScale: 0.72,
        style: 'artdeco'
      },
      // 13. South-4: Supertall Empire Monolith (130m!)
      {
        x: -15.0,
        z: -140.0,
        width: 32.0,
        depth: 30.0,
        height: 130.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 85.0,
        setbackScale: 0.58,
        style: 'artdeco'
      },
      // 14. South-5: High-rise apartment tower
      {
        x: -75.0,
        z: -135.0,
        width: 24.0,
        depth: 24.0,
        height: 68.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern'
      },
      // 15. West-1: Modern skyscraper flanking the avenue
      {
        x: -110.0,
        z: 0.0,
        width: 28.0,
        depth: 26.0,
        height: 88.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        style: 'modern'
      },
      // 16. West-2: Stepped office tower
      {
        x: -110.0,
        z: 70.0,
        width: 28.0,
        depth: 26.0,
        height: 92.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        setbackHeight: 62.0,
        setbackScale: 0.75,
        style: 'artdeco'
      },
      // 17. West-3: Brick commercial mid-rise
      {
        x: -110.0,
        z: -70.0,
        width: 24.0,
        depth: 24.0,
        height: 58.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'industrial'
      },
      // 18. Far-East-1: Outer avenue skyscraper
      {
        x: 130.0,
        z: 25.0,
        width: 34.0,
        depth: 32.0,
        height: 118.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 78.0,
        setbackScale: 0.60,
        style: 'artdeco'
      },
      // 19. Far-East-2: Outer avenue mid-tall
      {
        x: 130.0,
        z: -65.0,
        width: 28.0,
        depth: 28.0,
        height: 84.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern'
      },
      // 20. Far-West-1: Corporate monolith
      {
        x: -170.0,
        z: 35.0,
        width: 30.0,
        depth: 30.0,
        height: 102.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        style: 'modern'
      },
      // 21. Far-West-2: Secondary avenue tower
      {
        x: -170.0,
        z: -45.0,
        width: 26.0,
        depth: 26.0,
        height: 76.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern'
      }
    ];

    for (const config of configs) {
      this.buildSingleSkyscraper(buildingsGroup, config);
      this.mapBuildingList.push({ x: config.x, z: config.z, w: config.width, d: config.depth });
    }

    this.group.add(buildingsGroup);
    this.buildCollisionShells(configs);
  }

  /**
   * Simplified collision shells: a few big boxes per building, never the visual meshes.
   * Walls block, floors stand. Street + construction slabs included.
   */
  private buildCollisionShells(configs: SkyscraperConfig[]): void {
    const coll = new WorldCollider();

    // Street slab top at y=0.5 across the playable area
    coll.addBoxCoords(-260, -2, -260, 260, 0.5, 260, 'floor');

    for (const c of configs) {
      const hw = c.width / 2;
      const hd = c.depth / 2;
      const tiered = c.setbackHeight !== undefined && c.setbackScale !== undefined && c.setbackHeight < c.height;
      if (tiered) {
        const sh = c.setbackHeight as number;
        const rw = (c.width * (c.setbackScale as number)) / 2;
        const rd = (c.depth * (c.setbackScale as number)) / 2;
        // Lower tier walls + walkable terrace ring on its roof
        coll.addBoxCoords(c.x - hw, 0, c.z - hd, c.x + hw, sh, c.z + hd, 'wall');
        coll.addBoxCoords(c.x - hw, sh - 0.2, c.z - hd, c.x + hw, sh, c.z + hd, 'floor');
        // Upper tier walls + roof
        coll.addBoxCoords(c.x - rw, sh, c.z - rd, c.x + rw, c.height, c.z + rd, 'wall');
        coll.addBoxCoords(c.x - rw, c.height - 0.2, c.z - rd, c.x + rw, c.height, c.z + rd, 'floor');
      } else {
        coll.addBoxCoords(c.x - hw, 0, c.z - hd, c.x + hw, c.height, c.z + hd, 'wall');
        coll.addBoxCoords(c.x - hw, c.height - 0.2, c.z - hd, c.x + hw, c.height, c.z + hd, 'floor');
      }
    }

    // Construction site floor slabs (match ConstructionSite slab tops, with stair cutout)
    const siteFloors = [0.5, 5.5, 10.5, 15.5, 20.5];
    for (const top of siteFloors) {
      if (top === 0.5) {
        coll.addBoxCoords(-13, top - 0.5, -11, 13, top, 11, 'floor');
      } else {
        // West main slab + east north/south slabs (stairwell hole stays open)
        coll.addBoxCoords(-13, top - 0.5, -11, 6, top, 11, 'floor');
        coll.addBoxCoords(6, top - 0.5, 6, 13, top, 11, 'floor');
        coll.addBoxCoords(6, top - 0.5, -11, 13, top, -4, 'floor');
      }
    }

    // Skybridge deck floor shell (-35 to -13 at y=15.0..15.4)
    coll.addBoxCoords(-35, 15.0, -1.6, -13, 15.4, 1.6, 'floor');
    // Skybridge side railings (North & South)
    coll.addBoxCoords(-35, 15.4, -1.65, -13, 16.6, -1.45, 'wall');
    coll.addBoxCoords(-35, 15.4, 1.45, -13, 16.6, 1.65, 'wall');

    // Construction site Floor 3 West railings (north and south of bridge opening)
    coll.addBoxCoords(-13.1, 15.5, 1.6, -12.8, 16.6, 10.0, 'wall');
    coll.addBoxCoords(-13.1, 15.5, -10.0, -12.8, 16.6, -1.6, 'wall');

    // Connected Adjacent Building (B1) skybridge dock steps:
    // Connects skybridge deck (15.4) to B1 terrace roof (18.0) without jumping
    coll.addBoxCoords(-37, 15.8, -1.8, -35, 16.25, 1.8, 'floor');
    coll.addBoxCoords(-39, 16.6, -1.8, -37, 17.1, 1.8, 'floor');
    coll.addBoxCoords(-41, 17.5, -1.8, -39, 18.0, 1.8, 'floor');

    // Stepping stones mid-air near spawn (0, 4, 18)
    for (const s of this.constructionSite.getSteppingStoneBounds()) {
      coll.addBoxCoords(s.minX, s.minY, s.minZ, s.maxX, s.maxY, s.maxZ, 'floor');
    }

    // Terrace HVAC props (chest cover + step platform)
    for (const h of this.terraceHvacSpecs) {
      const hw = h.w * 0.5;
      const hd = h.d * 0.5;
      coll.addBoxCoords(h.cx - hw, h.cy, h.cz - hd, h.cx + hw, h.cy + h.h, h.cz + hd, 'wall');
      coll.addBoxCoords(h.cx - hw, h.cy + h.h - 0.2, h.cz - hd, h.cx + hw, h.cy + h.h, h.cz + hd, 'floor');
    }

    // Street cover barriers & crates around site perimeter
    const streetBarriers: Array<[number, number, number, number]> = [
      [-6.0, 0.5, -15.0, 0], [0.0, 0.5, -15.0, 0], [6.0, 0.5, -15.0, 0],
      [-5.0, 0.5, 15.0, 0], [2.0, 0.5, 15.0, 0], [8.0, 0.5, 15.0, 0],
      [15.0, 0.5, -3.0, 1], [15.0, 0.5, 3.0, 1],
    ];
    for (const [bx, by, bz, rot] of streetBarriers) {
      const bw = rot ? 0.7 : 3.0;
      const bd = rot ? 3.0 : 0.7;
      coll.addBoxCoords(bx - bw * 0.5, by, bz - bd * 0.5, bx + bw * 0.5, by + 1.0, bz + bd * 0.5, 'wall');
      coll.addBoxCoords(bx - bw * 0.5, by + 0.8, bz - bd * 0.5, bx + bw * 0.5, by + 1.0, bz + bd * 0.5, 'floor');
    }

    const streetCrates: Array<[number, number, number, number]> = [
      [-4.0, 0.5, -16.5, 1.4], [5.0, 0.5, -16.0, 1.5],
      [3.0, 0.5, 16.5, 1.3], [15.5, 0.5, 0.0, 1.4]
    ];
    for (const [cx, cy, cz, cs] of streetCrates) {
      const hs = cs * 0.5;
      coll.addBoxCoords(cx - hs, cy, cz - hs, cx + hs, cy + cs, cz + hs, 'wall');
      coll.addBoxCoords(cx - hs, cy + cs - 0.2, cz - hs, cx + hs, cy + cs, cz + hs, 'floor');
    }

    // Balcony shells: standable floors + leanable outer rails
    for (const b of this.balconySpecs) {
      coll.addBoxCoords(b.cx - b.hw, b.cy - 0.3, b.cz - b.hd, b.cx + b.hw, b.cy, b.cz + b.hd, 'floor');
      // Outer rail strip (1.1m tall, thin, on the outward edge)
      const t = 0.15;
      if (b.nx !== 0) {
        const rx = b.nx > 0 ? b.cx + b.hw - t : b.cx - b.hw;
        coll.addBoxCoords(Math.min(rx, rx + t), b.cy, b.cz - b.hd, Math.max(rx, rx + t), b.cy + 1.1, b.cz + b.hd, 'wall');
      } else {
        const rz = b.nz > 0 ? b.cz + b.hd - t : b.cz - b.hd;
        coll.addBoxCoords(b.cx - b.hw, b.cy, Math.min(rz, rz + t), b.cx + b.hw, b.cy + 1.1, Math.max(rz, rz + t), 'wall');
      }
    }

    coll.finalize();
    this.worldCollider = coll;
  }

  public getWorldCollider(): WorldCollider {
    if (!this.worldCollider) {
      this.worldCollider = new WorldCollider();
      this.worldCollider.finalize();
    }
    return this.worldCollider;
  }

  public getMapBuildings(): Array<{ x: number; z: number; w: number; d: number }> {
    return this.mapBuildingList;
  }

  /**
   * Constructs an individual skyscraper with facade cornices and rooftop features
   */
  private buildSingleSkyscraper(parent: THREE.Group, config: SkyscraperConfig): void {
    const bGroup = new THREE.Group();
    bGroup.name = `Skyscraper_${Math.round(config.x)}_${Math.round(config.z)}`;
    bGroup.position.set(config.x, 0, config.z);

    const { width, depth, height, setbackHeight, setbackScale } = config;

    const roofY = height;
    let roofW = width;
    let roofD = depth;

    if (setbackHeight && setbackScale && setbackHeight < height) {
      // Tiered Building (Art-Deco setback style)
      // 1. Lower base section
      const baseH = setbackHeight;
      const baseGeom = new THREE.BoxGeometry(width, baseH, depth);
      const baseMesh = this.addMeshWithEdges(bGroup, baseGeom, this.facadeMat, InkShaderMaterial.defaultInkColor, true);
      baseMesh.position.set(0, baseH * 0.5, 0);

      // Base cornice trim
      const corniceGeom = new THREE.BoxGeometry(width + 0.6, 0.6, depth + 0.6);
      const cornice = this.addMeshWithEdges(bGroup, corniceGeom, this.trimMat, InkShaderMaterial.defaultInkColor, false);
      cornice.position.set(0, baseH + 0.3, 0);

      // Lower setback ledge grapple points
      this.webAnchors.push(
        new THREE.Vector3(config.x - width * 0.5, baseH, config.z),
        new THREE.Vector3(config.x + width * 0.5, baseH, config.z),
        new THREE.Vector3(config.x, baseH, config.z - depth * 0.5),
        new THREE.Vector3(config.x, baseH, config.z + depth * 0.5)
      );

      // 4 Setback corner latches with ink glints
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ox = sx * (width * 0.5);
          const oz = sz * (depth * 0.5);
          this.webAnchors.push(new THREE.Vector3(config.x + ox, baseH + 1.2, config.z + oz));
          this.addLatchGlint(bGroup, ox, baseH + 1.2, oz);
        }
      }

      // Landable edge trims along the outer perimeter of the setback terrace ring
      const trimT = 0.04;
      const trimW = 0.25;
      const tNorthGeom = new THREE.BoxGeometry(width, trimT, trimW);
      const tNorth = new THREE.Mesh(tNorthGeom, this.landableTrimMat);
      tNorth.position.set(0, baseH + trimT * 0.5, depth * 0.5 - trimW * 0.5);
      tNorth.raycast = () => {};
      bGroup.add(tNorth);

      const tSouth = new THREE.Mesh(tNorthGeom, this.landableTrimMat);
      tSouth.position.set(0, baseH + trimT * 0.5, -depth * 0.5 + trimW * 0.5);
      tSouth.raycast = () => {};
      bGroup.add(tSouth);

      const tEastGeom = new THREE.BoxGeometry(trimW, trimT, Math.max(0.1, depth - trimW * 2.0));
      const tEast = new THREE.Mesh(tEastGeom, this.landableTrimMat);
      tEast.position.set(width * 0.5 - trimW * 0.5, baseH + trimT * 0.5, 0);
      tEast.raycast = () => {};
      bGroup.add(tEast);

      const tWest = new THREE.Mesh(tEastGeom, this.landableTrimMat);
      tWest.position.set(-width * 0.5 + trimW * 0.5, baseH + trimT * 0.5, 0);
      tWest.raycast = () => {};
      bGroup.add(tWest);

      // 2. Upper setback section
      roofW = width * setbackScale;
      roofD = depth * setbackScale;
      const upperH = height - setbackHeight;
      const upperGeom = new THREE.BoxGeometry(roofW, upperH, roofD);
      const upperMesh = this.addMeshWithEdges(bGroup, upperGeom, this.facadeMat, InkShaderMaterial.defaultInkColor, true);
      upperMesh.position.set(0, setbackHeight + upperH * 0.5, 0);

      // Terrace props: on artdeco setback terraces wider than 6m (or B5), add 1-2 HVAC/vent boxes
      const terraceWalkwayW = (width - roofW) * 0.5;
      if (terraceWalkwayW >= 6.0 || (config.width === 24 && config.height === 85)) {
        this.buildTerraceHvacProps(bGroup, config, baseH, roofW, roofD);
      }

      // Balconies on upper tier if tall enough
      if (upperH >= 24) {
        this.buildTieredBalconies(bGroup, config, baseH, upperH, roofW, roofD);
      }
    } else {
      // Standard monolithic skyscraper
      const bGeom = new THREE.BoxGeometry(width, height, depth);
      const bMesh = this.addMeshWithEdges(bGroup, bGeom, this.facadeMat, InkShaderMaterial.defaultInkColor, true);
      bMesh.position.set(0, height * 0.5, 0);

      // Architectural facade window band insets
      const numBands = Math.floor(height / 12);
      for (let b = 1; b < numBands; b++) {
        const bandY = b * 12;
        const bandGeom = new THREE.BoxGeometry(width + 0.3, 0.8, depth + 0.3);
        const band = this.addMeshWithEdges(bGroup, bandGeom, this.trimMat, InkShaderMaterial.defaultInkColor, false);
        band.position.set(0, bandY, 0);
      }

      // Industrial style: add 8m industrial roof mast
      if (config.style === 'industrial') {
        this.buildIndustrialMast(bGroup, config, height);
      }

      // Terrace style (B1 Connected Adjacent): add landable trims on roof terrace edges + HVAC props
      if (config.style === 'terrace') {
        const trimT = 0.04;
        const trimW = 0.25;
        const rNorthGeom = new THREE.BoxGeometry(width, trimT, trimW);
        const rNorth = new THREE.Mesh(rNorthGeom, this.landableTrimMat);
        rNorth.position.set(0, height + trimT * 0.5, depth * 0.5 - trimW * 0.5);
        rNorth.raycast = () => {};
        bGroup.add(rNorth);

        const rSouth = new THREE.Mesh(rNorthGeom, this.landableTrimMat);
        rSouth.position.set(0, height + trimT * 0.5, -depth * 0.5 + trimW * 0.5);
        rSouth.raycast = () => {};
        bGroup.add(rSouth);

        const rEastGeom = new THREE.BoxGeometry(trimW, trimT, Math.max(0.1, depth - trimW * 2.0));
        const rEast = new THREE.Mesh(rEastGeom, this.landableTrimMat);
        rEast.position.set(width * 0.5 - trimW * 0.5, height + trimT * 0.5, 0);
        rEast.raycast = () => {};
        bGroup.add(rEast);

        const rWest = new THREE.Mesh(rEastGeom, this.landableTrimMat);
        rWest.position.set(-width * 0.5 + trimW * 0.5, height + trimT * 0.5, 0);
        rWest.raycast = () => {};
        bGroup.add(rWest);

        // Add 2 HVAC boxes for chest cover + step platforms on B1 terrace
        this.buildTerraceHvacProps(bGroup, config, height, 14, 14);
      }
    }

    // Additional mid-height face latches for outer perimeter coverage
    if (config.x === 55 && config.z === 135) {
      // B7 North-3 (east face latches)
      for (const y of [35, 55]) {
        this.webAnchors.push(new THREE.Vector3(config.x + width * 0.5, y, config.z));
        this.addLatchGlint(bGroup, width * 0.5, y, 0);
      }
    } else if (config.x === 130 && config.z === 25) {
      // B18 Far-East-1 (north face latches)
      for (const y of [35, 60]) {
        this.webAnchors.push(new THREE.Vector3(config.x, y, config.z + depth * 0.5));
        this.addLatchGlint(bGroup, 0, y, depth * 0.5);
      }
    } else if (config.x === -75 && config.z === 135) {
      // B9 North-5 (west face latches)
      for (const y of [35, 55]) {
        this.webAnchors.push(new THREE.Vector3(config.x - width * 0.5, y, config.z));
        this.addLatchGlint(bGroup, -width * 0.5, y, 0);
      }
    }

    // Rooftop perimeter parapet wall (1.2m tall)
    const parapetHeight = 1.2;
    const parapetThick = 0.35;
    const halfRW = roofW * 0.5;
    const halfRD = roofD * 0.5;

    // North & South parapets
    const nsParapetGeom = new THREE.BoxGeometry(roofW, parapetHeight, parapetThick);
    const nParapet = this.addMeshWithEdges(bGroup, nsParapetGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    nParapet.position.set(0, roofY + parapetHeight * 0.5, halfRD - parapetThick * 0.5);

    const sParapet = this.addMeshWithEdges(bGroup, nsParapetGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    sParapet.position.set(0, roofY + parapetHeight * 0.5, -halfRD + parapetThick * 0.5);

    // East & West parapets
    const ewParapetGeom = new THREE.BoxGeometry(parapetThick, parapetHeight, roofD - parapetThick * 2.0);
    const eParapet = this.addMeshWithEdges(bGroup, ewParapetGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    eParapet.position.set(halfRW - parapetThick * 0.5, roofY + parapetHeight * 0.5, 0);

    const wParapet = this.addMeshWithEdges(bGroup, ewParapetGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    wParapet.position.set(-halfRW + parapetThick * 0.5, roofY + parapetHeight * 0.5, 0);

    // Rooftop access penthouse / bulkhead
    const phGeom = new THREE.BoxGeometry(4.5, 3.0, 3.5);
    const ph = this.addMeshWithEdges(bGroup, phGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    ph.position.set(-halfRW * 0.4, roofY + 1.5, -halfRD * 0.4);

    // Curated web anchors at the 4 roof parapet corners
    this.webAnchors.push(
      new THREE.Vector3(config.x - halfRW, roofY + parapetHeight, config.z - halfRD),
      new THREE.Vector3(config.x + halfRW, roofY + parapetHeight, config.z - halfRD),
      new THREE.Vector3(config.x - halfRW, roofY + parapetHeight, config.z + halfRD),
      new THREE.Vector3(config.x + halfRW, roofY + parapetHeight, config.z + halfRD)
    );

    // Rooftop Features
    // 1. Classic NYC Wooden Water Tower on 4-legged trestle
    if (config.hasWaterTower) {
      this.buildWaterTower(bGroup, halfRW * 0.35, roofY, halfRD * 0.35, config.x, config.z);
    }

    // 2. Industrial Rooftop HVAC Box Chillers
    if (config.hasHvac) {
      this.buildHvacChiller(bGroup, halfRW * 0.2, roofY, -halfRD * 0.3);
      if (roofW > 22) {
        this.buildHvacChiller(bGroup, -halfRW * 0.3, roofY, halfRD * 0.2);
      }
    }

    // 3. Radio / Telecommunication Antenna Spire
    if (config.hasAntenna) {
      this.buildAntennaSpire(bGroup, 0, roofY, 0, config.x, config.z);
    }

    // 4. Special Sky Bridge landing on the Connected Adjacent Building
    if (config.style === 'terrace') {
      this.buildTerracePerimeterRailing(bGroup, roofW, roofD, roofY);
    }

    // 5. Balconies on tall monolithic faces (landing pads with rails + latches)
    const tiered = setbackHeight !== undefined && setbackScale !== undefined && setbackHeight < height;
    if (!tiered && height >= 42) {
      this.buildBalconies(bGroup, config);
    }

    parent.add(bGroup);
  }

  /**
   * Balcony modules on the face toward the city center, every 18m up to 3 per tower.
   * Each balcony: standable slab, 3-sided railing, corner latch anchors with glints,
   * and collision shells (floor to stand, outer rail to lean on).
   */
  private buildBalconies(parent: THREE.Group, config: SkyscraperConfig): void {
    // Face toward the map center on the dominant axis
    let nx = 0;
    let nz = 0;
    if (Math.abs(config.x) >= Math.abs(config.z)) {
      nx = config.x > 0 ? -1 : 1;
    } else {
      nz = config.z > 0 ? -1 : 1;
    }
    if (nx === 0 && nz === 0) nz = -1;

    const hw = config.width / 2;
    const hd = config.depth / 2;
    const alongW = 5.0;   // platform width along the face
    const outD = 2.2;     // platform depth outward
    const railH = 1.1;
    const railT = 0.12;

    let placed = 0;
    for (let y = 18; y < config.height - 6 && placed < 3; y += 18) {
      placed++;
      const cx = nx * (hw + outD / 2);
      const cz = nz * (hd + outD / 2);
      const sillY = y - 0.15;

      // Slab (blocks bullets = cover, stands players via shell below)
      const slabGeom = new THREE.BoxGeometry(nx !== 0 ? outD : alongW, 0.3, nx !== 0 ? alongW : outD);
      const slab = this.addMeshWithEdges(parent, slabGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
      slab.position.set(cx, sillY, cz);

      // Landable trim strip along the outer edge of the balcony slab
      const trimT = 0.04;
      const trimW = 0.18;
      const bTrimGeom = new THREE.BoxGeometry(
        nx !== 0 ? trimW : alongW,
        trimT,
        nx !== 0 ? alongW : trimW
      );
      const bTrim = new THREE.Mesh(bTrimGeom, this.landableTrimMat);
      const trimOffset = outD * 0.5 - trimW * 0.5;
      bTrim.position.set(
        cx + nx * trimOffset,
        sillY + 0.15 + trimT * 0.5,
        cz + nz * trimOffset
      );
      bTrim.raycast = () => {};
      parent.add(bTrim);

      // Outer railing + two side rails (visual + bullet cover)
      const outerLen = alongW;
      const outerGeom = new THREE.BoxGeometry(nx !== 0 ? railT : outerLen, railH, nx !== 0 ? outerLen : railT);
      const outer = this.addMeshWithEdges(parent, outerGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      outer.position.set(cx + nx * (outD / 2 - railT / 2), y + railH / 2, cz + nz * (outD / 2 - railT / 2));

      const sideLen = outD - railT;
      const sideGeom = new THREE.BoxGeometry(nx !== 0 ? sideLen : railT, railH, nx !== 0 ? railT : sideLen);
      for (const s of [-1, 1]) {
        const tx = -nz; // tangent along face
        const tz = nx;
        const side = this.addMeshWithEdges(parent, sideGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
        side.position.set(
          cx + tx * s * (alongW / 2 - railT / 2),
          y + railH / 2,
          cz + tz * s * (alongW / 2 - railT / 2)
        );
      }

      // Corner latch anchors with ink glints (preferential web targets)
      const tx2 = -nz;
      const tz2 = nx;
      for (const s of [-1, 1]) {
        const lx = config.x + cx + tx2 * s * (alongW / 2) + nx * (outD / 2);
        const lz = config.z + cz + tz2 * s * (alongW / 2) + nz * (outD / 2);
        const anchor = new THREE.Vector3(lx, y + 1.3, lz);
        this.webAnchors.push(anchor);
        this.addLatchGlint(parent, lx - config.x, y + 1.3, lz - config.z);
      }

      // Collision shells: standable floor + leanable outer rail
      this.balconySpecs.push({
        cx: config.x + cx, cy: y, cz: config.z + cz,
        hw: nx !== 0 ? outD / 2 : alongW / 2,
        hd: nx !== 0 ? alongW / 2 : outD / 2,
        nx, nz,
      });
    }
  }

  /** Small red ink diamond marking a curated latch point. Never raycastable. */
  private addLatchGlint(parent: THREE.Group, lx: number, ly: number, lz: number): void {
    if (!this.glintMat) {
      this.glintMat = new THREE.MeshBasicMaterial({ color: 0xd63031, toneMapped: false });
      this.glintGeom = new THREE.OctahedronGeometry(0.22);
    }
    const glint = new THREE.Mesh(this.glintGeom as THREE.BufferGeometry, this.glintMat);
    glint.position.set(lx, ly, lz);
    glint.raycast = () => {};
    parent.add(glint);
  }

  /**
   * Builds an authentic NYC cedar water tower on a 4-legged steel/timber trestle frame
   */
  private buildWaterTower(
    parent: THREE.Group,
    localX: number,
    roofY: number,
    localZ: number,
    worldX: number,
    worldZ: number
  ): void {
    const wtGroup = new THREE.Group();
    wtGroup.name = 'WaterTower';
    wtGroup.position.set(localX, roofY, localZ);

    const standHeight = 4.5;
    const standWidth = 3.6;

    // 4 angled trestle legs
    const legGeom = new THREE.BoxGeometry(0.18, standHeight, 0.18);
    const legOffsets = [-standWidth * 0.5, standWidth * 0.5];

    for (const ox of legOffsets) {
      for (const oz of legOffsets) {
        const leg = this.addMeshWithEdges(wtGroup, legGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
        leg.position.set(ox, standHeight * 0.5, oz);
      }
    }

    // Cross horizontal struts
    const strutGeom = new THREE.BoxGeometry(standWidth, 0.08, 0.08);
    const s1 = this.addMeshWithEdges(wtGroup, strutGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    s1.position.set(0, standHeight * 0.5, -standWidth * 0.5);

    const s2 = this.addMeshWithEdges(wtGroup, strutGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    s2.position.set(0, standHeight * 0.5, standWidth * 0.5);

    // Support platform deck
    const deckGeom = new THREE.BoxGeometry(standWidth + 0.4, 0.25, standWidth + 0.4);
    const deck = this.addMeshWithEdges(wtGroup, deckGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
    deck.position.set(0, standHeight + 0.125, 0);

    // Cylindrical wooden water tank
    const tankRadius = 1.9;
    const tankHeight = 3.4;
    const tankGeom = new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 14);
    const tank = this.addMeshWithEdges(wtGroup, tankGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
    tank.position.set(0, standHeight + 0.25 + tankHeight * 0.5, 0);

    // Conical roof cap
    const capHeight = 1.4;
    const capGeom = new THREE.ConeGeometry(tankRadius + 0.25, capHeight, 14);
    const cap = this.addMeshWithEdges(wtGroup, capGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
    cap.position.set(0, standHeight + 0.25 + tankHeight + capHeight * 0.5, 0);

    // Steel bands around wooden barrel
    const bandHeights = [0.8, 1.7, 2.6];
    for (const bh of bandHeights) {
      const hoopGeom = new THREE.CylinderGeometry(tankRadius + 0.02, tankRadius + 0.02, 0.06, 14, 1, true);
      const hoop = this.addMeshWithEdges(wtGroup, hoopGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      hoop.position.set(0, standHeight + 0.25 + bh, 0);
    }

    parent.add(wtGroup);

    // High-value grapple point right at the peak of the conical cap
    const peakWorldY = roofY + standHeight + 0.25 + tankHeight + capHeight;
    this.webAnchors.push(new THREE.Vector3(worldX + localX, peakWorldY, worldZ + localZ));

    // Water-tower deck ring latch anchor + ink glint
    const deckWorldY = roofY + standHeight + 0.3;
    this.webAnchors.push(new THREE.Vector3(worldX + localX, deckWorldY, worldZ + localZ));
    this.addLatchGlint(parent, localX, deckWorldY - roofY, localZ);
  }

  /**
   * Builds an industrial rooftop HVAC box chiller unit
   */
  private buildHvacChiller(parent: THREE.Group, localX: number, roofY: number, localZ: number): void {
    const hvacGroup = new THREE.Group();
    hvacGroup.name = 'HvacChiller';
    hvacGroup.position.set(localX, roofY, localZ);

    // Main heavy metal cabinet
    const cabWidth = 4.2;
    const cabHeight = 2.2;
    const cabDepth = 2.6;

    const cabGeom = new THREE.BoxGeometry(cabWidth, cabHeight, cabDepth);
    const cab = this.addMeshWithEdges(hvacGroup, cabGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    cab.position.set(0, cabHeight * 0.5, 0);

    // Dual circular exhaust fan wells on top
    const fanRadius = 0.8;
    const fanHeight = 0.35;
    const fanGeom = new THREE.CylinderGeometry(fanRadius, fanRadius, fanHeight, 12);

    const fan1 = this.addMeshWithEdges(hvacGroup, fanGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    fan1.position.set(-1.1, cabHeight + fanHeight * 0.5, 0);

    const fan2 = this.addMeshWithEdges(hvacGroup, fanGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    fan2.position.set(1.1, cabHeight + fanHeight * 0.5, 0);

    // Side ventilation intake louvers
    const louverGeom = new THREE.BoxGeometry(3.6, 1.2, 0.08);
    const l1 = this.addMeshWithEdges(hvacGroup, louverGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    l1.position.set(0, cabHeight * 0.5, cabDepth * 0.5 + 0.04);

    parent.add(hvacGroup);
  }

  /**
   * Builds a tall radio / telecommunications antenna mast
   */
  private buildAntennaSpire(
    parent: THREE.Group,
    localX: number,
    roofY: number,
    localZ: number,
    worldX: number,
    worldZ: number
  ): void {
    const antennaGroup = new THREE.Group();
    antennaGroup.name = 'RadioAntenna';
    antennaGroup.position.set(localX, roofY, localZ);

    const mastHeight = 16.0;

    // Base pedestal
    const pedGeom = new THREE.BoxGeometry(2.0, 1.0, 2.0);
    const ped = this.addMeshWithEdges(antennaGroup, pedGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    ped.position.set(0, 0.5, 0);

    // Tapered vertical mast
    const mastGeom = new THREE.CylinderGeometry(0.08, 0.28, mastHeight, 8);
    const mast = this.addMeshWithEdges(antennaGroup, mastGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    mast.position.set(0, 1.0 + mastHeight * 0.5, 0);

    // Horizontal dipole arms
    const armLengths = [3.2, 2.4, 1.6];
    const armHeights = [5.0, 9.0, 13.0];

    for (let a = 0; a < armLengths.length; a++) {
      const armGeom = new THREE.CylinderGeometry(0.03, 0.03, armLengths[a], 6);
      const arm = this.addMeshWithEdges(antennaGroup, armGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      arm.rotation.z = Math.PI * 0.5;
      arm.position.set(0, 1.0 + armHeights[a], 0);
    }

    // Top blinking accent ink beacon sphere
    const beaconGeom = new THREE.SphereGeometry(0.35, 8, 8);
    const beacon = this.addMeshWithEdges(antennaGroup, beaconGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, true);
    beacon.position.set(0, 1.0 + mastHeight + 0.35, 0);

    parent.add(antennaGroup);

    // Prime high-altitude grapple anchor at the tip
    this.webAnchors.push(new THREE.Vector3(worldX + localX, roofY + 1.0 + mastHeight + 0.5, worldZ + localZ));
  }

  /**
   * Builds perimeter terrace railings for the Connected Adjacent Building
   */
  private buildTerracePerimeterRailing(parent: THREE.Group, roofW: number, roofD: number, roofY: number): void {
    const railHeight = 1.1;
    const halfW = roofW * 0.5;
    const halfD = roofD * 0.5;

    // East side railing has gap where skybridge docks at x = -35 (which is localX = halfW = 13.0)
    // North railing
    const nRailGeom = new THREE.BoxGeometry(roofW, 0.08, 0.08);
    const nRail = this.addMeshWithEdges(parent, nRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    nRail.position.set(0, roofY + railHeight, halfD - 0.1);

    // South railing
    const sRail = this.addMeshWithEdges(parent, nRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    sRail.position.set(0, roofY + railHeight, -halfD + 0.1);

    // West railing
    const wRailGeom = new THREE.BoxGeometry(0.08, 0.08, roofD);
    const wRail = this.addMeshWithEdges(parent, wRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    wRail.position.set(-halfW + 0.1, roofY + railHeight, 0);

    // East railing with bridge entry gap (gap from z: -2.0 to +2.0)
    const eRailHalfL = (roofD - 4.5) * 0.5;
    const eRailGeom = new THREE.BoxGeometry(0.08, 0.08, eRailHalfL);

    const eRail1 = this.addMeshWithEdges(parent, eRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    eRail1.position.set(halfW - 0.1, roofY + railHeight, halfD - eRailHalfL * 0.5);

    const eRail2 = this.addMeshWithEdges(parent, eRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    eRail2.position.set(halfW - 0.1, roofY + railHeight, -halfD + eRailHalfL * 0.5);

    // Connected Adjacent Building (B1) skybridge dock steps:
    // Connects skybridge deck (15.4) to B1 terrace roof (18.0) without jumping
    const stepMat = this.roofMat;
    const s1Geom = new THREE.BoxGeometry(2.0, 0.45, 3.6);
    const s1 = this.addMeshWithEdges(parent, s1Geom, stepMat, InkShaderMaterial.defaultInkColor, true);
    s1.position.set(12.0, 16.025, 0);

    const s2Geom = new THREE.BoxGeometry(2.0, 0.5, 3.6);
    const s2 = this.addMeshWithEdges(parent, s2Geom, stepMat, InkShaderMaterial.defaultInkColor, true);
    s2.position.set(10.0, 16.85, 0);

    const s3Geom = new THREE.BoxGeometry(2.0, 0.5, 3.6);
    const s3 = this.addMeshWithEdges(parent, s3Geom, stepMat, InkShaderMaterial.defaultInkColor, true);
    s3.position.set(8.0, 17.75, 0);

    // Landable trim on the front edge of each step
    const stepTrimGeom = new THREE.BoxGeometry(0.15, 0.04, 3.6);
    for (const [sx, sy] of [[12.9, 16.27], [10.9, 17.12], [8.9, 18.02]]) {
      const st = new THREE.Mesh(stepTrimGeom, this.landableTrimMat);
      st.position.set(sx, sy, 0);
      st.raycast = () => {};
      parent.add(st);
    }

    // Side handrails along the dock steps (North and South at z = ±1.8)
    const stepRailGeom = new THREE.BoxGeometry(6.0, 0.08, 0.08);
    for (const sz of [-1.8, 1.8]) {
      const sr = this.addMeshWithEdges(parent, stepRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      sr.rotation.z = -Math.atan2(2.6, 6.0); // angle ascending from 15.4 to 18.0
      sr.position.set(10.0, 17.8, sz);
    }
  }

  /**
   * Builds low HVAC/vent box cover units on setback terraces that serve as chest cover
   * and stepping platforms.
   */
  private buildTerraceHvacProps(
    parent: THREE.Group,
    config: SkyscraperConfig,
    terraceY: number,
    roofW: number,
    roofD: number
  ): void {
    const hd = config.depth * 0.5;
    const halfRD = roofD * 0.5;

    const hvacH = 1.3;
    const hvacW = 2.4;
    const hvacD = 1.6;

    const northWalkwayZ = (halfRD + hd) * 0.5;
    const southWalkwayZ = -(halfRD + hd) * 0.5;

    const positions = [
      { lx: 0, lz: northWalkwayZ, w: hvacW, d: hvacD },
      { lx: 0, lz: southWalkwayZ, w: hvacW, d: hvacD },
    ];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const hGroup = new THREE.Group();
      hGroup.name = `TerraceHvac_${i}`;
      hGroup.position.set(pos.lx, terraceY, pos.lz);

      const cabGeom = new THREE.BoxGeometry(pos.w, hvacH, pos.d);
      const cab = this.addMeshWithEdges(hGroup, cabGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      cab.position.set(0, hvacH * 0.5, 0);

      const fanGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.2, 10);
      const fan = this.addMeshWithEdges(hGroup, fanGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      fan.position.set(0, hvacH + 0.1, 0);

      parent.add(hGroup);

      this.terraceHvacSpecs.push({
        cx: config.x + pos.lx,
        cy: terraceY,
        cz: config.z + pos.lz,
        w: pos.w,
        h: hvacH,
        d: pos.d,
      });
    }
  }

  /**
   * Balconies on the upper tier of tall setback skyscrapers.
   */
  private buildTieredBalconies(
    parent: THREE.Group,
    config: SkyscraperConfig,
    baseH: number,
    upperH: number,
    roofW: number,
    roofD: number
  ): void {
    let nx = 0;
    let nz = 0;
    if (Math.abs(config.x) >= Math.abs(config.z)) {
      nx = config.x > 0 ? -1 : 1;
    } else {
      nz = config.z > 0 ? -1 : 1;
    }
    if (nx === 0 && nz === 0) nz = -1;

    const hw = roofW * 0.5;
    const hd = roofD * 0.5;
    const alongW = 4.6;
    const outD = 2.0;
    const railH = 1.1;
    const railT = 0.12;

    let placed = 0;
    for (let yRel = 12; yRel < upperH - 6 && placed < 2; yRel += 12) {
      placed++;
      const y = baseH + yRel;
      const cx = nx * (hw + outD * 0.5);
      const cz = nz * (hd + outD * 0.5);
      const sillY = y - 0.15;

      const slabGeom = new THREE.BoxGeometry(nx !== 0 ? outD : alongW, 0.3, nx !== 0 ? alongW : outD);
      const slab = this.addMeshWithEdges(parent, slabGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
      slab.position.set(cx, sillY, cz);

      // Landable trim on outer edge
      const trimT = 0.04;
      const trimW = 0.18;
      const bTrimGeom = new THREE.BoxGeometry(
        nx !== 0 ? trimW : alongW,
        trimT,
        nx !== 0 ? alongW : trimW
      );
      const bTrim = new THREE.Mesh(bTrimGeom, this.landableTrimMat);
      const trimOffset = outD * 0.5 - trimW * 0.5;
      bTrim.position.set(cx + nx * trimOffset, sillY + 0.15 + trimT * 0.5, cz + nz * trimOffset);
      bTrim.raycast = () => {};
      parent.add(bTrim);

      const outerGeom = new THREE.BoxGeometry(nx !== 0 ? railT : alongW, railH, nx !== 0 ? alongW : railT);
      const outer = this.addMeshWithEdges(parent, outerGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      outer.position.set(cx + nx * (outD * 0.5 - railT * 0.5), y + railH * 0.5, cz + nz * (outD * 0.5 - railT * 0.5));

      const sideLen = outD - railT;
      const sideGeom = new THREE.BoxGeometry(nx !== 0 ? sideLen : railT, railH, nx !== 0 ? railT : sideLen);
      const tx = -nz;
      const tz = nx;
      for (const s of [-1, 1]) {
        const side = this.addMeshWithEdges(parent, sideGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
        side.position.set(
          cx + tx * s * (alongW * 0.5 - railT * 0.5),
          y + railH * 0.5,
          cz + tz * s * (alongW * 0.5 - railT * 0.5)
        );
      }

      for (const s of [-1, 1]) {
        const lx = config.x + cx + tx * s * (alongW * 0.5) + nx * (outD * 0.5);
        const lz = config.z + cz + tz * s * (alongW * 0.5) + nz * (outD * 0.5);
        this.webAnchors.push(new THREE.Vector3(lx, y + 1.3, lz));
        this.addLatchGlint(parent, lx - config.x, y + 1.3, lz - config.z);
      }

      this.balconySpecs.push({
        cx: config.x + cx,
        cy: y,
        cz: config.z + cz,
        hw: nx !== 0 ? outD * 0.5 : alongW * 0.5,
        hd: nx !== 0 ? alongW * 0.5 : outD * 0.5,
        nx,
        nz,
      });
    }
  }

  /**
   * Builds an 8m industrial roof mast with beacon and tip latch on industrial buildings.
   */
  private buildIndustrialMast(parent: THREE.Group, config: SkyscraperConfig, roofY: number): void {
    const mastGroup = new THREE.Group();
    mastGroup.name = 'IndustrialMast';
    mastGroup.position.set(0, roofY, 0);

    const mastHeight = 8.0;

    const pedGeom = new THREE.BoxGeometry(1.4, 0.6, 1.4);
    const ped = this.addMeshWithEdges(mastGroup, pedGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    ped.position.set(0, 0.3, 0);

    const mastGeom = new THREE.CylinderGeometry(0.06, 0.16, mastHeight, 6);
    const mast = this.addMeshWithEdges(mastGroup, mastGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    mast.position.set(0, 0.6 + mastHeight * 0.5, 0);

    const beaconGeom = new THREE.SphereGeometry(0.25, 6, 6);
    const beacon = this.addMeshWithEdges(mastGroup, beaconGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, true);
    beacon.position.set(0, 0.6 + mastHeight + 0.25, 0);

    parent.add(mastGroup);

    const tipY = roofY + 0.6 + mastHeight + 0.3;
    this.webAnchors.push(new THREE.Vector3(config.x, tipY, config.z));
    this.addLatchGlint(parent, 0, tipY - roofY, 0);
  }

  /**
   * Builds drifting hand-drawn sketched puffy clouds in the sky
   */
  private buildSkyClouds(): void {
    const cloudsGroup = new THREE.Group();
    cloudsGroup.name = 'SkyClouds';

    const numClouds = 14;
    const cloudGeom = new THREE.SphereGeometry(1.0, 10, 8);

    for (let c = 0; c < numClouds; c++) {
      const cGroup = new THREE.Group();
      cGroup.name = `PuffyCloud_${c}`;

      const initX = -240.0 + (c / numClouds) * 480.0 + (Math.sin(c * 3.7) * 25.0);
      const initY = 75.0 + ((c % 5) * 14.0) + (Math.cos(c * 2.1) * 8.0);
      const initZ = -220.0 + ((c * 37) % 440);

      cGroup.position.set(initX, initY, initZ);

      // Cloud cluster composed of 4-6 overlapping sketch ellipsoids
      const numPuffs = 4 + (c % 3);
      for (let p = 0; p < numPuffs; p++) {
        const puff = this.addMeshWithEdges(cGroup, cloudGeom, this.cloudMat, InkShaderMaterial.defaultInkColor, false);

        const puffRadius = 7.0 + (p * 2.1) % 5.0;
        puff.scale.set(puffRadius * 1.3, puffRadius * 0.7, puffRadius * 0.9);

        const ox = -6.0 + p * 3.8;
        const oy = Math.sin(p * 1.2) * 1.8;
        const oz = Math.cos(p * 1.5) * 2.2;
        puff.position.set(ox, oy, oz);
      }

      cloudsGroup.add(cGroup);

      this.clouds.push({
        mesh: cGroup,
        speed: 2.2 + (c % 4) * 0.8,
        initialY: initY,
        bobPhase: c * 1.35
      });
    }

    this.group.add(cloudsGroup);
  }

  /**
   * Builds distant low-poly city skyline silhouette clusters
   */
  private buildDistantSkyline(): void {
    const skylineGroup = new THREE.Group();
    skylineGroup.name = 'DistantSkyline';

    const numSilhouettes = 28;
    const ringRadius = 340.0;

    for (let s = 0; s < numSilhouettes; s++) {
      const angle = (s / numSilhouettes) * Math.PI * 2.0;
      const dist = ringRadius + (Math.sin(s * 5.1) * 40.0);
      const sx = Math.cos(angle) * dist;
      const sz = Math.sin(angle) * dist;

      const sWidth = 35.0 + (s % 5) * 8.0;
      const sDepth = 35.0 + ((s + 2) % 4) * 8.0;
      const sHeight = 85.0 + ((s * 17) % 85); // 85m to 170m

      const sGeom = new THREE.BoxGeometry(sWidth, sHeight, sDepth);
      const tower = this.addMeshWithEdges(skylineGroup, sGeom, this.silhouetteMat, this.silhouetteMat.uniforms.uInkColor.value, false);
      tower.position.set(sx, sHeight * 0.5, sz);
    }

    this.group.add(skylineGroup);
  }

  /**
   * Fast spatial raycasting for web anchors with conical target-assist magnet
   */
  public findNearestAnchor(raycaster: THREE.Raycaster, maxDist: number = 90.0): WebAnchor | null {
    // 1. Direct raycast against solid geometry (facades, beams, cranes, parapets)
    const hits = raycaster.intersectObjects(this.collidableMeshes, false);

    let nearestHit: THREE.Intersection | null = null;
    for (const hit of hits) {
      if (hit.distance <= maxDist && hit.point) {
        nearestHit = hit;
        break;
      }
    }

    if (nearestHit && nearestHit.point) {
      const normal = nearestHit.face ? nearestHit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      // Transform normal by object's world rotation matrix
      normal.transformDirection(nearestHit.object.matrixWorld);

      const isLedge = normal.y > 0.6;

      return {
        point: nearestHit.point.clone(),
        normal: normal,
        distance: nearestHit.distance,
        object: nearestHit.object,
        isLedge: isLedge
      };
    }

    // 2. Grapple-assist magnet: if direct raycast hits the open sky, find the best iconic anchor within aim cone
    let bestAnchor: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    let bestDist = 0;

    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction;
    const toAnchor = new THREE.Vector3();

    const maxAssistAngle = 0.38; // ~22 degrees conical tolerance

    for (const anchor of this.webAnchors) {
      toAnchor.subVectors(anchor, rayOrigin);
      const dist = toAnchor.length();

      // Check distance window (must be in range and not too close to player)
      if (dist >= 5.0 && dist <= maxDist) {
        toAnchor.normalize();
        const angle = rayDir.angleTo(toAnchor);

        if (angle < maxAssistAngle) {
          // Weighted score favoring tight aim and closer distance
          const score = angle * 0.65 + (dist / maxDist) * 0.35;
          if (score < bestScore) {
            bestScore = score;
            bestAnchor = anchor;
            bestDist = dist;
          }
        }
      }
    }

    if (bestAnchor) {
      const normal = new THREE.Vector3().subVectors(rayOrigin, bestAnchor).normalize();
      return {
        point: bestAnchor.clone(),
        normal: normal,
        distance: bestDist,
        isLedge: true
      };
    }

    return null;
  }

  /**
   * Updates animations, cloud drifting, crane sway, and hand-drawn line-boil time
   */
  public update(dt: number): void {
    this.elapsed += dt;

    // 1. Update construction site animations & line-boil
    this.constructionSite.update(dt);

    // 2. Update city ink shader materials line-boil
    for (const mat of this.materials) {
      if (mat.uniforms && mat.uniforms.uTime) {
        mat.uniforms.uTime.value = this.elapsed;
      }
    }

    // 3. Update drifting puffy clouds in the sky
    const halfSpan = 270.0;
    for (const cloud of this.clouds) {
      cloud.mesh.position.x += cloud.speed * dt;

      // Wrap around when reaching sky boundary
      if (cloud.mesh.position.x > halfSpan) {
        cloud.mesh.position.x = -halfSpan;
      }

      // Gentle vertical bobbing
      cloud.mesh.position.y = cloud.initialY + Math.sin(this.elapsed * 0.5 + cloud.bobPhase) * 1.5;
    }
  }

  /**
   * Returns all collidable meshes across the city and construction site
   */
  public getCollidableMeshes(): THREE.Mesh[] {
    return this.collidableMeshes;
  }

  /**
   * Returns all curated web anchor points
   */
  public getWebAnchors(): THREE.Vector3[] {
    return this.webAnchors;
  }

  /**
   * Returns the ConstructionSite instance
   */
  public getConstructionSite(): ConstructionSite {
    return this.constructionSite;
  }

  /**
   * Returns the root THREE.Group
   */
  public getGroup(): THREE.Group {
    return this.group;
  }
}

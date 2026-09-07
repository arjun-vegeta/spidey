import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { ConstructionSite } from './ConstructionSite';
import { WebAnchor } from '../player/SwingPhysics';
import { WorldCollider } from './WorldCollider';
import { COVER_RAIL_HEIGHT } from '../core/CoverMetrics';
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
  // Six-building district extras
  skybridgeDock?: boolean; // terrace railing + dock steps to the site skybridge
  julietRows?: number; // rows of decorative juliet rails on the site-facing face
  perchLedges?: boolean; // climbable all-face perch ledges every 8m (zip up + sit)
  pergola?: boolean; // rooftop pergola beams over the terrace
  manualRoof?: boolean; // skip default tank/HVAC (custom roof built instead)
  smokestack?: boolean; // tall brick chimney (industrial landmark + height anchor)
  mansard?: boolean; // stepped verdigris mansard cap + dormers (copper annex)
  marquee?: boolean; // theater front: canopy, bulb row, blade sign
  flyTower?: boolean; // theater stage-house tower (tall rear block)
  ink?: number; // per-building facade pen-ink tint (notebook doodle palette)
  trimInk?: number; // per-building darker trim ink
}

interface CloudData {
  mesh: THREE.Group;
  speed: number;
  initialY: number;
  bobPhase: number;
}

/**
 * Eight-building ink district around the central Construction Site.
 * Each landmark owns a pen-ink palette + a traversal personality:
 * slate dockside terrace (skybridge dock), teal glass slab (balcony rows),
 * sepia deco crown (walkable tiers), brick walkup (pergola terrace),
 * moss waterworks (tank farm + smokestack), plum ledge tower (perch ledges),
 * verdigris copper annex (mansard + dormers), charcoal noir theater
 * (marquee bulbs, blade sign, fly tower).
 * Street furniture: lamp posts, red hydrants, trash cans.
 * - Rooftop details: wooden water towers, HVAC chillers, antennae, parapets
 * - Street ground plane, drifting clouds, distant skyline silhouette
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
  // Roof-prop shells: water-tank bodies + decks, chiller cabinets, smokestacks,
  // lamp posts, hydrants and trash cans. Visuals are never colliders.
  private tankSpecs: Array<{ cx: number; cy: number; cz: number; r: number; deckTop: number; bodyTop: number }> = [];
  private roofHvacSpecs: Array<{ cx: number; cy: number; cz: number; w: number; h: number; d: number }> = [];
  private stackSpecs: Array<{ cx: number; cz: number; baseY: number; topY: number; r: number }> = [];
  private towerSpecs: Array<{ cx: number; cz: number; hw: number; hd: number; h: number }> = [];
  private streetPropSpecs: Array<{ x: number; z: number; r: number; h: number }> = [];
  private twoStoryColliders: Array<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; tag: 'wall' | 'floor' }> = [];
  private lampGlowMat: THREE.MeshBasicMaterial | null = null;

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
      [0, -50, 32, 28],
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
   * Generates the eight ink-district landmarks with detailed rooftops
   */
  private buildSkyscrapers(): void {
    const buildingsGroup = new THREE.Group();
    buildingsGroup.name = 'Skyscrapers';

    // Skyscraper architectural specifications
    // Six-building ink district: construction site at center, one landmark per side.
    // Each building owns an ink palette + a traversal personality.
    const configs: SkyscraperConfig[] = [
      // W. Dockside Terrace — skybridge dock, slate blue-grey ink
      {
        x: -54.0,
        z: 0.0,
        width: 26.0,
        depth: 24.0,
        height: 18.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'terrace',
        skybridgeDock: true,
        julietRows: 2,
        ink: 0x2a3a6e,
        trimInk: 0x141c42
      },
      // E. Glass Slab — tall teal tower, balcony rows facing the site
      {
        x: 52.0,
        z: 0.0,
        width: 20.0,
        depth: 26.0,
        height: 66.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern',
        ink: 0x24606e,
        trimInk: 0x12333b
      },
      // N. Deco Crown — sepia art-deco tiers, walkable crown ring
      {
        x: 0.0,
        z: 68.0,
        width: 26.0,
        depth: 26.0,
        height: 88.0,
        hasWaterTower: false,
        hasHvac: true,
        hasAntenna: true,
        setbackHeight: 56.0,
        setbackScale: 0.72,
        style: 'artdeco',
        ink: 0x6b4a2a,
        trimInk: 0x3d2a16
      },
      // S. Brick Walkup — low red-brick terrace house, pergola roof
      {
        x: 0.0,
        z: 42.0,
        width: 24.0,
        depth: 16.0,
        height: 15.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'terrace',
        julietRows: 2,
        pergola: true,
        ink: 0x7a3b2e,
        trimInk: 0x46211a
      },
      // NW. Waterworks — moss-green industrial block, tank farm + smokestack
      {
        x: -46.0,
        z: -44.0,
        width: 28.0,
        depth: 22.0,
        height: 13.0,
        hasWaterTower: false,
        hasHvac: false,
        hasAntenna: false,
        style: 'industrial',
        manualRoof: true,
        smokestack: true,
        ink: 0x3f5a3a,
        trimInk: 0x22341f
      },
      // SE. Ledge Tower — plum perch-ledge tower, zip up and sit
      {
        x: 46.0,
        z: 46.0,
        width: 18.0,
        depth: 18.0,
        height: 44.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        style: 'modern',
        perchLedges: true,
        ink: 0x5a2f5a,
        trimInk: 0x331a33
      },
      // NE. Copper Annex — verdigris mansard cap, dormers, juliet rows
      {
        x: 48.0,
        z: -48.0,
        width: 22.0,
        depth: 22.0,
        height: 34.0,
        hasWaterTower: true,
        hasHvac: true,
        hasAntenna: false,
        setbackHeight: 24.0,
        setbackScale: 0.72,
        style: 'modern',
        julietRows: 2,
        mansard: true,
        ink: 0x3d6e5f,
        trimInk: 0x234038
      },
      // SW. Noir Theater — charcoal stage house, marquee bulbs, fly tower
      {
        x: -48.0,
        z: 48.0,
        width: 30.0,
        depth: 20.0,
        height: 20.0,
        hasWaterTower: false,
        hasHvac: false,
        hasAntenna: false,
        style: 'industrial',
        julietRows: 2,
        marquee: true,
        flyTower: true,
        ink: 0x33363f,
        trimInk: 0x14161c
      }
    ];

    for (const config of configs) {
      this.buildSingleSkyscraper(buildingsGroup, config);
      this.mapBuildingList.push({ x: config.x, z: config.z, w: config.width, d: config.depth });
    }

    this.buildTwoStoryDepot(buildingsGroup);
    this.mapBuildingList.push({ x: 0.0, z: -50.0, w: 24.0, d: 20.0 });

    this.group.add(buildingsGroup);
    this.buildLampPosts();
    this.buildStreetProps();
    this.buildCollisionShells(configs);
  }

  /**
   * Simplified collision shells: a few big boxes per building, never the visual meshes.
   * Walls block, floors stand. Street + construction slabs included.
   * Parapets read as rails (block walk-offs, jump to vault), roof props are solid.
   */
  private buildCollisionShells(configs: SkyscraperConfig[]): void {
    const coll = new WorldCollider();

    // Street slab top at y=0.5 across the playable area
    coll.addBoxCoords(-260, -2, -260, 260, 0.5, 260, 'floor');

    // Parapet ring: half-height (0.9m) rails around a roof rect so edges block
    // like rails and read as cover. Only ever registered where a matching
    // COVER_RAIL_HEIGHT parapet mesh is actually drawn (top roofs) - never on
    // bare ledges, which stay open so you can walk off.
    // gapEast leaves the skybridge dock entry open (matches the visual rail gap).
    const parapetRing = (cx: number, cz: number, w: number, d: number, topY: number, gapEast: boolean = false): void => {
      const t = 0.35;
      const h = COVER_RAIL_HEIGHT;
      coll.addBoxCoords(cx - w / 2, topY, cz + d / 2 - t, cx + w / 2, topY + h, cz + d / 2, 'wall');
      coll.addBoxCoords(cx - w / 2, topY, cz - d / 2, cx + w / 2, topY + h, cz - d / 2 + t, 'wall');
      if (gapEast) {
        coll.addBoxCoords(cx + w / 2 - t, topY, cz - d / 2, cx + w / 2, topY + h, cz - 2.0, 'wall');
        coll.addBoxCoords(cx + w / 2 - t, topY, cz + 2.0, cx + w / 2, topY + h, cz + d / 2, 'wall');
      } else {
        coll.addBoxCoords(cx + w / 2 - t, topY, cz - d / 2, cx + w / 2, topY + h, cz + d / 2, 'wall');
      }
      coll.addBoxCoords(cx - w / 2, topY, cz - d / 2, cx - w / 2 + t, topY + h, cz + d / 2, 'wall');
    };

    for (const c of configs) {
      const hw = c.width / 2;
      const hd = c.depth / 2;
      const tiered = c.setbackHeight !== undefined && c.setbackScale !== undefined && c.setbackHeight < c.height;
      let roofW = c.width;
      let roofD = c.depth;
      if (tiered) {
        const sh = c.setbackHeight as number;
        const rw = (c.width * (c.setbackScale as number)) / 2;
        const rd = (c.depth * (c.setbackScale as number)) / 2;
        roofW = rw * 2;
        roofD = rd * 2;
        // Lower tier walls + walkable terrace ring on its roof
        coll.addBoxCoords(c.x - hw, 0, c.z - hd, c.x + hw, sh, c.z + hd, 'wall');
        coll.addBoxCoords(c.x - hw, sh - 0.2, c.z - hd, c.x + hw, sh, c.z + hd, 'floor');
        // No parapet ring here: the setback terrace has no railing mesh, only a flat
        // landable trim strip, so an edge shell would read as an invisible wall.
        // The terrace edge is open - walk off it and fall.
        // Upper tier walls + roof
        coll.addBoxCoords(c.x - rw, sh, c.z - rd, c.x + rw, c.height, c.z + rd, 'wall');
        coll.addBoxCoords(c.x - rw, c.height - 0.2, c.z - rd, c.x + rw, c.height, c.z + rd, 'floor');
      } else if (c.skybridgeDock) {
        // Entry-notch massing: main block + two stair-hall cheeks.
        // The notch (x -45..-41, z +/-2) stays open for the dock steps.
        const notchBack = c.x + hw - 4;
        const faceX = c.x + hw;
        coll.addBoxCoords(c.x - hw, 0, c.z - hd, notchBack, c.height, c.z + hd, 'wall');
        coll.addBoxCoords(c.x - hw, c.height - 0.2, c.z - hd, notchBack, c.height, c.z + hd, 'floor');
        coll.addBoxCoords(notchBack, 0, c.z + 2, faceX, c.height, c.z + hd, 'wall');
        coll.addBoxCoords(notchBack, c.height - 0.2, c.z + 2, faceX, c.height, c.z + hd, 'floor');
        coll.addBoxCoords(notchBack, 0, c.z - hd, faceX, c.height, c.z - 2, 'wall');
        coll.addBoxCoords(notchBack, c.height - 0.2, c.z - hd, faceX, c.height, c.z - 2, 'floor');
      } else {
        coll.addBoxCoords(c.x - hw, 0, c.z - hd, c.x + hw, c.height, c.z + hd, 'wall');
        coll.addBoxCoords(c.x - hw, c.height - 0.2, c.z - hd, c.x + hw, c.height, c.z + hd, 'floor');
      }
      parapetRing(c.x, c.z, roofW, roofD, c.height, !!c.skybridgeDock);

      // Rooftop access penthouse block (skipped when a fly tower owns the roof)
      if (!c.flyTower) {
        const phx = c.x - (roofW * 0.5) * 0.4;
        const phz = c.z - (roofD * 0.5) * 0.4;
        coll.addBoxCoords(phx - 2.25, c.height, phz - 1.75, phx + 2.25, c.height + 3.0, phz + 1.75, 'wall');
      }

      // Antenna + industrial mast pedestals (poles stay visual-only)
      if (c.hasAntenna) {
        coll.addBoxCoords(c.x - 1, c.height, c.z - 1, c.x + 1, c.height + 1.0, c.z + 1, 'wall');
      }
      if (c.style === 'industrial') {
        coll.addBoxCoords(c.x - 0.7, c.height, c.z - 0.7, c.x + 0.7, c.height + 0.6, c.z + 0.7, 'wall');
      }
    }

    // Water-tank barrels (solid) + walkable decks + standable caps
    for (const t of this.tankSpecs) {
      coll.addBoxCoords(t.cx - t.r, t.deckTop, t.cz - t.r, t.cx + t.r, t.bodyTop, t.cz + t.r, 'wall');
      coll.addBoxCoords(t.cx - 2, t.deckTop - 0.25, t.cz - 2, t.cx + 2, t.deckTop, t.cz + 2, 'floor');
      coll.addBoxCoords(t.cx - t.r, t.bodyTop - 0.2, t.cz - t.r, t.cx + t.r, t.bodyTop, t.cz + t.r, 'floor');
    }

    // Rooftop chiller cabinets (block + standable tops)
    for (const h of this.roofHvacSpecs) {
      coll.addBoxCoords(h.cx - h.w * 0.5, h.cy, h.cz - h.d * 0.5, h.cx + h.w * 0.5, h.cy + h.h, h.cz + h.d * 0.5, 'wall');
      coll.addBoxCoords(h.cx - h.w * 0.5, h.cy + h.h - 0.2, h.cz - h.d * 0.5, h.cx + h.w * 0.5, h.cy + h.h, h.cz + h.d * 0.5, 'floor');
    }

    // Smokestacks (solid brick)
    for (const s of this.stackSpecs) {
      coll.addBoxCoords(s.cx - s.r, s.baseY, s.cz - s.r, s.cx + s.r, s.topY, s.cz + s.r, 'wall');
    }

    // Theater fly towers (solid stage houses + standable tops)
    for (const t of this.towerSpecs) {
      coll.addBoxCoords(t.cx - t.hw, 0, t.cz - t.hd, t.cx + t.hw, t.h, t.cz + t.hd, 'wall');
      coll.addBoxCoords(t.cx - t.hw, t.h - 0.2, t.cz - t.hd, t.cx + t.hw, t.h, t.cz + t.hd, 'floor');
    }

    // Lamp posts, hydrants, trash cans (ankle-to-chest blockers)
    for (const p of this.streetPropSpecs) {
      coll.addBoxCoords(p.x - p.r, 0.5, p.z - p.r, p.x + p.r, 0.5 + p.h, p.z + p.r, 'wall');
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

    // Construction site columns (0.9m pillars, floors 0-3, stairwell hole kept open)
    for (let f = 0; f < 4; f++) {
      const colBase = f * 5.0 + 0.5;
      for (const cx of [-10.5, -3.5, 3.5, 10.5]) {
        for (const cz of [-8.5, 0, 8.5]) {
          if (cx > 5.0 && cz >= -4.0 && cz <= 6.0) continue;
          coll.addBoxCoords(cx - 0.45, colBase, cz - 0.45, cx + 0.45, colBase + 4.5, cz + 0.45, 'wall');
        }
      }
    }

    // Construction site stair flights: 10 walkable step boxes each + outer balustrade.
    // 0.5m rise per step so feet can walk up without jumping (0.55m step-up rule).
    for (let f = 0; f < 4; f++) {
      const bottomY = f * 5.0 + 0.5;
      const posX = f % 2 === 0 ? 9.5 : 7.0;
      const ascendingPlusZ = f % 2 === 0;
      for (let k = 0; k < 10; k++) {
        const top = bottomY + (k + 1) * 0.5;
        const zA = ascendingPlusZ ? -3.5 + k * 0.9 : 5.5 - (k + 1) * 0.9;
        coll.addBoxCoords(posX - 1.2, top - 1.0, zA, posX + 1.2, top, zA + 0.9, 'floor');
      }
      coll.addBoxCoords(posX + 1.2, bottomY, -3.5, posX + 1.38, bottomY + 5.0 + COVER_RAIL_HEIGHT, 5.5, 'wall');
      const topY = bottomY + 5.0;
      const lz = ascendingPlusZ ? 5.5 : -3.5;
      coll.addBoxCoords(6.5, topY - 0.2, lz - 1.5, 10.5, topY + 0.2, lz + 1.5, 'floor');
    }

    // Scaffold walk planks (tiers 1-3, north face exterior)
    for (let t = 1; t <= 3; t++) {
      const ty = t * 5.0;
      coll.addBoxCoords(-7.92, ty, -13.16, 7.92, ty + 0.08, -11.63, 'floor');
    }

    // Crane: outrigger base + lattice mast + operator cab (all solid)
    coll.addBoxCoords(-1.0, 20.5, -5.0, 5.0, 21.1, 1.0, 'wall');
    coll.addBoxCoords(0.8, 20.5, -3.2, 3.2, 44.5, -0.8, 'wall');
    coll.addBoxCoords(1.2, 44.5, -3.1, 3.2, 46.9, -0.9, 'wall');
    // Crane jib walkway (run on the boom)
    coll.addBoxCoords(2.0, 45.2, -2.55, 34.0, 45.38, -1.45, 'floor');

    // Jersey barriers, site + street + upper floors (axis-aligned, small angles padded)
    const jerseys: Array<[number, number, number, boolean, number]> = [
      [-12.0, 0.5, 12.0, false, 0], [-8.5, 0.5, 12.0, false, 0], [-5.0, 0.5, 12.0, false, 0],
      [0.0, 0.5, 12.0, false, 0], [4.0, 0.5, 12.0, false, 0.35],
      [12.0, 0.5, 10.0, true, 0], [12.0, 0.5, 6.0, true, 0],
      [-12.0, 0.5, -12.0, false, 0], [-7.0, 0.5, -12.0, false, 0],
      [-6.0, 0.5, -15.0, false, 0], [0.0, 0.5, -15.0, false, 0], [6.0, 0.5, -15.0, false, 0.35],
      [-5.0, 0.5, 15.0, false, 0], [2.0, 0.5, 15.0, false, 0.35], [8.0, 0.5, 15.0, false, 0],
      [15.0, 0.5, -3.0, true, 0], [15.0, 0.5, 3.0, true, 0],
      [-5.0, 5.5, 6.0, false, 0.35], [2.0, 10.5, -4.0, false, 0.35],
      [-3.0, 15.5, 4.0, false, 0.35], [4.0, 20.5, -6.0, false, 0],
    ];
    for (const [jx, jy, jz, longX, pad] of jerseys) {
      const hw = (longX ? 3.0 : 0.7) / 2 + pad;
      const hd = (longX ? 0.7 : 3.0) / 2 + pad;
      coll.addBoxCoords(jx - hw, jy, jz - hd, jx + hw, jy + 0.65, jz + hd, 'wall');
    }

    // Brick pallets (chest-high blockers) on their floor slabs
    const pallets: Array<[number, number, number]> = [
      [-6.0, 0.5, 2.0], [-4.0, 0.5, 2.2], [3.0, 5.5, -2.0], [-8.0, 10.5, 2.0],
      [2.0, 15.5, 5.0], [-6.0, 20.5, -5.0], [-8.0, 20.5, 4.0],
    ];
    for (const [px, py, pz] of pallets) {
      coll.addBoxCoords(px - 0.7, py, pz - 0.7, px + 0.7, py + 1.05, pz + 0.7, 'wall');
    }

    // Wooden crates (block + standable tops, incl. the stacked one)
    const crates: Array<[number, number, number, number]> = [
      [-8.0, 0.5, -5.0, 1.6], [-6.2, 0.5, -5.3, 1.2], [-7.1, 2.1, -5.1, 1.1],
      [6.0, 5.5, -6.0, 1.4], [-9.0, 15.5, -2.0, 1.5], [7.0, 20.5, 6.0, 1.3],
    ];
    for (const [cx, cy, cz, cs] of crates) {
      const hs = cs * 0.5;
      coll.addBoxCoords(cx - hs, cy, cz - hs, cx + hs, cy + cs, cz + hs, 'wall');
      coll.addBoxCoords(cx - hs, cy + cs - 0.2, cz - hs, cx + hs, cy + cs, cz + hs, 'floor');
    }

    // Construction site perimeter guardrail shells, floors 1-4. These match the
    // solid rail panels drawn in ConstructionSite.buildProps(): half-character
    // walls that block walk-offs, stop enemy bullets, and eat the player's own
    // shots when crouched behind them. Floor 3's west run splits around the
    // skybridge opening (z -1.6..1.6), which stays clear.
    for (const floor of [1, 2, 3, 4]) {
      const fy = floor * 5.0 + 0.5;
      const railTop = fy + COVER_RAIL_HEIGHT;
      // South edge (z = -10.9, x -12..5)
      coll.addBoxCoords(-12.0, fy, -11.0, 5.0, railTop, -10.8, 'wall');
      // West edge (x = -12.9)
      if (floor !== 3) {
        coll.addBoxCoords(-13.0, fy, -10.0, -12.8, railTop, 10.0, 'wall');
      }
    }

    // Skybridge deck floor shell (-41 to -13 at y=15.0..15.4)
    coll.addBoxCoords(-41, 15.0, -1.6, -13, 15.4, 1.6, 'floor');
    // Skybridge side railings (North & South): solid to COVER_RAIL_HEIGHT so a
    // crouched player is fully behind them and bullets stop in the panel.
    coll.addBoxCoords(-41, 15.4, -1.65, -13, 15.4 + COVER_RAIL_HEIGHT, -1.45, 'wall');
    coll.addBoxCoords(-41, 15.4, 1.45, -13, 15.4 + COVER_RAIL_HEIGHT, 1.65, 'wall');

    // Construction site Floor 3 West railings (north and south of bridge opening)
    coll.addBoxCoords(-13.1, 15.5, 1.6, -12.8, 15.5 + COVER_RAIL_HEIGHT, 10.0, 'wall');
    coll.addBoxCoords(-13.1, 15.5, -10.0, -12.8, 15.5 + COVER_RAIL_HEIGHT, -1.6, 'wall');

    // Skybridge dock steps: 5 walkable 0.5m rises inside the entry notch
    // (world x -45.4..-41.0 at z +/-1.8). Step k center: -41.4 - 0.8k.
    for (let k = 0; k < 5; k++) {
      const top = 15.9 + k * 0.5;
      const xc = -41.4 - k * 0.8;
      coll.addBoxCoords(xc - 0.4, top - 0.2, -1.8, xc + 0.4, top, 1.8, 'floor');
    }

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
    // Every balcony gets three rail shells, matching the three rail meshes the
    // balcony builders draw: the outer rail plus BOTH side rails. The sides were
    // previously mesh-only, so players walked straight off through them.
    // The fourth edge is the building facade, already solid.
    for (const b of this.balconySpecs) {
      coll.addBoxCoords(b.cx - b.hw, b.cy - 0.3, b.cz - b.hd, b.cx + b.hw, b.cy, b.cz + b.hd, 'floor');
      const t = 0.15;
      const railTop = b.cy + COVER_RAIL_HEIGHT;
      if (b.nx !== 0) {
        // Faces +/-x: the balcony juts along x, so the sides run along x at z = cz +/- hd
        const rx = b.nx > 0 ? b.cx + b.hw - t : b.cx - b.hw;
        coll.addBoxCoords(rx, b.cy, b.cz - b.hd, rx + t, railTop, b.cz + b.hd, 'wall');
        coll.addBoxCoords(b.cx - b.hw, b.cy, b.cz - b.hd, b.cx + b.hw, railTop, b.cz - b.hd + t, 'wall');
        coll.addBoxCoords(b.cx - b.hw, b.cy, b.cz + b.hd - t, b.cx + b.hw, railTop, b.cz + b.hd, 'wall');
      } else {
        // Faces +/-z: the balcony juts along z, so the sides run along z at x = cx +/- hw
        const rz = b.nz > 0 ? b.cz + b.hd - t : b.cz - b.hd;
        coll.addBoxCoords(b.cx - b.hw, b.cy, rz, b.cx + b.hw, railTop, rz + t, 'wall');
        coll.addBoxCoords(b.cx - b.hw, b.cy, b.cz - b.hd, b.cx - b.hw + t, railTop, b.cz + b.hd, 'wall');
        coll.addBoxCoords(b.cx + b.hw - t, b.cy, b.cz - b.hd, b.cx + b.hw, railTop, b.cz + b.hd, 'wall');
      }
    }

    // North Two-Story Depot (Grand Central Atrium & Observatorium, x: 0, z: -50)
    // Central Grand Staircase ramp (Ground 0.6 -> 2nd floor 5.2, z -48.0 to -56.0, x: -2.5..2.5)
    coll.addRampCoords(-2.5, -56.0, 2.5, -48.0, 'z', 5.2, 0.6, 0.4);
    // NE Corner Roof Staircase ramp (2nd floor 5.2 -> Roof 9.8, z -52.0 to -57.6, x: 8.5..11.5)
    coll.addRampCoords(8.5, -57.6, 11.5, -52.0, 'z', 9.8, 5.2, 0.4);
    // All solid walls, floors, partitions, steps, and balustrades for North Depot
    for (const b of this.twoStoryColliders) {
      coll.addBoxCoords(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag);
    }

    coll.finalize();
    this.worldCollider = coll;
  }

  /**
   * Read-only snapshot of every balcony platform (world centre, half extents and
   * outward normal). Exposed so tests can audit that each one is railed in.
   */
  public getBalconySpecs(): Array<{ cx: number; cy: number; cz: number; hw: number; hd: number; nx: number; nz: number }> {
    return this.balconySpecs.map((b) => ({ ...b }));
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
   * Constructs the North Two-Story Grand Central Atrium & Observatorium (x: 0, z: -50, w: 24, d: 20).
   * Features:
   * - Grand double-height central galleria atrium with open void up to central skylight
   * - Central 5m-wide grand staircase ascending to a wraparound mezzanine gallery
   * - West Wing: Armory & Dispatch Vault with security counter and weapon racks
   * - East Wing: Archive & Cartography Library with study tables and bookcases
   * - Second Floor: Mezzanine Promenade with solid iron balustrades overlooking the atrium below
   * - NE Corner Staircase leading up into a decorative Rooftop Lantern Cupola
   * - Rooftop Terrace with central glass lantern dome, water tower, HVAC plant, and perimeter parapets
   * - 100% solid collision across all steps, risers, walls, floors, railings, and ceilings
   */
  private buildTwoStoryDepot(parent: THREE.Group): void {
    const depotGroup = new THREE.Group();
    depotGroup.name = 'TwoStoryDepot';

    const depotFacadeMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x27354a) });
    const depotTrimMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x131a28) });
    const depotInteriorWallMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x354254) });
    const darkInkColor = new THREE.Color(0x131a28);
    const metalInkColor = new THREE.Color(0x0a1435);
    const glassInkColor = new THREE.Color(0x174052);
    const slateInkColor = new THREE.Color(0x151c24);
    const brassInkColor = new THREE.Color(0x5c4218);
    this.materials.push(depotFacadeMat, depotTrimMat, depotInteriorWallMat);

    // Wall slicer helper: partitions a wall interval [a1, a2] into disjoint rectangular solid boxes around cutouts
    const computeWallPieces = (
      a1: number,
      a2: number,
      h: number,
      gaps: Array<[number, number, number, number]>
    ): Array<[number, number, number, number]> => {
      const xs = new Set<number>([a1, a2]);
      for (const g of gaps) {
        xs.add(Math.min(Math.max(g[0], a1), a2));
        xs.add(Math.min(Math.max(g[1], a1), a2));
      }
      const sorted = [...xs].sort((a, b) => a - b);
      const runs = new Map<string, [number, number, number, number]>();
      const out: Array<[number, number, number, number]> = [];

      for (let i = 0; i < sorted.length - 1; i++) {
        const s1 = sorted[i];
        const s2 = sorted[i + 1];
        if (s2 - s1 < 0.005) continue;
        const mid = (s1 + s2) / 2;

        const cuts = gaps
          .filter((g) => g[0] <= mid && g[1] >= mid)
          .map((g) => [g[2] ?? 0, g[3] ?? h])
          .sort((a, b) => a[0] - b[0]);

        const pieces: Array<[number, number]> = [];
        let y = 0;
        for (const [gb, gt] of cuts) {
          if (gb > y + 0.005) pieces.push([y, gb]);
          y = Math.max(y, gt);
        }
        if (y < h - 0.005) pieces.push([y, h]);

        const keys = new Set<string>();
        for (const [yb, yt] of pieces) {
          const k = yb.toFixed(3) + ',' + yt.toFixed(3);
          keys.add(k);
          const r = runs.get(k);
          if (r && Math.abs(r[1] - s1) < 0.005) {
            r[1] = s2;
          } else {
            runs.set(k, [s1, s2, yb, yt]);
          }
        }
        for (const [k, r] of [...runs]) {
          if (!keys.has(k)) {
            out.push(r);
            runs.delete(k);
          }
        }
      }
      for (const r of runs.values()) out.push(r);
      return out;
    };

    // Helper to add a box piece with ink outlines and register solid collision
    const addBoxPiece = (
      minX: number, minY: number, minZ: number,
      maxX: number, maxY: number, maxZ: number,
      mat: THREE.Material,
      tag: 'wall' | 'floor' | null = null,
      customInkColor?: THREE.Color
    ): THREE.Mesh => {
      const w = maxX - minX;
      const h = maxY - minY;
      const d = maxZ - minZ;
      const geom = new THREE.BoxGeometry(w, h, d);
      const mesh = this.addMeshWithEdges(depotGroup, geom, mat, customInkColor ?? InkShaderMaterial.defaultInkColor, true);
      mesh.position.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
      if (tag) {
        this.twoStoryColliders.push({ minX, minY, minZ, maxX, maxY, maxZ, tag });
      }
      return mesh;
    };

    // Base geometry constants
    const bX = 0.0;
    const bZ = -50.0;
    const bW = 24.0;
    const bD = 20.0;
    const xMin = bX - bW * 0.5; // -12.0
    const xMax = bX + bW * 0.5; // +12.0
    const zMin = bZ - bD * 0.5; // -60.0
    const zMax = bZ + bD * 0.5; // -40.0
    const groundY = 0.6;
    const secondFloorY = 5.2;
    const roofY = 9.8;
    const parapetY = 9.8 + COVER_RAIL_HEIGHT; // roof slab top + half-character rail
    const wallH = roofY - groundY; // 9.2m
    const wallThick = 0.45;
    const halfThick = wallThick * 0.5;

    // --- 1. Solid Ground Floor Foundation Slab (y: 0.2 -> 0.6) ---
    addBoxPiece(xMin, 0.2, zMin, xMax, groundY, zMax, this.sidewalkMat, 'floor');

    // --- 2. Solid Exterior Walls (with open doors & windows) ---
    // South Facade (z = zMax = -40.0, span x: -12..12, h: 9.2)
    // Grand entrance double doors: x: -2.5..2.5, y: 0..3.6 (abs y: 0.6..4.2)
    // Ground windows: [-9.5, -5.5, 1.2, 3.2], [5.5, 9.5, 1.2, 3.2]
    // 2nd floor windows: [-9.5, -5.5, 5.8, 7.8], [-2.0, 2.0, 5.8, 7.8], [5.5, 9.5, 5.8, 7.8]
    const southGaps: Array<[number, number, number, number]> = [
      [-2.5, 2.5, 0.0, 3.6],
      [-9.5, -5.5, 1.2, 3.2],
      [5.5, 9.5, 1.2, 3.2],
      [-9.5, -5.5, 5.8, 7.8],
      [-2.0, 2.0, 5.8, 7.8],
      [5.5, 9.5, 5.8, 7.8]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(xMin, xMax, wallH, southGaps)) {
      addBoxPiece(a, groundY + yb, zMax - halfThick, b, groundY + yt, zMax + halfThick, depotFacadeMat, 'wall');
    }

    // North Facade (z = zMin = -60.0, span x: -12..12, h: 9.2)
    // Rear colonnade garden doors: x: -2.0..2.0, y: 0..3.2
    // Windows: [-9.5, -5.5, 1.4, 3.2], [5.5, 9.5, 1.4, 3.2], [-9.5, -5.5, 5.8, 7.8], [5.5, 9.5, 5.8, 7.8]
    const northGaps: Array<[number, number, number, number]> = [
      [-2.0, 2.0, 0.0, 3.2],
      [-9.5, -5.5, 1.4, 3.2],
      [5.5, 9.5, 1.4, 3.2],
      [-9.5, -5.5, 5.8, 7.8],
      [5.5, 9.5, 5.8, 7.8]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(xMin, xMax, wallH, northGaps)) {
      addBoxPiece(a, groundY + yb, zMin - halfThick, b, groundY + yt, zMin + halfThick, depotFacadeMat, 'wall');
    }

    // West Facade (x = xMin = -12.0, span z: -60..-40, h: 9.2)
    // Freight delivery door: z: -48.0..-45.0, y: 0..3.0
    // Windows: [-56.0, -52.0, 1.6, 3.2], [-56.0, -52.0, 5.8, 7.8], [-48.0, -44.0, 5.8, 7.8]
    const westGaps: Array<[number, number, number, number]> = [
      [-48.0, -45.0, 0.0, 3.0],
      [-56.0, -52.0, 1.6, 3.2],
      [-56.0, -52.0, 5.8, 7.8],
      [-48.0, -44.0, 5.8, 7.8]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(zMin, zMax, wallH, westGaps)) {
      addBoxPiece(xMin - halfThick, groundY + yb, a, xMin + halfThick, groundY + yt, b, depotFacadeMat, 'wall');
    }

    // East Facade (x = xMax = 12.0, span z: -60..-40, h: 9.2)
    // Windows: [-56.0, -52.0, 1.6, 3.2], [-48.0, -44.0, 1.6, 3.2], [-56.0, -52.0, 5.8, 7.8], [-48.0, -44.0, 5.8, 7.8]
    const eastGaps: Array<[number, number, number, number]> = [
      [-56.0, -52.0, 1.6, 3.2],
      [-48.0, -44.0, 1.6, 3.2],
      [-56.0, -52.0, 5.8, 7.8],
      [-48.0, -44.0, 5.8, 7.8]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(zMin, zMax, wallH, eastGaps)) {
      addBoxPiece(xMax - halfThick, groundY + yb, a, xMax + halfThick, groundY + yt, b, depotFacadeMat, 'wall');
    }

    // Window Sills & Mullions
    const windowFrames: Array<[number, number, number, boolean]> = [
      // South facade
      [-7.5, 2.2, zMax + 0.05, false], [7.5, 2.2, zMax + 0.05, false],
      [-7.5, 6.8, zMax + 0.05, false], [0.0, 6.8, zMax + 0.05, false], [7.5, 6.8, zMax + 0.05, false],
      // North facade
      [-7.5, 2.3, zMin - 0.05, false], [7.5, 2.3, zMin - 0.05, false],
      [-7.5, 6.8, zMin - 0.05, false], [7.5, 6.8, zMin - 0.05, false],
      // West facade
      [xMin - 0.05, 2.4, -54.0, true], [xMin - 0.05, 6.8, -54.0, true], [xMin - 0.05, 6.8, -46.0, true],
      // East facade
      [xMax + 0.05, 2.4, -54.0, true], [xMax + 0.05, 2.4, -46.0, true],
      [xMax + 0.05, 6.8, -54.0, true], [xMax + 0.05, 6.8, -46.0, true]
    ];
    for (const [fx, fy, fz, isZAxis] of windowFrames) {
      const sillGeom = new THREE.BoxGeometry(isZAxis ? 0.2 : 4.1, 0.12, isZAxis ? 4.1 : 0.2);
      const sill = this.addMeshWithEdges(depotGroup, sillGeom, depotTrimMat, darkInkColor, false);
      sill.position.set(fx, fy - 1.0, fz);
      const headGeom = new THREE.BoxGeometry(isZAxis ? 0.2 : 4.1, 0.12, isZAxis ? 4.1 : 0.2);
      const head = this.addMeshWithEdges(depotGroup, headGeom, depotTrimMat, darkInkColor, false);
      head.position.set(fx, fy + 1.0, fz);
      const crossGeom = new THREE.BoxGeometry(isZAxis ? 0.1 : 0.08, 1.9, isZAxis ? 0.08 : 0.1);
      const cross = this.addMeshWithEdges(depotGroup, crossGeom, depotTrimMat, darkInkColor, false);
      cross.position.set(fx, fy, fz);
    }

    // Entrance Portico Canopy & Brass Pillars (South Facade)
    const canopyW = 6.8;
    const canopyD = 2.6;
    const canopyGeom = new THREE.BoxGeometry(canopyW, 0.22, canopyD);
    const canopy = this.addMeshWithEdges(depotGroup, canopyGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, true);
    canopy.position.set(0, 4.3, zMax + canopyD * 0.5);
    // Standable top on canopy
    this.twoStoryColliders.push({
      minX: -canopyW * 0.5,
      minY: 4.2,
      minZ: zMax,
      maxX: canopyW * 0.5,
      maxY: 4.45,
      maxZ: zMax + canopyD,
      tag: 'floor'
    });
    // Two brass entrance pillars supporting the canopy
    for (const px of [-3.0, 3.0]) {
      addBoxPiece(px - 0.2, groundY, zMax + canopyD - 0.4, px + 0.2, 4.3, zMax + canopyD, this.trimMat, 'wall');
    }
    // Classical pediment above entrance
    const signGeom = new THREE.BoxGeometry(8.4, 0.95, 0.22);
    const sign = this.addMeshWithEdges(depotGroup, signGeom, depotTrimMat, darkInkColor, false);
    sign.position.set(0, 5.05, zMax + 0.25);
    const signInnerGeom = new THREE.BoxGeometry(8.0, 0.75, 0.24);
    const signInner = this.addMeshWithEdges(depotGroup, signInnerGeom, this.facadeMat, InkShaderMaterial.defaultInkColor, false);
    signInner.position.set(0, 5.05, zMax + 0.26);

    // --- 3. Ground Floor Central Atrium: Colonade & Twin Wing Partitions ---
    // 4 Grand Atrium Pillars (0.9m square) framing the open central atrium
    const atriumCols: Array<[number, number]> = [
      [-4.6, -42.0], [-4.6, -55.5], [4.6, -42.0], [4.6, -55.5]
    ];
    for (const [cx, cz] of atriumCols) {
      addBoxPiece(cx - 0.45, groundY, cz - 0.45, cx + 0.45, secondFloorY, cz + 0.45, depotTrimMat, 'wall');
      const plinthGeom = new THREE.BoxGeometry(1.2, 0.4, 1.2);
      const plinth = this.addMeshWithEdges(depotGroup, plinthGeom, this.sidewalkMat, InkShaderMaterial.defaultInkColor, false);
      plinth.position.set(cx, groundY + 0.2, cz);
    }

    // West Partition Wall (x = -5.0, span z: -60..-40, h: 4.6, from y: 0.6 to 5.2)
    // Grand archway connecting to West Armory: z: -52.0..-43.0
    const westPartitionGaps: Array<[number, number, number, number]> = [
      [-52.0, -43.0, 0.0, 3.8]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(zMin, zMax, secondFloorY - groundY, westPartitionGaps)) {
      addBoxPiece(-5.0 - 0.18, groundY + yb, a, -5.0 + 0.18, groundY + yt, b, depotInteriorWallMat, 'wall');
    }

    // East Partition Wall (x = +5.0, span z: -60..-40, h: 4.6, from y: 0.6 to 5.2)
    // Grand archway connecting to East Library: z: -52.0..-43.0
    const eastPartitionGaps: Array<[number, number, number, number]> = [
      [-52.0, -43.0, 0.0, 3.8]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(zMin, zMax, secondFloorY - groundY, eastPartitionGaps)) {
      addBoxPiece(5.0 - 0.18, groundY + yb, a, 5.0 + 0.18, groundY + yt, b, depotInteriorWallMat, 'wall');
    }

    // --- 4. West Wing: Armory & Dispatch Vault Props ---
    // Security Counter placed cleanly in West Wing (x: -10.0..-7.0, z: -43.0..-41.5, h: 1.1)
    addBoxPiece(-10.0, groundY, -43.0, -7.0, groundY + 1.1, -41.5, this.trimMat, 'wall');
    addBoxPiece(-10.1, groundY + 1.0, -43.1, -6.9, groundY + 1.15, -41.4, this.metalMat, 'floor');
    // Armory Crates & Pallets (fully solid with standable tops)
    const armoryCrates: Array<[number, number, number, number]> = [
      [-10.0, groundY, -44.0, 1.6],
      [-8.2, groundY, -44.2, 1.2],
      [-9.1, groundY + 1.6, -44.1, 1.1], // stacked crate!
      [-10.2, groundY, -56.0, 1.5],
      [-8.5, groundY, -56.2, 1.3]
    ];
    for (const [cx, cy, cz, cs] of armoryCrates) {
      const hs = cs * 0.5;
      addBoxPiece(cx - hs, cy, cz - hs, cx + hs, cy + cs, cz + hs, this.woodMat, 'wall');
      addBoxPiece(cx - hs, cy + cs - 0.15, cz - hs, cx + hs, cy + cs, cz + hs, this.woodMat, 'floor');
    }

    // --- 5. East Wing: Archive & Cartography Library Props ---
    // Oak Reading / Map Tables
    addBoxPiece(7.2, groundY, -46.0, 10.2, groundY + 0.85, -43.5, this.woodMat, 'wall');
    addBoxPiece(7.1, groundY + 0.8, -46.1, 10.3, groundY + 0.9, -43.4, this.trimMat, 'floor');
    addBoxPiece(7.2, groundY, -54.0, 10.2, groundY + 0.85, -51.5, this.woodMat, 'wall');
    addBoxPiece(7.1, groundY + 0.8, -54.1, 10.3, groundY + 0.9, -51.4, this.trimMat, 'floor');
    // Tall Bookshelves along East wall
    for (const bz of [-47.0, -53.0]) {
      addBoxPiece(11.2, groundY, bz - 1.8, 11.8, groundY + 3.8, bz + 1.8, this.woodMat, 'wall');
      addBoxPiece(11.1, groundY + 3.7, bz - 1.8, 11.8, groundY + 3.8, bz + 1.8, this.trimMat, 'floor');
    }

    // --- 6. Grand Central Staircase (Ground -> 2nd Floor Mezzanine) ---
    // Center staircase: x: -2.5..2.5 (width 5.0m).
    // Ascends from front z = -48.0 (y = 0.6) to rear z = -56.0 (y = 5.2). Length = 8.0m.
    const stair1Steps = 14;
    const stair1Rise = (secondFloorY - groundY) / stair1Steps; // 4.6 / 14 = 0.328m
    const stair1Run = 8.0 / stair1Steps; // 8.0 / 14 = 0.571m
    const stair1X1 = -2.5;
    const stair1X2 = 2.5;
    const stair1W = stair1X2 - stair1X1;

    for (let i = 0; i < stair1Steps; i++) {
      const stepZStart = -48.0 - i * stair1Run;
      const stepZEnd = -48.0 - (i + 1) * stair1Run;
      const stepZMid = (stepZStart + stepZEnd) * 0.5;
      const stepTopY = groundY + (i + 1) * stair1Rise;
      const stepBaseY = groundY + i * stair1Rise;

      // 1. Visual step mesh
      const stepGeom = new THREE.BoxGeometry(stair1W, (i + 1) * stair1Rise, stair1Run);
      const stepMesh = this.addMeshWithEdges(depotGroup, stepGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
      stepMesh.position.set(0, groundY + ((i + 1) * stair1Rise) * 0.5, stepZMid);

      // 2. Step floor collider (standable tread)
      this.twoStoryColliders.push({
        minX: stair1X1,
        minY: stepTopY - 0.2,
        minZ: stepZEnd,
        maxX: stair1X2,
        maxY: stepTopY,
        maxZ: stepZStart,
        tag: 'floor'
      });

      // Balustrade posts on left (x = -2.5) and right (x = 2.5) every 3 steps
      if (i % 3 === 0 || i === stair1Steps - 1) {
        for (const sideX of [stair1X1, stair1X2]) {
          const postGeom = new THREE.BoxGeometry(0.12, COVER_RAIL_HEIGHT, 0.12);
          const post = this.addMeshWithEdges(depotGroup, postGeom, this.metalMat, brassInkColor, false);
          post.position.set(sideX, stepTopY + COVER_RAIL_HEIGHT * 0.5, stepZMid);
        }
      }
    }

    // Solid back wall under the stairs enclosing the ground-floor under-stair volume
    addBoxPiece(stair1X1, groundY, -56.15, stair1X2, 4.8, -56.0, depotInteriorWallMat, 'wall');

    // Solid side balustrade walls along left and right of Grand Staircase (prevents falling off side).
    // Tops out half a character above the upper landing, same as every other rail.
    addBoxPiece(stair1X1 - 0.1, groundY, -55.6, stair1X1 + 0.05, secondFloorY + COVER_RAIL_HEIGHT, -48.0, this.metalMat, 'wall');
    addBoxPiece(stair1X2 - 0.05, groundY, -55.6, stair1X2 + 0.1, secondFloorY + COVER_RAIL_HEIGHT, -48.0, this.metalMat, 'wall');

    // Continuous handrail tubes on both sides
    for (const sideX of [stair1X1, stair1X2]) {
      const railGeom = new THREE.BoxGeometry(0.12, 0.12, 8.2);
      railGeom.rotateX(-Math.atan2(secondFloorY - groundY, 8.0));
      const railMesh = this.addMeshWithEdges(depotGroup, railGeom, this.trimMat, brassInkColor, false);
      railMesh.position.set(sideX, (groundY + secondFloorY) * 0.5 + COVER_RAIL_HEIGHT, -52.0);
    }

    // --- 7. Second Floor Mezzanine Promenade (y = 5.2, slab thickness 0.4, y: 4.8..5.2) ---
    // Wraparound layout around the central open atrium void (void is x: -5.0..5.0, z: -55.5..-43.0)
    // Slabs:
    // 1) South walkway (front facade): x: -11.8..11.8, z: -43.0..-40.2
    addBoxPiece(-11.8, 4.8, -43.0, 11.8, secondFloorY, -40.2, this.sidewalkMat, 'floor');
    // 2) North promenade (landing of grand stair): x: -11.8..11.8, z: -59.8..-55.5
    addBoxPiece(-11.8, 4.8, -59.8, 11.8, secondFloorY, -55.5, this.sidewalkMat, 'floor');
    // 3) West gallery: x: -11.8..-5.0, z: -55.5..-43.0
    addBoxPiece(-11.8, 4.8, -55.5, -5.0, secondFloorY, -43.0, this.sidewalkMat, 'floor');
    // 4) East gallery (front part): x: 5.0..11.8, z: -52.0..-43.0
    addBoxPiece(5.0, 4.8, -52.0, 11.8, secondFloorY, -43.0, this.sidewalkMat, 'floor');
    // 5) East gallery (inner strip beside NE stair): x: 5.0..8.5, z: -57.6..-52.0
    addBoxPiece(5.0, 4.8, -57.6, 8.5, secondFloorY, -52.0, this.sidewalkMat, 'floor');
    // (Notice: NE stair hole x: 8.5..11.8, z: -57.6..-52.0 is left open for the roof staircase!)

    // Solid Mezzanine Balustrades (half-character-high solid walls overlooking the atrium void:
    // shoot over them standing, take cover behind them crouched)
    // Along West edge of void: x = -5.0, z: -55.5..-43.0
    addBoxPiece(-5.1, secondFloorY, -55.5, -4.9, secondFloorY + COVER_RAIL_HEIGHT, -43.0, this.metalMat, 'wall');
    // Along East edge of void: x = +5.0, z: -55.5..-43.0
    addBoxPiece(4.9, secondFloorY, -55.5, 5.1, secondFloorY + COVER_RAIL_HEIGHT, -43.0, this.metalMat, 'wall');
    // Along South edge of void: z = -43.0, x: -5.0..+5.0
    addBoxPiece(-5.0, secondFloorY, -43.1, 5.0, secondFloorY + COVER_RAIL_HEIGHT, -42.9, this.metalMat, 'wall');

    // Visual handrail capping on mezzanine balustrades
    const capSGeom = new THREE.BoxGeometry(10.2, 0.08, 0.22);
    const capS = this.addMeshWithEdges(depotGroup, capSGeom, this.trimMat, brassInkColor, false);
    capS.position.set(0, secondFloorY + COVER_RAIL_HEIGHT, -43.0);
    const capLRGeom = new THREE.BoxGeometry(0.22, 0.08, 12.6);
    const capL = this.addMeshWithEdges(depotGroup, capLRGeom, this.trimMat, brassInkColor, false);
    capL.position.set(-5.0, secondFloorY + COVER_RAIL_HEIGHT, -49.25);
    const capR = this.addMeshWithEdges(depotGroup, capLRGeom, this.trimMat, brassInkColor, false);
    capR.position.set(5.0, secondFloorY + COVER_RAIL_HEIGHT, -49.25);

    // --- 8. Second Floor NW Executive Map Room ---
    // Partition wall along z = -52.0 (x: -11.8..-5.0, h: 4.6, from y: 5.2 to 9.8)
    // Office door: x: -8.5..-6.5, h: 3.2
    const nwRoomGaps: Array<[number, number, number, number]> = [
      [-8.5, -6.5, 0.0, 3.2]
    ];
    for (const [a, b, yb, yt] of computeWallPieces(-11.8, -5.0, roofY - secondFloorY, nwRoomGaps)) {
      addBoxPiece(a, secondFloorY + yb, -52.0 - 0.15, b, secondFloorY + yt, -52.0 + 0.15, depotInteriorWallMat, 'wall');
    }
    // Executive Drafting Table in NW Map Room
    addBoxPiece(-10.5, secondFloorY, -56.0, -8.0, secondFloorY + 1.05, -54.0, this.woodMat, 'wall');
    addBoxPiece(-10.6, secondFloorY + 1.0, -56.1, -7.9, secondFloorY + 1.15, -53.9, this.trimMat, 'floor');
    // Map Board on North wall
    const mapBoardGeom = new THREE.BoxGeometry(4.0, 1.8, 0.1);
    const mapBoard = this.addMeshWithEdges(depotGroup, mapBoardGeom, this.trimMat, darkInkColor, false);
    mapBoard.position.set(-8.5, 7.6, zMin + 0.25);
    const mapBoardInnerGeom = new THREE.BoxGeometry(3.8, 1.6, 0.12);
    const mapBoardInner = this.addMeshWithEdges(depotGroup, mapBoardInnerGeom, this.facadeMat, slateInkColor, false);
    mapBoardInner.position.set(-8.5, 7.6, zMin + 0.26);

    // --- 9. NE Corner Staircase (2nd Floor -> Rooftop Lantern Cupola) ---
    // Ascends from z = -52.0 (y = 5.2) to z = -57.6 (y = 9.8) along x: 8.5..11.5 (width 3.0m)
    const stair2Steps = 14;
    const stair2Rise = (roofY - secondFloorY) / stair2Steps; // 4.6 / 14 = 0.328m
    const stair2Run = 5.6 / stair2Steps; // 5.6 / 14 = 0.400m
    const stair2X1 = 8.5;
    const stair2X2 = 11.5;
    const stair2W = stair2X2 - stair2X1;

    for (let i = 0; i < stair2Steps; i++) {
      const stepZStart = -52.0 - i * stair2Run;
      const stepZEnd = -52.0 - (i + 1) * stair2Run;
      const stepZMid = (stepZStart + stepZEnd) * 0.5;
      const stepTopY = secondFloorY + (i + 1) * stair2Rise;
      const stepBaseY = secondFloorY + i * stair2Rise;

      // 1. Visual step mesh
      const stepGeom = new THREE.BoxGeometry(stair2W, (i + 1) * stair2Rise, stair2Run);
      const stepMesh = this.addMeshWithEdges(depotGroup, stepGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
      stepMesh.position.set((stair2X1 + stair2X2) * 0.5, secondFloorY + ((i + 1) * stair2Rise) * 0.5, stepZMid);

      // 2. Step floor collider
      this.twoStoryColliders.push({
        minX: stair2X1,
        minY: stepTopY - 0.2,
        minZ: stepZEnd,
        maxX: stair2X2,
        maxY: stepTopY,
        maxZ: stepZStart,
        tag: 'floor'
      });

    }

    // Solid back wall under the NE roof stairs (from 2nd floor up to roof slab underside at 9.4m)
    addBoxPiece(stair2X1, secondFloorY, -57.75, stair2X2, 9.4, -57.6, depotInteriorWallMat, 'wall');

    // Inner balustrade wall along inner side (x = 8.5) of NE Staircase along 2nd floor gallery
    addBoxPiece(8.4, secondFloorY, -56.0, 8.55, secondFloorY + COVER_RAIL_HEIGHT, -52.0, this.metalMat, 'wall');

    // --- 10. Solid Rooftop Slab & Perimeter Parapets (Roof level at y = 9.8) ---
    // Skylight opening: x: -4.5..4.5, z: -51.0..-44.0
    // Cupola stairwell opening: x: 8.0..11.8, z: -59.5..-55.5
    // Roof Slabs (thickness 0.4m, y: 9.4..9.8):
    // 1) South roof deck: x: -12.0..12.0, z: -44.0..-40.0
    addBoxPiece(xMin, 9.4, -44.0, xMax, roofY, zMax, this.roofMat, 'floor');
    // 2) North roof deck (west of cupola): x: -12.0..8.0, z: -60.0..-51.0
    addBoxPiece(xMin, 9.4, zMin, 8.0, roofY, -51.0, this.roofMat, 'floor');
    // 3) West roof flank: x: -12.0..-4.5, z: -51.0..-44.0
    addBoxPiece(xMin, 9.4, -51.0, -4.5, roofY, -44.0, this.roofMat, 'floor');
    // 4) East roof flank: x: 4.5..12.0, z: -51.0..-44.0
    addBoxPiece(4.5, 9.4, -51.0, xMax, roofY, -44.0, this.roofMat, 'floor');

    // Solid Perimeter Roof Parapet Walls (h = COVER_RAIL_HEIGHT, thickness 0.4m)
    addBoxPiece(xMin, roofY, zMax - 0.4, xMax, parapetY, zMax, depotTrimMat, 'wall'); // South
    addBoxPiece(xMin, roofY, zMin, xMax, parapetY, zMin + 0.4, depotTrimMat, 'wall'); // North
    addBoxPiece(xMin, roofY, zMin, xMin + 0.4, parapetY, zMax, depotTrimMat, 'wall'); // West
    addBoxPiece(xMax - 0.4, roofY, zMin, xMax, parapetY, zMax, depotTrimMat, 'wall'); // East

    // Landable Coping Trim on Parapet Top
    const copingW = new THREE.BoxGeometry(bW + 0.4, 0.14, 0.55);
    const sCoping = this.addMeshWithEdges(depotGroup, copingW, this.landableTrimMat, LANDABLE_TRIM, false);
    sCoping.position.set(0, parapetY + 0.07, zMax);
    const nCoping = this.addMeshWithEdges(depotGroup, copingW, this.landableTrimMat, LANDABLE_TRIM, false);
    nCoping.position.set(0, parapetY + 0.07, zMin);
    const copingD = new THREE.BoxGeometry(0.55, 0.14, bD + 0.4);
    const wCoping = this.addMeshWithEdges(depotGroup, copingD, this.landableTrimMat, LANDABLE_TRIM, false);
    wCoping.position.set(xMin, parapetY + 0.07, bZ);
    const eCoping = this.addMeshWithEdges(depotGroup, copingD, this.landableTrimMat, LANDABLE_TRIM, false);
    eCoping.position.set(xMax, parapetY + 0.07, bZ);

    // --- 11. Central Raised Glass Lantern Skylight (x: -4.5..4.5, z: -51.0..-44.0) ---
    // Raised clerestory base curb (h = 0.6m, y: 9.8..10.4)
    addBoxPiece(-4.5, roofY, -51.0, 4.5, roofY + 0.6, -50.6, this.metalMat, 'wall');
    addBoxPiece(-4.5, roofY, -44.4, 4.5, roofY + 0.6, -44.0, this.metalMat, 'wall');
    addBoxPiece(-4.5, roofY, -51.0, -4.1, roofY + 0.6, -44.0, this.metalMat, 'wall');
    addBoxPiece(4.1, roofY, -51.0, 4.5, roofY + 0.6, -44.0, this.metalMat, 'wall');
    // Pitched glass hip roof
    const lanternRoofGeom = new THREE.BoxGeometry(8.6, 0.8, 6.6);
    lanternRoofGeom.rotateZ(Math.PI / 16);
    const lanternRoof = this.addMeshWithEdges(depotGroup, lanternRoofGeom, this.accentMat, glassInkColor, false);
    lanternRoof.position.set(0, roofY + 1.0, -47.5);
    // Standable glass top collider
    this.twoStoryColliders.push({
      minX: -4.3,
      minY: roofY + 0.9,
      minZ: -50.8,
      maxX: 4.3,
      maxY: roofY + 1.1,
      maxZ: -44.2,
      tag: 'floor'
    });

    // --- 12. NE Rooftop Lantern Cupola (x: 8.0..12.0, z: -59.5..-51.8, y: 9.8..12.8) ---
    // Cupola enclosure walls (West wall has open door facing roof: z: -58.5..-56.0, h: 2.2)
    addBoxPiece(7.8, roofY, -59.5, 8.2, 12.8, -58.5, depotTrimMat, 'wall'); // West door rear
    addBoxPiece(7.8, roofY + 2.2, -58.5, 8.2, 12.8, -56.0, depotTrimMat, 'wall'); // West door lintel
    addBoxPiece(7.8, roofY, -56.0, 8.2, 12.8, -51.8, depotTrimMat, 'wall'); // West wall south of door
    addBoxPiece(8.0, 12.0, -52.0, 12.0, 12.8, -51.6, depotTrimMat, 'wall'); // South high lintel arch
    addBoxPiece(8.0, roofY, -59.7, 12.0, 12.8, -59.3, depotTrimMat, 'wall'); // North wall
    // Cupola domed roof
    const cupolaDomeGeom = new THREE.ConeGeometry(2.6, 1.4, 8);
    const cupolaDome = this.addMeshWithEdges(depotGroup, cupolaDomeGeom, this.roofMat, darkInkColor, true);
    cupolaDome.position.set(10.0, 13.5, -55.75);
    // Standable cupola roof slab
    addBoxPiece(7.8, 12.6, -59.7, 12.2, 12.8, -51.8, this.roofMat, 'floor');

    // --- 13. SW Industrial Water Tower (x = -8.0, z = -44.0) ---
    const tankR = 1.9;
    const tankLegH = 2.4;
    const tankDeckY = roofY + tankLegH;
    const tankBodyH = 2.8;
    const tankTopY = tankDeckY + tankBodyH;
    for (const dx of [-1.35, 1.35]) {
      for (const dz of [-1.35, 1.35]) {
        const legGeom = new THREE.BoxGeometry(0.22, tankLegH, 0.22);
        const leg = this.addMeshWithEdges(depotGroup, legGeom, this.metalMat, metalInkColor, false);
        leg.position.set(-8.0 + dx, roofY + tankLegH * 0.5, -44.0 + dz);
      }
    }
    const deckGeom = new THREE.BoxGeometry(3.8, 0.25, 3.8);
    const deck = this.addMeshWithEdges(depotGroup, deckGeom, this.woodMat, InkShaderMaterial.defaultInkColor, false);
    deck.position.set(-8.0, tankDeckY + 0.125, -44.0);
    const tankGeom = new THREE.CylinderGeometry(tankR, tankR, tankBodyH, 12);
    const tankMesh = this.addMeshWithEdges(depotGroup, tankGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
    tankMesh.position.set(-8.0, tankDeckY + tankBodyH * 0.5, -44.0);
    const capGeom = new THREE.ConeGeometry(tankR * 1.1, 1.0, 12);
    const capMesh = this.addMeshWithEdges(depotGroup, capGeom, depotTrimMat, darkInkColor, false);
    capMesh.position.set(-8.0, tankTopY + 0.5, -44.0);

    // Water tank solid colliders
    this.twoStoryColliders.push({
      minX: -8.0 - tankR,
      minY: tankDeckY,
      minZ: -44.0 - tankR,
      maxX: -8.0 + tankR,
      maxY: tankTopY,
      maxZ: -44.0 + tankR,
      tag: 'wall'
    });
    this.twoStoryColliders.push({
      minX: -8.0 - 1.9,
      minY: tankDeckY,
      minZ: -44.0 - 1.9,
      maxX: -8.0 + 1.9,
      maxY: tankDeckY + 0.25,
      maxZ: -44.0 + 1.9,
      tag: 'floor'
    });
    this.twoStoryColliders.push({
      minX: -8.0 - tankR,
      minY: tankTopY - 0.2,
      minZ: -44.0 - tankR,
      maxX: -8.0 + tankR,
      maxY: tankTopY,
      maxZ: -44.0 + tankR,
      tag: 'floor'
    });

    // NW Industrial HVAC Ventilation Plant (x = -8.0, z = -56.0, h = 1.4)
    addBoxPiece(-9.5, roofY, -57.5, -6.5, roofY + 1.4, -54.5, this.metalMat, 'wall');
    addBoxPiece(-9.5, roofY + 1.25, -57.5, -6.5, roofY + 1.4, -54.5, this.trimMat, 'floor');

    // Web Grapple Anchors across the Grand Depot
    const depotAnchors: THREE.Vector3[] = [
      new THREE.Vector3(xMin, parapetY, zMax),
      new THREE.Vector3(xMax, parapetY, zMax),
      new THREE.Vector3(xMin, parapetY, zMin),
      new THREE.Vector3(xMax, parapetY, zMin),
      new THREE.Vector3(0.0, roofY + 1.5, -47.5),
      new THREE.Vector3(-8.0, tankTopY + 1.0, -44.0),
      new THREE.Vector3(10.0, 14.5, -57.25)
    ];
    this.webAnchors.push(...depotAnchors);

    parent.add(depotGroup);
  }

  /**
   * Constructs an individual skyscraper with facade cornices and rooftop features
   */
  private buildSingleSkyscraper(parent: THREE.Group, config: SkyscraperConfig): void {
    const bGroup = new THREE.Group();
    bGroup.name = `Skyscraper_${Math.round(config.x)}_${Math.round(config.z)}`;
    bGroup.position.set(config.x, 0, config.z);

    const { width, depth, height, setbackHeight, setbackScale } = config;

    // Per-building pen-ink palette: same doodle vibe, different ink per landmark.
    const facade = config.ink !== undefined
      ? InkShaderMaterial.create({ inkColor: new THREE.Color(config.ink) })
      : this.facadeMat;
    const trim = config.trimInk !== undefined
      ? InkShaderMaterial.create({ inkColor: new THREE.Color(config.trimInk) })
      : this.trimMat;
    if (facade !== this.facadeMat) this.materials.push(facade);
    if (trim !== this.trimMat) this.materials.push(trim);

    const roofY = height;
    let roofW = width;
    let roofD = depth;

    if (setbackHeight && setbackScale && setbackHeight < height) {
      // Tiered Building (Art-Deco setback style)
      // 1. Lower base section
      const baseH = setbackHeight;
      const baseGeom = new THREE.BoxGeometry(width, baseH, depth);
      const baseMesh = this.addMeshWithEdges(bGroup, baseGeom, facade, InkShaderMaterial.defaultInkColor, true);
      baseMesh.position.set(0, baseH * 0.5, 0);

      // Base cornice trim
      const corniceGeom = new THREE.BoxGeometry(width + 0.6, 0.6, depth + 0.6);
      const cornice = this.addMeshWithEdges(bGroup, corniceGeom, trim, InkShaderMaterial.defaultInkColor, false);
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
      const upperMesh = this.addMeshWithEdges(bGroup, upperGeom, facade, InkShaderMaterial.defaultInkColor, true);
      upperMesh.position.set(0, setbackHeight + upperH * 0.5, 0);

      // Terrace props on setback terraces with a walkway worth furnishing
      const terraceWalkwayW = (width - roofW) * 0.5;
      if (terraceWalkwayW >= 6.0) {
        this.buildTerraceHvacProps(bGroup, config, baseH, roofW, roofD);
      }

      // Balconies on upper tier if tall enough
      if (upperH >= 24) {
        this.buildTieredBalconies(bGroup, config, baseH, upperH, roofW, roofD);
      }
    } else {
      if (config.skybridgeDock) {
        // Entry-notch massing: main block + two east-bay cheeks leave a 4m
        // stair hall open to the skybridge. A hand-cut entry, not a flat wall.
        const mainGeom = new THREE.BoxGeometry(width - 4, height, depth);
        const mainMesh = this.addMeshWithEdges(bGroup, mainGeom, facade, InkShaderMaterial.defaultInkColor, true);
        mainMesh.position.set(-2, height * 0.5, 0);

        const cheekD = depth * 0.5 - 2;
        const cheekGeom = new THREE.BoxGeometry(4, height, cheekD);
        const cheekN = this.addMeshWithEdges(bGroup, cheekGeom, facade, InkShaderMaterial.defaultInkColor, true);
        cheekN.position.set(width * 0.5 - 2, height * 0.5, 2 + cheekD * 0.5);
        const cheekS = this.addMeshWithEdges(bGroup, cheekGeom, facade, InkShaderMaterial.defaultInkColor, true);
        cheekS.position.set(width * 0.5 - 2, height * 0.5, -2 - cheekD * 0.5);

        // Entry portal: ink posts + lintel gate over the stair-hall mouth
        const postGeom = new THREE.BoxGeometry(0.35, 3.0, 0.35);
        for (const s of [-1, 1]) {
          const post = this.addMeshWithEdges(bGroup, postGeom, trim, InkShaderMaterial.defaultInkColor, false);
          post.position.set(width * 0.5, 15.4 + 1.5, s * 2.3);
        }
        const lintelGeom = new THREE.BoxGeometry(0.4, 0.5, 5.4);
        const lintel = this.addMeshWithEdges(bGroup, lintelGeom, trim, InkShaderMaterial.defaultInkColor, false);
        lintel.position.set(width * 0.5, 18.5, 0);
      } else {
        // Standard monolithic skyscraper
        const bGeom = new THREE.BoxGeometry(width, height, depth);
        const bMesh = this.addMeshWithEdges(bGroup, bGeom, facade, InkShaderMaterial.defaultInkColor, true);
        bMesh.position.set(0, height * 0.5, 0);
      }

      // Architectural facade window band insets
      const numBands = Math.floor(height / 12);
      for (let b = 1; b < numBands; b++) {
        const bandY = b * 12;
        const bandGeom = new THREE.BoxGeometry(width + 0.3, 0.8, depth + 0.3);
        const band = this.addMeshWithEdges(bGroup, bandGeom, trim, InkShaderMaterial.defaultInkColor, false);
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

        // Add 2 HVAC boxes for chest cover + step platforms on terrace roofs
        this.buildTerraceHvacProps(bGroup, config, height, 14, 14);
      }
    }

    // Mid-face latch pairs on the site-facing facade (swing-route coverage).
    // Short houses get juliet rails instead (see below).
    if (height >= 25) {
      const face = this.faceTowardCenter(config);
      for (const fy of [0.35, 0.6]) {
        const y = Math.round(height * fy);
        const lx = config.x + face.nx * (width * 0.5);
        const lz = config.z + face.nz * (depth * 0.5);
        this.webAnchors.push(new THREE.Vector3(lx, y, lz));
      }
    }

    // Juliet rails: decorative rail + latches for short houses, no standing shells
    if (config.julietRows) {
      this.buildJulietBalconies(bGroup, config, config.julietRows);
    }

    // Rooftop perimeter parapet wall: half a character tall, so you shoot over it
    // standing and are fully covered by it crouched.
    const parapetHeight = COVER_RAIL_HEIGHT;
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

    // Rooftop access penthouse / bulkhead (skipped when a fly tower owns the roof)
    if (!config.flyTower) {
      const phGeom = new THREE.BoxGeometry(4.5, 3.0, 3.5);
      const ph = this.addMeshWithEdges(bGroup, phGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
      ph.position.set(-halfRW * 0.4, roofY + 1.5, -halfRD * 0.4);
    }

    // Curated web anchors at the 4 roof parapet corners
    this.webAnchors.push(
      new THREE.Vector3(config.x - halfRW, roofY + parapetHeight, config.z - halfRD),
      new THREE.Vector3(config.x + halfRW, roofY + parapetHeight, config.z - halfRD),
      new THREE.Vector3(config.x - halfRW, roofY + parapetHeight, config.z + halfRD),
      new THREE.Vector3(config.x + halfRW, roofY + parapetHeight, config.z + halfRD)
    );

    // Parapet coping: pale stone cap line on every roof edge (no edge lines,
    // the ink hatching carries small dressing to protect draw calls)
    const copeT = 0.12;
    const copeW = parapetThick + 0.24;
    const copeY = roofY + parapetHeight + copeT * 0.5;
    const copeNSGeom = new THREE.BoxGeometry(roofW, copeT, copeW);
    for (const s of [-1, 1]) {
      const cope = new THREE.Mesh(copeNSGeom, this.roofMat);
      cope.position.set(0, copeY, s * (halfRD - parapetThick * 0.5));
      cope.raycast = () => {};
      bGroup.add(cope);
    }
    const copeEWGeom = new THREE.BoxGeometry(copeW, copeT, Math.max(0.1, roofD - parapetThick * 2));
    for (const s of [-1, 1]) {
      const cope = new THREE.Mesh(copeEWGeom, this.roofMat);
      cope.position.set(s * (halfRW - parapetThick * 0.5), copeY, 0);
      cope.raycast = () => {};
      bGroup.add(cope);
    }

    // Rooftop Features (skipped for custom manual roofs)
    // 1. Classic NYC Wooden Water Tower on 4-legged trestle
    if (config.hasWaterTower && !config.manualRoof) {
      this.buildWaterTower(bGroup, halfRW * 0.35, roofY, halfRD * 0.35, config.x, config.z);
    }

    // 2. Industrial Rooftop HVAC Box Chillers
    if (config.hasHvac && !config.manualRoof) {
      this.buildHvacChiller(bGroup, halfRW * 0.2, roofY, -halfRD * 0.3, config.x, config.z);
      if (roofW > 22) {
        this.buildHvacChiller(bGroup, -halfRW * 0.3, roofY, halfRD * 0.2, config.x, config.z);
      }
    }

    // 3. Radio / Telecommunication Antenna Spire
    if (config.hasAntenna) {
      this.buildAntennaSpire(bGroup, 0, roofY, 0, config.x, config.z);
    }

    // 4. Skybridge dock railings + steps (dock building only)
    if (config.skybridgeDock) {
      this.buildTerracePerimeterRailing(bGroup, roofW, roofD, roofY);
    }

    // 5. Balconies on tall monolithic faces (landing pads with rails + latches)
    const tiered = setbackHeight !== undefined && setbackScale !== undefined && setbackHeight < height;
    if (!tiered && height >= 42) {
      this.buildBalconies(bGroup, config);
    }

    // 6. District extras: perch ledges, pergola, smokestack, custom industrial roof
    if (config.perchLedges) {
      this.buildPerchLedges(bGroup, config);
    }
    if (config.pergola) {
      this.buildPergola(bGroup, config, roofY, roofW, roofD);
    }
    if (config.smokestack) {
      this.buildSmokestack(bGroup, config);
    }
    if (config.manualRoof) {
      this.buildWaterworksRoof(bGroup, config);
    }
    if (config.marquee || config.flyTower) {
      this.buildTheaterFront(bGroup, config, facade, trim);
    }

    // Per-style facade dressing: fins, windows, piers, cladding (visual only)    this.dressFacade(bGroup, config, trim);

    parent.add(bGroup);
  }

  /**
   * Facade dressing per style — the detail pass that makes each landmark read
   * differently at a glance. All dressing is non-collidable and edge-lineless
   * (ink hatching carries it) to protect draw calls; proud boxes still catch
   * bullets and webs as cover.
   */
  private dressFacade(parent: THREE.Group, config: SkyscraperConfig, trim: THREE.Material): void {
    const { width, depth, height } = config;
    const hw = width * 0.5;
    const hd = depth * 0.5;
    const flat = (geom: THREE.BufferGeometry, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(geom, trim);
      m.position.set(x, y, z);
      m.raycast = () => {};
      parent.add(m);
    };

    if (config.style === 'modern') {
      // Glass tower: vertical mullion fins on all faces
      for (let x = -hw + 1.5; x <= hw - 1.5; x += 3) {
        for (const s of [-1, 1]) {
          flat(new THREE.BoxGeometry(0.18, height, 0.3), x, height * 0.5, s * (hd + 0.1));
        }
      }
      for (let z = -hd + 1.5; z <= hd - 1.5; z += 3) {
        for (const s of [-1, 1]) {
          flat(new THREE.BoxGeometry(0.3, height, 0.18), s * (hw + 0.1), height * 0.5, z);
        }
      }
    } else if (config.style === 'terrace' && height <= 20) {
      // Brick house: punched windows with sills + lintels on N/S faces
      const rows: number[] = [];
      for (let y = 4.5; y < height - 2; y += 4) rows.push(y);
      const cols: number[] = [];
      for (let x = -hw + 3; x <= hw - 3; x += 4.5) cols.push(x);
      for (const y of rows) {
        for (const s of [-1, 1]) {
          const sill = new THREE.BoxGeometry(width - 2, 0.14, 0.16);
          flat(sill, 0, y - 1.05, s * (hd + 0.05));
          const lintel = new THREE.BoxGeometry(width - 2, 0.18, 0.16);
          flat(lintel, 0, y + 1.05, s * (hd + 0.05));
        }
        for (const x of cols) {
          for (const s of [-1, 1]) {
            flat(new THREE.BoxGeometry(1.5, 1.9, 0.12), x, y, s * (hd + 0.05));
          }
        }
      }
    } else if (config.style === 'artdeco') {
      // Deco piers up the base tier + stepped ziggurat crown cap with peak latch
      const baseH = config.setbackHeight ?? height;
      for (let x = -hw + 2; x <= hw - 2; x += 4) {
        for (const s of [-1, 1]) {
          flat(new THREE.BoxGeometry(0.5, baseH, 0.4), x, baseH * 0.5, s * (hd + 0.15));
        }
      }
      let capW = width * (config.setbackScale ?? 1) * 0.6;
      let capY = height;
      for (let s = 0; s < 3; s++) {
        flat(new THREE.BoxGeometry(capW, 0.9, capW * (depth / width)), 0, capY + 0.45, 0);
        capY += 0.9;
        capW *= 0.72;
      }
      this.webAnchors.push(new THREE.Vector3(config.x, capY + 0.6, config.z));
    } else if (config.style === 'industrial') {
      // Corrugated cladding bands + loading door + vents
      for (let y = 2; y < height; y += 2) {
        flat(new THREE.BoxGeometry(width + 0.3, 0.22, depth + 0.3), 0, y, 0);
      }
      const door = new THREE.BoxGeometry(4.5, 5.0, 0.2);
      flat(door, 0, 2.5, hd + 0.08);
      const doorFrame = new THREE.BoxGeometry(5.1, 0.3, 0.24);
      flat(doorFrame, 0, 5.1, hd + 0.08);
      for (const s of [-1, 1]) {
        flat(new THREE.BoxGeometry(1.6, 1.0, 0.14), s * 6, 8.5, hd + 0.06);
      }
    }

    // Verdigris mansard cap + dormers (copper annex): stepped slabs shrinking
    // to a peak latch, dormer boxes winking out of the slope faces.
    if (config.mansard) {
      const tieredCap = config.setbackHeight !== undefined && config.setbackScale !== undefined;
      const capBase = tieredCap ? width * (config.setbackScale as number) : width;
      let capW = capBase * 0.9;
      let capY = height;
      for (let s = 0; s < 3; s++) {
        flat(new THREE.BoxGeometry(capW, 1.1, capW * (depth / width)), 0, capY + 0.55, 0);
        if (s === 0) {
          for (const dx of [-capW * 0.25, capW * 0.25]) {
            for (const dz of [-1, 1]) {
              flat(new THREE.BoxGeometry(1.4, 1.3, 0.7), dx, capY + 0.9, dz * (capW * (depth / width) * 0.5));
            }
          }
        }
        capY += 1.1;
        capW *= 0.74;
      }
      this.webAnchors.push(new THREE.Vector3(config.x, capY + 0.6, config.z));
    }
  }

  /**
   * Noir theater front: projecting marquee canopy with warm bulb row, tie rods,
   * vertical blade sign with accent stripes, and the rear fly tower. The canopy
   * floats above head height — walk under it, swing off the blade.
   */
  private buildTheaterFront(
    parent: THREE.Group,
    config: SkyscraperConfig,
    facade: THREE.Material,
    trim: THREE.Material
  ): void {
    const hw = config.width * 0.5;

    // Fly tower: tall stage-house block at the rear, capped + louvered
    const flyGeom = new THREE.BoxGeometry(8, 28, 8);
    const fly = this.addMeshWithEdges(parent, flyGeom, facade, InkShaderMaterial.defaultInkColor, true);
    fly.position.set(-6, 14, 0);
    const flyCapGeom = new THREE.BoxGeometry(9, 0.8, 9);
    const flyCap = this.addMeshWithEdges(parent, flyCapGeom, trim, InkShaderMaterial.defaultInkColor, false);
    flyCap.position.set(-6, 28.4, 0);
    const flyLouverGeom = new THREE.BoxGeometry(3.0, 2.0, 0.16);
    const flyLouver = this.addMeshWithEdges(parent, flyLouverGeom, trim, InkShaderMaterial.defaultInkColor, false);
    flyLouver.position.set(-6, 24, 4.05);
    const flyCx = config.x - 6;
    this.webAnchors.push(new THREE.Vector3(flyCx, 29.4, config.z));
    this.towerSpecs.push({ cx: flyCx, cz: config.z, hw: 4, hd: 4, h: 28 });

    // A pair of chillers kept clear of the fly tower
    this.buildHvacChiller(parent, 8, config.height, -4, config.x, config.z);
    this.buildHvacChiller(parent, 8, config.height, 4, config.x, config.z);

    // Marquee canopy projecting toward the site + fascia + warm bulbs
    const canopyGeom = new THREE.BoxGeometry(3.2, 0.5, 10);
    const canopy = this.addMeshWithEdges(parent, canopyGeom, trim, InkShaderMaterial.defaultInkColor, false);
    canopy.position.set(hw + 1.6, 5.0, 0);
    const fasciaGeom = new THREE.BoxGeometry(0.24, 1.0, 10);
    const fascia = this.addMeshWithEdges(parent, fasciaGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
    fascia.position.set(hw + 3.1, 4.6, 0);
    if (!this.lampGlowMat) {
      this.lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xe8a33d, toneMapped: false });
    }
    const bulbGeom = new THREE.SphereGeometry(0.09, 6, 6);
    for (let b = -4; b <= 4; b++) {
      const bulb = new THREE.Mesh(bulbGeom, this.lampGlowMat);
      bulb.position.set(hw + 3.1, 4.0, b * 1.1);
      bulb.raycast = () => {};
      parent.add(bulb);
    }
    // Tie rods from facade to canopy lip
    const rodGeom = new THREE.CylinderGeometry(0.035, 0.035, 3.4, 6);
    for (const s of [-1, 1]) {
      const rod = this.addMeshWithEdges(parent, rodGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      rod.position.set(hw + 1.6, 6.6, s * 4.2);
      rod.rotation.z = 1.05;
    }

    // Vertical blade sign at the corner + accent stripes
    const bladeGeom = new THREE.BoxGeometry(0.5, 12, 2.0);
    const blade = this.addMeshWithEdges(parent, bladeGeom, trim, InkShaderMaterial.defaultInkColor, false);
    blade.position.set(hw + 0.6, 10, 7);
    for (const sy of [7, 10, 13]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.5, 2.06), this.accentMat);
      stripe.position.set(hw + 0.6, sy, 7);
      stripe.raycast = () => {};
      parent.add(stripe);
    }
    this.webAnchors.push(new THREE.Vector3(config.x + hw + 0.6, 16.6, config.z + 7));
    this.webAnchors.push(new THREE.Vector3(config.x + hw + 3.1, 5.6, config.z - 4));
    this.webAnchors.push(new THREE.Vector3(config.x + hw + 3.1, 5.6, config.z + 4));
  }

  /** Dominant-axis unit vector from a building toward the map center. */
  private faceTowardCenter(config: SkyscraperConfig): { nx: number; nz: number } {
    if (Math.abs(config.x) >= Math.abs(config.z)) {
      return { nx: config.x > 0 ? -1 : 1, nz: 0 };
    }
    return { nx: 0, nz: config.z > 0 ? -1 : 1 };
  }

  /**
   * Balcony modules on the face toward the city center, every 18m up to 3 per tower.
   * Each balcony: standable slab, 3-sided railing, corner latch anchors with glints,
   * and collision shells (floor to stand, outer rail to lean on).
   */
  private buildBalconies(parent: THREE.Group, config: SkyscraperConfig): void {
    // Face toward the map center on the dominant axis
    const { nx, nz } = this.faceTowardCenter(config);

    const hw = config.width / 2;
    const hd = config.depth / 2;
    const alongW = 5.0;   // platform width along the face
    const outD = 2.2;     // platform depth outward
    const railH = COVER_RAIL_HEIGHT;
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

    // Collision spec: walkable deck ring + solid barrel + standable cap
    this.tankSpecs.push({
      cx: worldX + localX,
      cy: roofY,
      cz: worldZ + localZ,
      r: tankRadius,
      deckTop: roofY + standHeight + 0.25,
      bodyTop: roofY + standHeight + 0.25 + tankHeight,
    });
  }

  /**
   * Builds an industrial rooftop HVAC box chiller unit
   */
  private buildHvacChiller(parent: THREE.Group, localX: number, roofY: number, localZ: number, worldX: number, worldZ: number): void {
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

    // Collision spec: solid cabinet block + standable top
    this.roofHvacSpecs.push({
      cx: worldX + localX,
      cy: roofY,
      cz: worldZ + localZ,
      w: cabWidth,
      h: cabHeight,
      d: cabDepth,
    });
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
    // Decorative handrail cap that sits exactly on the solid parapet's lip.
    const railHeight = COVER_RAIL_HEIGHT;
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

    // Dock stair hall (human scale): 5 walkable 0.5m rises from the bridge
    // deck (15.4) to the terrace (18.0) inside the entry notch. Local coords:
    // step k center localX = 12.6 - 0.8k (world -41.4 - 0.8k), top = 15.9 + 0.5k.
    const stepMat = this.roofMat;
    for (let k = 0; k < 5; k++) {
      const top = 15.9 + k * 0.5;
      const localXc = 12.6 - k * 0.8;
      const stepGeom = new THREE.BoxGeometry(0.8, 0.5, 3.6);
      const step = this.addMeshWithEdges(parent, stepGeom, stepMat, InkShaderMaterial.defaultInkColor, true);
      step.position.set(localXc, top - 0.25, 0);
    }

    // Landable trim on the front edge of each step
    const stepTrimGeom = new THREE.BoxGeometry(0.15, 0.04, 3.6);
    for (let k = 0; k < 5; k++) {
      const top = 15.9 + k * 0.5;
      const st = new THREE.Mesh(stepTrimGeom, this.landableTrimMat);
      st.position.set(12.6 - k * 0.8 + 0.325, top + 0.02, 0);
      st.raycast = () => {};
      parent.add(st);
    }

    // Side handrails along the dock steps (North and South at z = ±1.8)
    const stepRailGeom = new THREE.BoxGeometry(4.8, 0.08, 0.08);
    for (const sz of [-1.8, 1.8]) {
      const sr = this.addMeshWithEdges(parent, stepRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      sr.rotation.z = -Math.atan2(2.4, 4.0); // angle ascending from 15.4 to 18.0
      sr.position.set(11.0, 17.7, sz);
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
    const { nx, nz } = this.faceTowardCenter(config);

    const hw = roofW * 0.5;
    const hd = roofD * 0.5;
    const alongW = 4.6;
    const outD = 2.0;
    const railH = COVER_RAIL_HEIGHT;
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
   * Shared perch-unit builder: standable slab, trim, 3-sided rails, corner
   * anchors + glints, and a collision-shell spec. Slab top lands on floorY.
   */
  private addPerchUnit(
    parent: THREE.Group,
    config: SkyscraperConfig,
    cx: number,
    cz: number,
    floorY: number,
    alongW: number,
    outD: number,
    nx: number,
    nz: number
  ): void {
    const railH = COVER_RAIL_HEIGHT;
    const railT = 0.12;
    const sillY = floorY - 0.15;

    const slabGeom = new THREE.BoxGeometry(nx !== 0 ? outD : alongW, 0.3, nx !== 0 ? alongW : outD);
    const slab = this.addMeshWithEdges(parent, slabGeom, this.roofMat, InkShaderMaterial.defaultInkColor, true);
    slab.position.set(cx, sillY, cz);

    const trimT = 0.04;
    const trimW = 0.18;
    const trimGeom = new THREE.BoxGeometry(nx !== 0 ? trimW : alongW, trimT, nx !== 0 ? alongW : trimW);
    const bTrim = new THREE.Mesh(trimGeom, this.landableTrimMat);
    const trimOffset = outD * 0.5 - trimW * 0.5;
    bTrim.position.set(cx + nx * trimOffset, sillY + 0.15 + trimT * 0.5, cz + nz * trimOffset);
    bTrim.raycast = () => {};
    parent.add(bTrim);

    const outerGeom = new THREE.BoxGeometry(nx !== 0 ? railT : alongW, railH, nx !== 0 ? alongW : railT);
    const outer = this.addMeshWithEdges(parent, outerGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    outer.position.set(cx + nx * (outD * 0.5 - railT * 0.5), floorY + railH * 0.5, cz + nz * (outD * 0.5 - railT * 0.5));

    const sideLen = outD - railT;
    const sideGeom = new THREE.BoxGeometry(nx !== 0 ? sideLen : railT, railH, nx !== 0 ? railT : sideLen);
    const tx = -nz;
    const tz = nx;
    for (const s of [-1, 1]) {
      const side = this.addMeshWithEdges(parent, sideGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      side.position.set(
        cx + tx * s * (alongW * 0.5 - railT * 0.5),
        floorY + railH * 0.5,
        cz + tz * s * (alongW * 0.5 - railT * 0.5)
      );
    }

    for (const s of [-1, 1]) {
      const lx = config.x + cx + tx * s * (alongW * 0.5) + nx * (outD * 0.5);
      const lz = config.z + cz + tz * s * (alongW * 0.5) + nz * (outD * 0.5);
      this.webAnchors.push(new THREE.Vector3(lx, floorY + 1.3, lz));
    }

    this.balconySpecs.push({
      cx: config.x + cx,
      cy: floorY,
      cz: config.z + cz,
      hw: nx !== 0 ? outD * 0.5 : alongW * 0.5,
      hd: nx !== 0 ? alongW * 0.5 : outD * 0.5,
      nx,
      nz,
    });
  }

  /**
   * Juliet rails for short houses: a rail + sill + latches on the facade.
   * Decorative only (no standing shells) — swing past, don't land.
   */
  private buildJulietBalconies(parent: THREE.Group, config: SkyscraperConfig, rows: number): void {
    const { nx, nz } = this.faceTowardCenter(config);
    const hw = config.width * 0.5;
    const hd = config.depth * 0.5;
    const faceLen = nx !== 0 ? config.depth : config.width;
    const spread = Math.min(8, faceLen * 0.5 - 2);

    for (let r = 1; r <= rows; r++) {
      const y = Math.round((config.height * r) / (rows + 1));
      for (const off of [-spread, 0, spread]) {
        // The dock's stair-hall notch stays clear: no rails across the entry
        if (config.skybridgeDock && nx !== 0 && Math.abs(off) < 3) continue;
        const bx = nx * (hw + 0.05) + (nx !== 0 ? 0 : off);
        const bz = nz * (hd + 0.05) + (nz !== 0 ? 0 : off);
        const railGeom = new THREE.BoxGeometry(nx !== 0 ? 0.1 : 2.2, COVER_RAIL_HEIGHT, nx !== 0 ? 2.2 : 0.1);
        const rail = this.addMeshWithEdges(parent, railGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
        rail.position.set(bx, y + COVER_RAIL_HEIGHT * 0.5, bz);
        const sillGeom = new THREE.BoxGeometry(nx !== 0 ? 0.5 : 2.4, 0.12, nx !== 0 ? 2.4 : 0.5);
        const sill = this.addMeshWithEdges(parent, sillGeom, this.roofMat, InkShaderMaterial.defaultInkColor, false);
        sill.position.set(bx, y, bz);
        const tx = -nz;
        const tz = nx;
        for (const s of [-1, 1]) {
          const lx = config.x + bx + tx * s * 1.1;
          const lz = config.z + bz + tz * s * 1.1;
          this.webAnchors.push(new THREE.Vector3(lx, y + 1.25, lz));
        }
      }
    }
  }

  /**
   * Perch ledges on ALL faces every 8m: zip up the tower face, sit on a ledge.
   * Small (3m x 1.4m) railed perches with latches — the Ledge Tower's personality.
   */
  private buildPerchLedges(parent: THREE.Group, config: SkyscraperConfig): void {
    const hw = config.width * 0.5;
    const hd = config.depth * 0.5;
    const faces = [
      { nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 },
    ];
    for (const f of faces) {
      for (let y = 10; y < config.height - 6; y += 8) {
        const cx = f.nx * (hw + 0.7);
        const cz = f.nz * (hd + 0.7);
        this.addPerchUnit(parent, config, cx, cz, y, 3.0, 1.4, f.nx, f.nz);
      }
    }
  }

  /**
   * Rooftop pergola: timber posts + beams over the terrace. Shade doodle,
   * beam-end latches, no collision (posts are thin).
   */
  private buildPergola(parent: THREE.Group, config: SkyscraperConfig, roofY: number, roofW: number, roofD: number): void {
    const postH = 2.6;
    const px = Math.min(3, roofW * 0.5 - 1.5);
    const pz = Math.min(2, roofD * 0.5 - 1.5);
    const postGeom = new THREE.BoxGeometry(0.16, postH, 0.16);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = this.addMeshWithEdges(parent, postGeom, this.woodMat, InkShaderMaterial.defaultInkColor, false);
        post.position.set(sx * px, roofY + postH * 0.5, sz * pz);
      }
    }
    const beamGeom = new THREE.BoxGeometry(px * 2 + 0.8, 0.12, 0.18);
    for (let b = -2; b <= 2; b++) {
      const beam = this.addMeshWithEdges(parent, beamGeom, this.woodMat, InkShaderMaterial.defaultInkColor, false);
      beam.position.set(0, roofY + postH, (b / 2) * pz);
    }
    for (const s of [-1, 1]) {
      const lx = config.x + s * (px + 0.4);
      this.webAnchors.push(new THREE.Vector3(lx, roofY + postH + 0.2, config.z));
    }
  }

  /**
   * Tall brick smokestack: industrial landmark + high-altitude anchor coverage.
   */
  private buildSmokestack(parent: THREE.Group, config: SkyscraperConfig): void {
    const localX = -9;
    const localZ = -6;
    const roofY = config.height;
    const stackH = 38.0;
    const rBase = 2.4;

    const stackGeom = new THREE.CylinderGeometry(1.7, rBase, stackH, 12);
    const stack = this.addMeshWithEdges(parent, stackGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, true);
    stack.position.set(localX, roofY + stackH * 0.5, localZ);

    for (const bandY of [10, 22, 33]) {
      const bandGeom = new THREE.CylinderGeometry(rBase - (bandY / stackH) * 0.7 + 0.06, rBase - (bandY / stackH) * 0.7 + 0.06, 0.5, 12, 1, true);
      const band = this.addMeshWithEdges(parent, bandGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      band.position.set(localX, roofY + bandY, localZ);
    }

    const rimGeom = new THREE.CylinderGeometry(1.85, 1.85, 0.6, 12);
    const rim = this.addMeshWithEdges(parent, rimGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    rim.position.set(localX, roofY + stackH + 0.3, localZ);

    const cx = config.x + localX;
    const cz = config.z + localZ;
    this.webAnchors.push(new THREE.Vector3(cx, roofY + stackH + 1.0, cz));
    this.webAnchors.push(new THREE.Vector3(cx, roofY + 22.0, cz));

    this.stackSpecs.push({ cx, cz, baseY: roofY, topY: roofY + stackH, r: rBase });
  }

  /**
   * Waterworks custom roof: twin tanks + chiller farm (manual roof, no defaults).
   */
  private buildWaterworksRoof(parent: THREE.Group, config: SkyscraperConfig): void {
    const roofY = config.height;
    this.buildWaterTower(parent, 7, roofY, 3, config.x, config.z);
    this.buildWaterTower(parent, -5, roofY, -3, config.x, config.z);
    this.buildHvacChiller(parent, 3, roofY, -5, config.x, config.z);
    this.buildHvacChiller(parent, -11, roofY, 2, config.x, config.z);
    this.buildHvacChiller(parent, 11, roofY, -2, config.x, config.z);
  }

  /**
   * Ink lamp posts ringing the district + avenue outposts: pole, arm, warm
   * lamp, top + arm-end latches. Small wall shells so you can't walk through.
   */
  private buildLampPosts(): void {
    const lampsGroup = new THREE.Group();
    lampsGroup.name = 'LampPosts';
    const positions: Array<[number, number]> = [
      [28, 28], [-28, 28], [28, -28], [-28, -28],
      [64, 0], [-64, 0], [0, 24], [0, -30],
      [100, 0], [-100, 0], [0, 100], [0, -100],
      [100, 100], [-100, 100], [100, -100], [-100, -100],
    ];
    for (const [lx, lz] of positions) {
      const poleGeom = new THREE.CylinderGeometry(0.1, 0.14, 7.0, 8);
      const pole = this.addMeshWithEdges(lampsGroup, poleGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      pole.position.set(lx, 0.5 + 3.5, lz);

      const armGeom = new THREE.BoxGeometry(1.4, 0.1, 0.1);
      const arm = this.addMeshWithEdges(lampsGroup, armGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      arm.position.set(lx + 0.6, 7.3, lz);

      const headGeom = new THREE.BoxGeometry(0.34, 0.22, 0.22);
      const head = this.addMeshWithEdges(lampsGroup, headGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      head.position.set(lx + 1.25, 7.2, lz);

      if (!this.lampGlowMat) {
        this.lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xe8a33d, toneMapped: false });
      }
      const bulbGeom = new THREE.SphereGeometry(0.11, 6, 6);
      const bulb = new THREE.Mesh(bulbGeom, this.lampGlowMat);
      bulb.position.set(lx + 1.25, 7.05, lz);
      bulb.raycast = () => {};
      lampsGroup.add(bulb);

      this.webAnchors.push(new THREE.Vector3(lx, 7.7, lz));
      this.webAnchors.push(new THREE.Vector3(lx + 1.25, 7.35, lz));
      this.streetPropSpecs.push({ x: lx, z: lz, r: 0.3, h: 7.0 });
    }
    this.group.add(lampsGroup);
  }

  /**
   * Street micro-doodles: red fire hydrants + trash cans near lamps and corners.
   * Tiny wall shells, zero anchors — set dressing with collision.
   */
  private buildStreetProps(): void {
    const propsGroup = new THREE.Group();
    propsGroup.name = 'StreetProps';

    const hydrants: Array<[number, number]> = [
      [14, 14], [-14, 14], [14, -14], [-14, -14],
      [30, 8], [-30, -8], [8, 30], [-8, -30], [40, -20], [-40, 20],
    ];
    for (const [hx, hz] of hydrants) {
      const baseGeom = new THREE.CylinderGeometry(0.22, 0.24, 0.12, 8);
      const base = this.addMeshWithEdges(propsGroup, baseGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
      base.position.set(hx, 0.56, hz);
      const bodyGeom = new THREE.CylinderGeometry(0.16, 0.18, 0.55, 8);
      const body = this.addMeshWithEdges(propsGroup, bodyGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, true);
      body.position.set(hx, 0.9, hz);
      const domeGeom = new THREE.SphereGeometry(0.16, 8, 6);
      const dome = this.addMeshWithEdges(propsGroup, domeGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
      dome.position.set(hx, 1.18, hz);
      const nozzleGeom = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 6);
      for (const s of [-1, 1]) {
        const nozzle = this.addMeshWithEdges(propsGroup, nozzleGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
        nozzle.rotation.z = Math.PI * 0.5;
        nozzle.position.set(hx + s * 0.2, 0.95, hz);
      }
      this.streetPropSpecs.push({ x: hx, z: hz, r: 0.28, h: 0.9 });
    }

    const cans: Array<[number, number]> = [
      [29.2, 29.2], [-26.8, 29.2], [29.2, -26.8], [-26.8, -26.8],
      [65.2, 1.2], [-62.8, 1.2], [1.2, 25.2], [1.2, -28.8],
    ];
    for (const [cx, cz] of cans) {
      const canGeom = new THREE.CylinderGeometry(0.3, 0.27, 0.8, 10);
      const can = this.addMeshWithEdges(propsGroup, canGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      can.position.set(cx, 0.9, cz);
      const lidGeom = new THREE.CylinderGeometry(0.33, 0.33, 0.08, 10);
      const lid = this.addMeshWithEdges(propsGroup, lidGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      lid.position.set(cx, 1.34, cz);
      this.streetPropSpecs.push({ x: cx, z: cz, r: 0.35, h: 1.0 });
    }
    this.group.add(propsGroup);
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

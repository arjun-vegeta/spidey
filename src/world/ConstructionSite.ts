import * as THREE from 'three';
import { InkShaderMaterial } from '../shaders/InkShaderMaterial';
import { LANDABLE_TRIM } from './LandableTrim';

/**
 * Procedural Construction Site representing the iconic unfinished multi-story high-rise.
 * Features:
 * - 5 open concrete floor slabs with square column grid
 * - Cantilevered diagonal staircases connecting levels with solid balustrades
 * - Catwalk / sky bridge spanning across to an adjacent building
 * - Giant construction crane on the roof with mast, jib, trolley, counterweight, and hanging orange hook / girder
 * - Construction props: Jersey barriers, brick pallets, wooden crates, perimeter guardrails, scaffolding
 * - All geometry styled with hand-drawn InkShaderMaterial and crisp ballpoint blue edge lines
 */
export class ConstructionSite {
  public group: THREE.Group;
  private collidableMeshes: THREE.Mesh[] = [];
  private grapplePoints: THREE.Vector3[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private steppingStoneBounds: Array<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }> = [];

  // Animated elements
  private craneHookGroup: THREE.Group | null = null;
  private elapsed: number = 0;

  // Shared ink materials
  private concreteMat: THREE.ShaderMaterial;
  private craneMat: THREE.ShaderMaterial;
  private woodMat: THREE.ShaderMaterial;
  private metalMat: THREE.ShaderMaterial;
  private accentMat: THREE.ShaderMaterial;
  private landableTrimMat: THREE.ShaderMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'ConstructionSite';

    // Initialize shared materials
    this.concreteMat = InkShaderMaterial.create();
    this.craneMat = InkShaderMaterial.create({ isCrane: true });
    this.woodMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x1a2a6c) });
    this.metalMat = InkShaderMaterial.create({ inkColor: new THREE.Color(0x0f1c3f) });
    this.accentMat = InkShaderMaterial.create({ isAccent: true });
    this.landableTrimMat = InkShaderMaterial.create({ inkColor: LANDABLE_TRIM });

    this.materials.push(
      this.concreteMat,
      this.craneMat,
      this.woodMat,
      this.metalMat,
      this.accentMat,
      this.landableTrimMat
    );

    this.buildStructure();
    this.buildStaircases();
    this.buildSkyBridge();
    this.buildScaffolding();
    this.buildRoofCrane();
    this.buildProps();
    this.buildSteppingStones();
  }

  /**
   * Helper to create a mesh with edge lines attached as children
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
    // Prevent raycasting against line segments
    edges.raycast = () => {};
    mesh.add(edges);

    parent.add(mesh);

    if (isCollidable) {
      this.collidableMeshes.push(mesh);
    }

    return mesh;
  }

  /**
   * Builds the 5-level open concrete structure with columns
   */
  private buildStructure(): void {
    const buildingWidth = 26.0; // X axis
    const buildingDepth = 22.0; // Z axis
    const floorHeight = 5.0;
    const slabThickness = 0.5;
    const numFloors = 5; // 0 to 4 (L0, L1, L2, L3, Roof)

    // Floor slabs
    for (let floor = 0; floor < numFloors; floor++) {
      const slabY = floor * floorHeight + slabThickness * 0.5;

      if (floor === 0) {
        // Ground foundation slab (solid)
        const groundSlabGeom = new THREE.BoxGeometry(buildingWidth, slabThickness, buildingDepth);
        const slab = this.addMeshWithEdges(this.group, groundSlabGeom, this.concreteMat);
        slab.position.set(0, slabY, 0);
      } else {
        // Upper floors have stairwell cutouts on east side (x: 6 to 12, z: -3 to 6)
        // Sub-slab 1: West side main area (x: -13 to 6) -> width 19, depth 22
        const westWidth = 19.0;
        const westSlabGeom = new THREE.BoxGeometry(westWidth, slabThickness, buildingDepth);
        const westSlab = this.addMeshWithEdges(this.group, westSlabGeom, this.concreteMat);
        westSlab.position.set(-buildingWidth * 0.5 + westWidth * 0.5, slabY, 0);

        // Sub-slab 2: East North section (x: 6 to 13, z: 6 to 11) -> width 7, depth 5
        const eastNorthGeom = new THREE.BoxGeometry(7.0, slabThickness, 5.0);
        const eastNorthSlab = this.addMeshWithEdges(this.group, eastNorthGeom, this.concreteMat);
        eastNorthSlab.position.set(9.5, slabY, 8.5);

        // Sub-slab 3: East South section (x: 6 to 13, z: -11 to -4) -> width 7, depth 7
        const eastSouthGeom = new THREE.BoxGeometry(7.0, slabThickness, 7.0);
        const eastSouthSlab = this.addMeshWithEdges(this.group, eastSouthGeom, this.concreteMat);
        eastSouthSlab.position.set(9.5, slabY, -7.5);
      }

      const halfW = buildingWidth * 0.5;
      const halfD = buildingDepth * 0.5;

      // Landable edge trim strips along outer slab perimeter edges
      const trimH = 0.08;
      const trimT = 0.12;
      const trimY = slabY + slabThickness * 0.5 + trimH * 0.5;

      // North edge (z = halfD)
      const nTrimGeom = new THREE.BoxGeometry(buildingWidth, trimH, trimT);
      const nTrim = this.addMeshWithEdges(this.group, nTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      nTrim.position.set(0, trimY, halfD - trimT * 0.5);

      // South edge (z = -halfD)
      const sTrim = this.addMeshWithEdges(this.group, nTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      sTrim.position.set(0, trimY, -halfD + trimT * 0.5);

      // West edge (x = -halfW)
      const ewTrimGeom = new THREE.BoxGeometry(trimT, trimH, buildingDepth - trimT * 2);
      const wTrim = this.addMeshWithEdges(this.group, ewTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      wTrim.position.set(-halfW + trimT * 0.5, trimY, 0);

      // East edge (x = halfW)
      const eTrim = this.addMeshWithEdges(this.group, ewTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      eTrim.position.set(halfW - trimT * 0.5, trimY, 0);

      // Add grapple points at the 4 corners of each slab
      this.grapplePoints.push(
        new THREE.Vector3(-halfW, slabY + 0.3, -halfD),
        new THREE.Vector3(halfW, slabY + 0.3, -halfD),
        new THREE.Vector3(-halfW, slabY + 0.3, halfD),
        new THREE.Vector3(halfW, slabY + 0.3, halfD)
      );

      // Add columns supporting the slab above (floors 0 to 3)
      if (floor < numFloors - 1) {
        const colHeight = floorHeight - slabThickness;
        const colGeom = new THREE.BoxGeometry(0.9, colHeight, 0.9);
        const colY = slabY + slabThickness * 0.5 + colHeight * 0.5;

        // 4x3 column grid
        const xPositions = [-10.5, -3.5, 3.5, 10.5];
        const zPositions = [-8.5, 0, 8.5];

        for (const cx of xPositions) {
          for (const cz of zPositions) {
            // Omit column at the stairwell opening
            if (cx > 5.0 && cz >= -4.0 && cz <= 6.0) {
              continue;
            }

            const col = this.addMeshWithEdges(this.group, colGeom, this.concreteMat);
            col.position.set(cx, colY, cz);
          }
        }
      }
    }

    // Rebar cages protruding from roof columns
    const roofY = (numFloors - 1) * floorHeight + slabThickness;
    const rebarGeom = new THREE.CylinderGeometry(0.025, 0.025, 1.8, 6);
    const xPositions = [-10.5, -3.5, 3.5, 10.5];
    const zPositions = [-8.5, 0, 8.5];

    for (const cx of xPositions) {
      for (const cz of zPositions) {
        if (cx > 5.0 && cz >= -4.0 && cz <= 6.0) continue;

        // 4 rebar rods per column
        const offsets = [-0.25, 0.25];
        for (const ox of offsets) {
          for (const oz of offsets) {
            const rebar = this.addMeshWithEdges(
              this.group,
              rebarGeom,
              this.craneMat,
              InkShaderMaterial.craneColor,
              false
            );
            rebar.position.set(cx + ox, roofY + 0.9, cz + oz);
          }
        }
      }
    }
  }

  /**
   * Builds diagonal staircases connecting the open floor slabs
   */
  private buildStaircases(): void {
    const floorHeight = 5.0;
    const numFlights = 4; // L0->L1, L1->L2, L2->L3, L3->Roof

    for (let flight = 0; flight < numFlights; flight++) {
      const bottomY = flight * floorHeight + 0.5;
      const topY = bottomY + floorHeight;
      const isEven = flight % 2 === 0;

      // Stair flight group
      const stairGroup = new THREE.Group();
      stairGroup.name = `StairFlight_${flight}`;

      const stairWidth = 2.4;
      const lengthZ = 9.0;
      const slopeAngle = Math.atan2(floorHeight, lengthZ);
      const hypotenuse = Math.sqrt(lengthZ * lengthZ + floorHeight * floorHeight);

      // Ramp base (walkable inclined slab for smooth collision)
      const rampGeom = new THREE.BoxGeometry(stairWidth, 0.25, hypotenuse);
      const ramp = this.addMeshWithEdges(stairGroup, rampGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
      ramp.rotation.x = isEven ? -slopeAngle : slopeAngle;

      const midZ = isEven ? 1.0 : 1.0;
      const posX = isEven ? 9.5 : 7.0;
      stairGroup.position.set(posX, bottomY + floorHeight * 0.5, midZ);

      // Stepped treads along the incline
      const numSteps = 12;
      const stepRise = floorHeight / numSteps;
      const stepRun = lengthZ / numSteps;
      const stepGeom = new THREE.BoxGeometry(stairWidth * 0.95, stepRise, stepRun);

      for (let s = 0; s < numSteps; s++) {
        const step = this.addMeshWithEdges(stairGroup, stepGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, false);
        const zStep = isEven ? -lengthZ * 0.5 + s * stepRun + stepRun * 0.5 : lengthZ * 0.5 - s * stepRun - stepRun * 0.5;
        const yStep = -floorHeight * 0.5 + s * stepRise + stepRise * 0.5;
        step.position.set(0, yStep, zStep);
      }

      // Solid balustrade / guardrail wall along the outer side
      const balustradeHeight = 1.1;
      const balustradeGeom = new THREE.BoxGeometry(0.18, balustradeHeight, hypotenuse);
      const balustrade = this.addMeshWithEdges(stairGroup, balustradeGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
      balustrade.rotation.x = isEven ? -slopeAngle : slopeAngle;
      balustrade.position.set(stairWidth * 0.5 + 0.09, balustradeHeight * 0.5, 0);

      // Inner handrail tube
      const innerRailGeom = new THREE.CylinderGeometry(0.04, 0.04, hypotenuse, 6);
      const innerRail = this.addMeshWithEdges(stairGroup, innerRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      innerRail.rotation.x = isEven ? -slopeAngle + Math.PI * 0.5 : slopeAngle + Math.PI * 0.5;
      innerRail.position.set(-stairWidth * 0.5 - 0.05, balustradeHeight * 0.8, 0);

      this.group.add(stairGroup);

      // Intermediate landing platform
      const landingGeom = new THREE.BoxGeometry(4.0, 0.4, 3.0);
      const landing = this.addMeshWithEdges(this.group, landingGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
      landing.position.set(8.5, topY, isEven ? 5.5 : -3.5);

      // Landing safety railing
      const railBarGeom = new THREE.BoxGeometry(4.0, 0.08, 0.08);
      const railBar = this.addMeshWithEdges(this.group, railBarGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      railBar.position.set(8.5, topY + 1.1, isEven ? 7.0 : -5.0);

      // Grapple points at each landing
      this.grapplePoints.push(new THREE.Vector3(8.5, topY + 1.2, isEven ? 5.5 : -3.5));
    }
  }

  /**
   * Builds the skybridge / catwalk connecting Level 3 to the adjacent building
   */
  private buildSkyBridge(): void {
    const bridgeY = 15.0; // Level 3 slab height
    const bridgeStartX = -13.0; // West side of construction building
    const bridgeEndX = -41.0; // Meets the dock building face (notched stair hall)
    const bridgeLength = Math.abs(bridgeStartX - bridgeEndX);
    const bridgeWidth = 3.2;
    const bridgeThickness = 0.4;
    const midX = (bridgeStartX + bridgeEndX) * 0.5;

    // Bridge deck slab
    const deckGeom = new THREE.BoxGeometry(bridgeLength, bridgeThickness, bridgeWidth);
    const deck = this.addMeshWithEdges(this.group, deckGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
    deck.position.set(midX, bridgeY + bridgeThickness * 0.5, 0);

    // Twin heavy longitudinal steel I-beams underneath
    const beamLength = bridgeLength;
    const beamHeight = 0.6;
    const beamFlangeW = 0.35;
    const beamWebT = 0.08;

    const zOffsets = [-1.2, 1.2];
    for (const bz of zOffsets) {
      // Top flange
      const topFGeom = new THREE.BoxGeometry(beamLength, 0.06, beamFlangeW);
      const topF = this.addMeshWithEdges(this.group, topFGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      topF.position.set(midX, bridgeY - 0.03, bz);

      // Web
      const webGeom = new THREE.BoxGeometry(beamLength, beamHeight, beamWebT);
      const web = this.addMeshWithEdges(this.group, webGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      web.position.set(midX, bridgeY - beamHeight * 0.5, bz);

      // Bottom flange
      const botFGeom = new THREE.BoxGeometry(beamLength, 0.06, beamFlangeW);
      const botF = this.addMeshWithEdges(this.group, botFGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      botF.position.set(midX, bridgeY - beamHeight, bz);
    }

    // Side safety railings (North & South)
    const railZOffsets = [-bridgeWidth * 0.5 + 0.06, bridgeWidth * 0.5 - 0.06];
    const numPosts = 10;
    const postSpacing = bridgeLength / (numPosts - 1);

    for (const rz of railZOffsets) {
      // Top handrail bar
      const handrailGeom = new THREE.BoxGeometry(bridgeLength, 0.08, 0.08);
      const handrail = this.addMeshWithEdges(this.group, handrailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
      handrail.position.set(midX, bridgeY + 1.15, rz);

      // Mid rail bar
      const midRailGeom = new THREE.BoxGeometry(bridgeLength, 0.05, 0.05);
      const midRail = this.addMeshWithEdges(this.group, midRailGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      midRail.position.set(midX, bridgeY + 0.6, rz);

      // Bottom kickplate / toe-board
      const kickGeom = new THREE.BoxGeometry(bridgeLength, 0.2, 0.03);
      const kick = this.addMeshWithEdges(this.group, kickGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      kick.position.set(midX, bridgeY + 0.15, rz);

      // Vertical stanchion posts
      const postGeom = new THREE.BoxGeometry(0.08, 1.15, 0.08);
      for (let p = 0; p < numPosts; p++) {
        const px = bridgeStartX - p * postSpacing;
        const post = this.addMeshWithEdges(this.group, postGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
        post.position.set(px, bridgeY + 0.6, rz);
      }
    }

    // Diagonal support struts from lower building column up to the bridge bottom
    const strutGeom = new THREE.CylinderGeometry(0.12, 0.12, 6.5, 6);
    const strut1 = this.addMeshWithEdges(this.group, strutGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    strut1.position.set(-15.5, bridgeY - 2.5, -1.2);
    strut1.rotation.z = 0.7;

    const strut2 = this.addMeshWithEdges(this.group, strutGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    strut2.position.set(-15.5, bridgeY - 2.5, 1.2);
    strut2.rotation.z = 0.7;

    // Grapple points along the skybridge
    this.grapplePoints.push(
      new THREE.Vector3(midX, bridgeY + 1.2, 0),
      new THREE.Vector3(bridgeStartX, bridgeY + 1.2, 0),
      new THREE.Vector3(bridgeEndX, bridgeY + 1.2, 0)
    );
  }

  /**
   * Builds scaffolding towers along the north facade
   */
  private buildScaffolding(): void {
    const scafGroup = new THREE.Group();
    scafGroup.name = 'Scaffolding';

    const baseZ = -11.5;
    const numBays = 4;
    const bayWidth = 4.0;
    const scafDepth = 1.8;
    const numTiers = 3;
    const tierHeight = 5.0;

    const startX = -8.0;

    // Vertical pipe standards
    const standardGeom = new THREE.CylinderGeometry(0.04, 0.04, tierHeight * numTiers, 6);
    for (let b = 0; b <= numBays; b++) {
      const bx = startX + b * bayWidth;
      // Outer post
      const pOuter = this.addMeshWithEdges(scafGroup, standardGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      pOuter.position.set(bx, (tierHeight * numTiers) * 0.5, baseZ - scafDepth);

      // Inner post
      const pInner = this.addMeshWithEdges(scafGroup, standardGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      pInner.position.set(bx, (tierHeight * numTiers) * 0.5, baseZ);
    }

    // Horizontal ledgers & walk planks
    const ledgerGeomX = new THREE.CylinderGeometry(0.035, 0.035, numBays * bayWidth, 6);
    const ledgerGeomZ = new THREE.CylinderGeometry(0.035, 0.035, scafDepth, 6);

    for (let t = 1; t <= numTiers; t++) {
      const ty = t * tierHeight;

      // Outer longitudinal ledger
      const lOuter = this.addMeshWithEdges(scafGroup, ledgerGeomX, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      lOuter.rotation.z = Math.PI * 0.5;
      lOuter.position.set(startX + (numBays * bayWidth) * 0.5, ty, baseZ - scafDepth);

      // Inner longitudinal ledger
      const lInner = this.addMeshWithEdges(scafGroup, ledgerGeomX, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      lInner.rotation.z = Math.PI * 0.5;
      lInner.position.set(startX + (numBays * bayWidth) * 0.5, ty, baseZ);

      // Cross transoms
      for (let b = 0; b <= numBays; b++) {
        const bx = startX + b * bayWidth;
        const transom = this.addMeshWithEdges(scafGroup, ledgerGeomZ, this.metalMat, InkShaderMaterial.defaultInkColor, false);
        transom.rotation.x = Math.PI * 0.5;
        transom.position.set(bx, ty, baseZ - scafDepth * 0.5);
      }

      // Wooden walk planks on each tier
      const plankGeom = new THREE.BoxGeometry(bayWidth * 0.96, 0.08, scafDepth * 0.85);
      for (let b = 0; b < numBays; b++) {
        const bx = startX + b * bayWidth + bayWidth * 0.5;
        const plank = this.addMeshWithEdges(scafGroup, plankGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
        plank.position.set(bx, ty + 0.04, baseZ - scafDepth * 0.5);
      }

      // Guardrail along outer edge
      const guardGeom = new THREE.BoxGeometry(numBays * bayWidth, 0.05, 0.05);
      const guard = this.addMeshWithEdges(scafGroup, guardGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
      guard.position.set(startX + (numBays * bayWidth) * 0.5, ty + 1.0, baseZ - scafDepth);
    }

    // Diagonal X-bracing on outer face
    const braceLength = Math.sqrt(bayWidth * bayWidth + tierHeight * tierHeight);
    const braceGeom = new THREE.CylinderGeometry(0.025, 0.025, braceLength, 6);
    const braceAngle = Math.atan2(tierHeight, bayWidth);

    for (let t = 0; t < numTiers; t++) {
      const ty = t * tierHeight + tierHeight * 0.5;
      for (let b = 0; b < numBays; b++) {
        const bx = startX + b * bayWidth + bayWidth * 0.5;

        // Diagonal 1
        const b1 = this.addMeshWithEdges(scafGroup, braceGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
        b1.rotation.z = braceAngle;
        b1.position.set(bx, ty, baseZ - scafDepth);

        // Diagonal 2
        const b2 = this.addMeshWithEdges(scafGroup, braceGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
        b2.rotation.z = -braceAngle;
        b2.position.set(bx, ty, baseZ - scafDepth);
      }
    }

    this.group.add(scafGroup);

    // Grapple points on scaffolding top platform
    this.grapplePoints.push(
      new THREE.Vector3(startX, tierHeight * numTiers + 1.0, baseZ - scafDepth * 0.5),
      new THREE.Vector3(startX + numBays * bayWidth, tierHeight * numTiers + 1.0, baseZ - scafDepth * 0.5)
    );
  }

  /**
   * Builds the massive construction crane on the roof with swinging orange hook & girder
   */
  private buildRoofCrane(): void {
    const craneGroup = new THREE.Group();
    craneGroup.name = 'ConstructionCrane';

    const roofY = 20.5;
    const craneBaseX = 2.0;
    const craneBaseZ = -2.0;
    const mastHeight = 24.0;
    const mastWidth = 2.4;
    const topY = roofY + mastHeight;

    // 1. Cruciform outrigger steel base
    const outriggerGeom = new THREE.BoxGeometry(6.0, 0.6, 6.0);
    const base = this.addMeshWithEdges(craneGroup, outriggerGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    base.position.set(craneBaseX, roofY + 0.3, craneBaseZ);

    // 4 concrete corner ballast weights
    const ballastGeom = new THREE.BoxGeometry(1.6, 1.0, 1.6);
    const ballastOffsets = [-2.2, 2.2];
    for (const ox of ballastOffsets) {
      for (const oz of ballastOffsets) {
        const b = this.addMeshWithEdges(craneGroup, ballastGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
        b.position.set(craneBaseX + ox, roofY + 0.8, craneBaseZ + oz);
      }
    }

    // 2. Vertical lattice mast (4 corner chords + lattice struts)
    const chordGeom = new THREE.BoxGeometry(0.22, mastHeight, 0.22);
    const halfMW = mastWidth * 0.5;
    const chordOffsets = [-halfMW, halfMW];

    for (const ox of chordOffsets) {
      for (const oz of chordOffsets) {
        const chord = this.addMeshWithEdges(craneGroup, chordGeom, this.craneMat, InkShaderMaterial.craneColor, true);
        chord.position.set(craneBaseX + ox, roofY + mastHeight * 0.5, craneBaseZ + oz);
      }
    }

    // Mast horizontal and diagonal lattice struts
    const numTiers = 8;
    const tierH = mastHeight / numTiers;
    const horizStrutGeom = new THREE.BoxGeometry(mastWidth, 0.08, 0.08);
    const diagStrutLength = Math.sqrt(mastWidth * mastWidth + tierH * tierH);
    const diagStrutGeom = new THREE.BoxGeometry(diagStrutLength, 0.06, 0.06);
    const diagAngle = Math.atan2(tierH, mastWidth);

    for (let t = 0; t <= numTiers; t++) {
      const ty = roofY + t * tierH;

      // Horizontal struts along X faces
      for (const oz of chordOffsets) {
        const hsX = this.addMeshWithEdges(craneGroup, horizStrutGeom, this.craneMat, InkShaderMaterial.craneColor, false);
        hsX.position.set(craneBaseX, ty, craneBaseZ + oz);
      }

      // Horizontal struts along Z faces
      for (const ox of chordOffsets) {
        const hsZ = this.addMeshWithEdges(craneGroup, horizStrutGeom, this.craneMat, InkShaderMaterial.craneColor, false);
        hsZ.rotation.y = Math.PI * 0.5;
        hsZ.position.set(craneBaseX + ox, ty, craneBaseZ);
      }

      // Diagonal struts
      if (t < numTiers) {
        const midTierY = roofY + t * tierH + tierH * 0.5;
        // North face diag
        const d1 = this.addMeshWithEdges(craneGroup, diagStrutGeom, this.craneMat, InkShaderMaterial.craneColor, false);
        d1.rotation.z = diagAngle;
        d1.position.set(craneBaseX, midTierY, craneBaseZ - halfMW);

        // South face diag
        const d2 = this.addMeshWithEdges(craneGroup, diagStrutGeom, this.craneMat, InkShaderMaterial.craneColor, false);
        d2.rotation.z = -diagAngle;
        d2.position.set(craneBaseX, midTierY, craneBaseZ + halfMW);
      }
    }

    // 3. Slewing unit / turntable at the top of the mast
    const slewingGeom = new THREE.CylinderGeometry(1.8, 1.8, 0.7, 12);
    const slewing = this.addMeshWithEdges(craneGroup, slewingGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    slewing.position.set(craneBaseX, topY + 0.35, craneBaseZ);

    // Operator cabin
    const cabGeom = new THREE.BoxGeometry(2.0, 2.4, 2.2);
    const cab = this.addMeshWithEdges(craneGroup, cabGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    cab.position.set(craneBaseX + 2.2, topY + 1.2, craneBaseZ);

    // Cab glass front window frame
    const winGeom = new THREE.BoxGeometry(0.1, 1.4, 1.8);
    const win = this.addMeshWithEdges(craneGroup, winGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    win.position.set(craneBaseX + 3.2, topY + 1.3, craneBaseZ);

    // 4. Tower Peak / Apex (Cathead A-frame)
    const apexHeight = 7.5;
    const apexTopY = topY + apexHeight;
    const apexGeom = new THREE.ConeGeometry(1.6, apexHeight, 4);
    const apex = this.addMeshWithEdges(craneGroup, apexGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    apex.position.set(craneBaseX, topY + apexHeight * 0.5, craneBaseZ);
    apex.rotation.y = Math.PI * 0.25;

    // 5. Horizontal Jib (Working boom)
    const jibLength = 32.0;
    const jibTipX = craneBaseX + jibLength;
    const jibY = topY + 0.8;
    const jibChordGeom = new THREE.BoxGeometry(jibLength, 0.14, 0.14);

    // Top chord
    const topChord = this.addMeshWithEdges(craneGroup, jibChordGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    topChord.position.set(craneBaseX + jibLength * 0.5, jibY + 1.2, craneBaseZ);

    // Bottom left & right chords
    const botChordL = this.addMeshWithEdges(craneGroup, jibChordGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    botChordL.position.set(craneBaseX + jibLength * 0.5, jibY, craneBaseZ - 0.7);

    const botChordR = this.addMeshWithEdges(craneGroup, jibChordGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    botChordR.position.set(craneBaseX + jibLength * 0.5, jibY, craneBaseZ + 0.7);

    // Jib walkway (Spider-Man can run on this!)
    const walkwayGeom = new THREE.BoxGeometry(jibLength, 0.08, 1.1);
    const walkway = this.addMeshWithEdges(craneGroup, walkwayGeom, this.metalMat, InkShaderMaterial.defaultInkColor, true);
    walkway.position.set(craneBaseX + jibLength * 0.5, jibY + 0.04, craneBaseZ);

    // Jib webbing diagonal lacing
    const numJibBays = 16;
    const jibBayW = jibLength / numJibBays;
    const jibWebGeom = new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6);

    for (let j = 0; j < numJibBays; j++) {
      const jx = craneBaseX + j * jibBayW + jibBayW * 0.5;
      const wL = this.addMeshWithEdges(craneGroup, jibWebGeom, this.craneMat, InkShaderMaterial.craneColor, false);
      wL.position.set(jx, jibY + 0.6, craneBaseZ - 0.35);
      wL.rotation.x = 0.5;

      const wR = this.addMeshWithEdges(craneGroup, jibWebGeom, this.craneMat, InkShaderMaterial.craneColor, false);
      wR.position.set(jx, jibY + 0.6, craneBaseZ + 0.35);
      wR.rotation.x = -0.5;
    }

    // Tension tie cables from Cathead apex to jib
    const midJibX = craneBaseX + 16.0;
    const tieDist1 = Math.hypot(midJibX - craneBaseX, jibY - apexTopY);
    const cable1Geom = new THREE.CylinderGeometry(0.03, 0.03, tieDist1, 6);
    const cable1 = this.addMeshWithEdges(craneGroup, cable1Geom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    cable1.position.set((craneBaseX + midJibX) * 0.5, (apexTopY + jibY) * 0.5, craneBaseZ);
    cable1.rotation.z = Math.atan2(midJibX - craneBaseX, apexTopY - jibY);

    const tieDist2 = Math.hypot(jibTipX - craneBaseX, jibY - apexTopY);
    const cable2Geom = new THREE.CylinderGeometry(0.03, 0.03, tieDist2, 6);
    const cable2 = this.addMeshWithEdges(craneGroup, cable2Geom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    cable2.position.set((craneBaseX + jibTipX) * 0.5, (apexTopY + jibY) * 0.5, craneBaseZ);
    cable2.rotation.z = Math.atan2(jibTipX - craneBaseX, apexTopY - jibY);

    // 6. Counter-Jib & Ballast
    const counterLength = 13.0;
    const counterChordGeom = new THREE.BoxGeometry(counterLength, 0.14, 0.14);
    const counterChord = this.addMeshWithEdges(craneGroup, counterChordGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    counterChord.position.set(craneBaseX - counterLength * 0.5, jibY, craneBaseZ);

    // Heavy concrete ballast slabs
    const ballastBlockGeom = new THREE.BoxGeometry(3.5, 2.2, 2.4);
    const ballastBlock = this.addMeshWithEdges(craneGroup, ballastBlockGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
    ballastBlock.position.set(craneBaseX - counterLength + 2.0, jibY + 0.8, craneBaseZ);

    // Rear stay cable from apex to counterweight
    const rearX = craneBaseX - counterLength + 1.0;
    const rearDist = Math.hypot(craneBaseX - rearX, apexTopY - jibY);
    const rearCableGeom = new THREE.CylinderGeometry(0.04, 0.04, rearDist, 6);
    const rearCable = this.addMeshWithEdges(craneGroup, rearCableGeom, this.metalMat, InkShaderMaterial.defaultInkColor, false);
    rearCable.position.set((craneBaseX + rearX) * 0.5, (apexTopY + jibY) * 0.5, craneBaseZ);
    rearCable.rotation.z = -Math.atan2(craneBaseX - rearX, apexTopY - jibY);

    // 7. Trolley on Jib
    const trolleyX = craneBaseX + 17.0;
    const trolleyY = jibY - 0.2;
    const trolleyGeom = new THREE.BoxGeometry(1.6, 0.4, 1.2);
    const trolley = this.addMeshWithEdges(craneGroup, trolleyGeom, this.craneMat, InkShaderMaterial.craneColor, true);
    trolley.position.set(trolleyX, trolleyY, craneBaseZ);

    // 8. Hanging Orange Hook and Girder Group (prime web-swinging grapple point!)
    this.craneHookGroup = new THREE.Group();
    this.craneHookGroup.name = 'SwingingHookAndGirder';
    this.craneHookGroup.position.set(trolleyX, trolleyY, craneBaseZ);

    const hoistCableLength = 17.0;
    const hoistCableGeom = new THREE.CylinderGeometry(0.03, 0.03, hoistCableLength, 6);
    const hoistCable1 = this.addMeshWithEdges(
      this.craneHookGroup,
      hoistCableGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      false
    );
    hoistCable1.position.set(-0.2, -hoistCableLength * 0.5, 0);

    const hoistCable2 = this.addMeshWithEdges(
      this.craneHookGroup,
      hoistCableGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      false
    );
    hoistCable2.position.set(0.2, -hoistCableLength * 0.5, 0);

    // Pulley Hook Block (Orange Ink)
    const hookBlockY = -hoistCableLength;
    const hookBlockGeom = new THREE.BoxGeometry(0.8, 1.2, 0.6);
    const hookBlock = this.addMeshWithEdges(
      this.craneHookGroup,
      hookBlockYGeom(hookBlockGeom),
      this.craneMat,
      InkShaderMaterial.craneColor,
      true
    );
    hookBlock.position.set(0, hookBlockY, 0);

    // Hook loop
    const hookTorusGeom = new THREE.TorusGeometry(0.35, 0.09, 8, 16, Math.PI * 1.5);
    const hookLoop = this.addMeshWithEdges(
      this.craneHookGroup,
      hookTorusGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      true
    );
    hookLoop.position.set(0, hookBlockY - 0.8, 0);
    hookLoop.rotation.z = Math.PI * 0.25;

    // Massive Suspended Steel I-Beam / Girder (Length 9m, orange ink!)
    const girderLength = 9.0;
    const girderHeight = 0.7;
    const girderFlangeW = 0.5;
    const girderY = hookBlockY - 2.8;
    const girderTopY = girderY + girderHeight * 0.5;

    // Steel bridle sling cables connecting hook to girder (A-frame bridle hitch)
    const hookApexY = hookBlockY - 1.15;
    const spreadX = 2.0;
    const slingDy = hookApexY - girderTopY;
    const slingDist = Math.hypot(spreadX, slingDy);
    const slingGeom = new THREE.CylinderGeometry(0.025, 0.025, slingDist, 6);
    const slingAngle = Math.atan2(spreadX, slingDy);
    const slingMidY = (hookApexY + girderTopY) * 0.5;

    const slingL = this.addMeshWithEdges(
      this.craneHookGroup,
      slingGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      false
    );
    slingL.position.set(-spreadX * 0.5, slingMidY, 0);
    slingL.rotation.z = -slingAngle;

    const slingR = this.addMeshWithEdges(
      this.craneHookGroup,
      slingGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      false
    );
    slingR.position.set(spreadX * 0.5, slingMidY, 0);
    slingR.rotation.z = slingAngle;

    // Girder Top Flange
    const gTopGeom = new THREE.BoxGeometry(girderLength, 0.08, girderFlangeW);
    const gTop = this.addMeshWithEdges(
      this.craneHookGroup,
      gTopGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      true
    );
    gTop.position.set(0, girderY + girderHeight * 0.5, 0);

    // Girder Central Web
    const gWebGeom = new THREE.BoxGeometry(girderLength, girderHeight, 0.08);
    const gWeb = this.addMeshWithEdges(
      this.craneHookGroup,
      gWebGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      true
    );
    gWeb.position.set(0, girderY, 0);

    // Girder Bottom Flange
    const gBotGeom = new THREE.BoxGeometry(girderLength, 0.08, girderFlangeW);
    const gBot = this.addMeshWithEdges(
      this.craneHookGroup,
      gBotGeom,
      this.craneMat,
      InkShaderMaterial.craneColor,
      true
    );
    gBot.position.set(0, girderY - girderHeight * 0.5, 0);

    // Non-landable warning marker: red/white striped hanging marker under the hook indicates
    // moving/swaying hook (no standing, no floor shell, no latching within 3m)
    const markerGroup = new THREE.Group();
    markerGroup.name = 'CraneHookNonLandableMarker';
    markerGroup.position.set(0, hookBlockY - 1.25, 0);

    const numStripes = 4;
    const stripeH = 0.22;
    const markerRadius = 0.16;
    for (let i = 0; i < numStripes; i++) {
      const sGeom = new THREE.CylinderGeometry(markerRadius, markerRadius, stripeH, 10);
      const isRed = i % 2 === 0;
      const sMat = isRed ? this.accentMat : this.concreteMat;
      const sMesh = this.addMeshWithEdges(
        markerGroup,
        sGeom,
        sMat,
        isRed ? InkShaderMaterial.defaultAccentColor : InkShaderMaterial.defaultInkColor,
        false
      );
      sMesh.position.set(0, -i * stripeH, 0);
    }
    this.craneHookGroup.add(markerGroup);

    craneGroup.add(this.craneHookGroup);
    this.group.add(craneGroup);

    // High-value grapple points on the crane (apex, jib tip, trolley, counterweight)
    // Note: Suspended hook and girder are moving/non-landable, so no grapple points within 3m
    this.grapplePoints.push(
      new THREE.Vector3(craneBaseX, apexTopY, craneBaseZ), // Cathead apex
      new THREE.Vector3(jibTipX, jibY, craneBaseZ), // Jib tip
      new THREE.Vector3(trolleyX, trolleyY, craneBaseZ), // Trolley
      new THREE.Vector3(craneBaseX - counterLength, jibY + 1.2, craneBaseZ) // Counterweight
    );
  }

  /**
   * Builds realistic construction props (Jersey barriers, brick pallets, wooden crates, perimeter guardrails)
   */
  private buildProps(): void {
    const propsGroup = new THREE.Group();
    propsGroup.name = 'ConstructionProps';

    // 1. Concrete Jersey Barriers
    const barrierPositions: Array<[number, number, number, number]> = [
      // Ground level perimeter (x, y, z, rotationY)
      [-12.0, 0.6, 12.0, 0],
      [-8.5, 0.6, 12.0, 0],
      [-5.0, 0.6, 12.0, 0],
      [0.0, 0.6, 12.0, 0],
      [4.0, 0.6, 12.0, 0.2],
      [12.0, 0.6, 10.0, Math.PI * 0.5],
      [12.0, 0.6, 6.0, Math.PI * 0.5],
      [-12.0, 0.6, -12.0, 0],
      [-7.0, 0.6, -12.0, 0],
      // Additional street barriers for wave 1 cover near site
      [-6.0, 0.6, -15.0, 0],
      [0.0, 0.6, -15.0, 0],
      [6.0, 0.6, -15.0, 0.1],
      [-5.0, 0.6, 15.0, 0],
      [2.0, 0.6, 15.0, -0.1],
      [8.0, 0.6, 15.0, 0],
      [15.0, 0.6, -3.0, Math.PI * 0.5],
      [15.0, 0.6, 3.0, Math.PI * 0.5],
      // Upper floors
      [-5.0, 5.6, 6.0, 0.4],
      [2.0, 10.6, -4.0, -0.3],
      [-3.0, 15.6, 4.0, 0.6],
      [4.0, 20.6, -6.0, 0]
    ];

    const barrierGeom = createJerseyBarrierGeometry();
    for (const [bx, by, bz, brot] of barrierPositions) {
      const barrier = this.addMeshWithEdges(propsGroup, barrierGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
      barrier.position.set(bx, by, bz);
      barrier.rotation.y = brot;
    }

    // 2. Wooden Pallets with Bricks
    const palletPositions: Array<[number, number, number, number]> = [
      [-6.0, 0.5, 2.0, 0.1],
      [-4.0, 0.5, 2.2, -0.15],
      [3.0, 5.5, -2.0, 0.3],
      [-8.0, 10.5, 2.0, -0.5],
      [2.0, 15.5, 5.0, 0.2],
      [-6.0, 20.5, -5.0, 0.4],
      [-8.0, 20.5, 4.0, -0.2]
    ];

    const palletGeom = new THREE.BoxGeometry(1.4, 0.15, 1.4);
    const brickStackGeom = new THREE.BoxGeometry(1.2, 0.9, 1.2);

    for (const [px, py, pz, prot] of palletPositions) {
      const palletGroup = new THREE.Group();
      palletGroup.position.set(px, py, pz);
      palletGroup.rotation.y = prot;

      const pallet = this.addMeshWithEdges(palletGroup, palletGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
      pallet.position.set(0, 0.075, 0);

      const bricks = this.addMeshWithEdges(palletGroup, brickStackGeom, this.concreteMat, InkShaderMaterial.defaultInkColor, true);
      bricks.position.set(0, 0.6, 0);

      // Pallet plastic wrapping band
      const bandGeom = new THREE.BoxGeometry(1.22, 0.06, 1.22);
      const band = this.addMeshWithEdges(palletGroup, bandGeom, this.accentMat, InkShaderMaterial.defaultAccentColor, false);
      band.position.set(0, 0.6, 0);

      propsGroup.add(palletGroup);
    }

    // 3. Heavy Wooden Crates
    const cratePositions: Array<[number, number, number, number, number]> = [
      // [x, y, z, size, rotY]
      [-8.0, 0.5, -5.0, 1.6, 0.2],
      [-6.2, 0.5, -5.3, 1.2, -0.3],
      [-7.1, 2.1, -5.1, 1.1, 0.1],
      [6.0, 5.5, -6.0, 1.4, 0.5],
      [-9.0, 15.5, -2.0, 1.5, -0.2],
      [7.0, 20.5, 6.0, 1.3, 0.3],
      // Street cover near site
      [-4.0, 0.5, -16.5, 1.4, 0.2],
      [5.0, 0.5, -16.0, 1.5, -0.2],
      [3.0, 0.5, 16.5, 1.3, 0.4],
      [15.5, 0.5, 0.0, 1.4, 0.1]
    ];

    for (const [cx, cy, cz, csize, crot] of cratePositions) {
      const crateGeom = new THREE.BoxGeometry(csize, csize, csize);
      const crate = this.addMeshWithEdges(propsGroup, crateGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
      crate.position.set(cx, cy + csize * 0.5, cz);
      crate.rotation.y = crot;
    }

    // 4. Perimeter Safety Guardrails along floor edges
    const railingFloors = [1, 2, 3, 4];
    const railHeight = 1.1;

    for (const floor of railingFloors) {
      const fy = floor * 5.0 + 0.5;

      // South edge railings (z = -11.0, along x from -12 to 5)
      const southRailGeom = new THREE.BoxGeometry(17.0, 0.08, 0.08);
      const southRail = this.addMeshWithEdges(propsGroup, southRailGeom, this.craneMat, InkShaderMaterial.craneColor, false);
      southRail.position.set(-3.5, fy + railHeight, -10.9);

      // Vertical posts along south edge
      const postGeom = new THREE.BoxGeometry(0.08, railHeight, 0.08);
      for (let x = -12.0; x <= 5.0; x += 3.4) {
        const post = this.addMeshWithEdges(propsGroup, postGeom, this.craneMat, InkShaderMaterial.craneColor, false);
        post.position.set(x, fy + railHeight * 0.5, -10.9);
      }

      // West edge railings (x = -13.0, along z from -10 to 10)
      if (floor !== 3) {
        const westRailGeom = new THREE.BoxGeometry(0.08, 0.08, 20.0);
        const westRail = this.addMeshWithEdges(propsGroup, westRailGeom, this.craneMat, InkShaderMaterial.craneColor, false);
        westRail.position.set(-12.9, fy + railHeight, 0);

        for (let z = -10.0; z <= 10.0; z += 3.3) {
          const post = this.addMeshWithEdges(propsGroup, postGeom, this.craneMat, InkShaderMaterial.craneColor, false);
          post.position.set(-12.9, fy + railHeight * 0.5, z);
        }
      } else {
        // Floor 3 connects to skybridge at z in [-1.6, 1.6].
        // Add railings on both sides of the bridge opening to prevent accidental walk-offs!
        // North section: z from 1.6 to 10.0 (length 8.4m, center z = 5.8)
        const northRailGeom = new THREE.BoxGeometry(0.08, 0.08, 8.4);
        const northRail = this.addMeshWithEdges(propsGroup, northRailGeom, this.craneMat, InkShaderMaterial.craneColor, true);
        northRail.position.set(-12.9, fy + railHeight, 5.8);

        for (let z = 1.6; z <= 10.0; z += 2.8) {
          const post = this.addMeshWithEdges(propsGroup, postGeom, this.craneMat, InkShaderMaterial.craneColor, false);
          post.position.set(-12.9, fy + railHeight * 0.5, z);
        }

        // South section: z from -10.0 to -1.6 (length 8.4m, center z = -5.8)
        const southRailGeom = new THREE.BoxGeometry(0.08, 0.08, 8.4);
        const southRail = this.addMeshWithEdges(propsGroup, southRailGeom, this.craneMat, InkShaderMaterial.craneColor, true);
        southRail.position.set(-12.9, fy + railHeight, -5.8);

        for (let z = -10.0; z <= -1.6; z += 2.8) {
          const post = this.addMeshWithEdges(propsGroup, postGeom, this.craneMat, InkShaderMaterial.craneColor, false);
          post.position.set(-12.9, fy + railHeight * 0.5, z);
        }
      }
    }

    this.group.add(propsGroup);
  }

  /**
   * Builds mid-air stepping stone platforms near spawn (0, 4, 18 area)
   * reachable by jump+boost, with landable trim strips.
   */
  private buildSteppingStones(): void {
    const steppingStonesGroup = new THREE.Group();
    steppingStonesGroup.name = 'SteppingStones';

    const stoneConfigs = [
      { x: 0.0, y: 2.5, z: 16.5, w: 2.4, d: 2.4 },
      { x: 2.8, y: 4.0, z: 14.2, w: 2.4, d: 2.4 },
      { x: -1.8, y: 5.2, z: 12.2, w: 2.4, d: 2.4 },
    ];

    const slabH = 0.3;
    const trimT = 0.10;
    const trimH = 0.06;

    for (let i = 0; i < stoneConfigs.length; i++) {
      const cfg = stoneConfigs[i];
      const pGroup = new THREE.Group();
      pGroup.name = `SteppingStone_${i + 1}`;
      pGroup.position.set(cfg.x, cfg.y, cfg.z);

      // Wooden pallet platform slab
      const slabGeom = new THREE.BoxGeometry(cfg.w, slabH, cfg.d);
      const slab = this.addMeshWithEdges(pGroup, slabGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
      slab.position.set(0, -slabH * 0.5, 0);

      // Crate on corner for tactical cover / step
      const crateSize = 0.8;
      const crateGeom = new THREE.BoxGeometry(crateSize, crateSize, crateSize);
      const crate = this.addMeshWithEdges(pGroup, crateGeom, this.woodMat, InkShaderMaterial.defaultInkColor, true);
      crate.position.set(cfg.w * 0.28, crateSize * 0.5, -cfg.d * 0.28);

      // Landable trim strips on all 4 outer edges
      const halfW = cfg.w * 0.5;
      const halfD = cfg.d * 0.5;

      // North & South trims
      const nsTrimGeom = new THREE.BoxGeometry(cfg.w, trimH, trimT);
      const nTrim = this.addMeshWithEdges(pGroup, nsTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      nTrim.position.set(0, trimH * 0.5, halfD - trimT * 0.5);

      const sTrim = this.addMeshWithEdges(pGroup, nsTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      sTrim.position.set(0, trimH * 0.5, -halfD + trimT * 0.5);

      // East & West trims
      const ewTrimGeom = new THREE.BoxGeometry(trimT, trimH, cfg.d - trimT * 2);
      const eTrim = this.addMeshWithEdges(pGroup, ewTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      eTrim.position.set(halfW - trimT * 0.5, trimH * 0.5, 0);

      const wTrim = this.addMeshWithEdges(pGroup, ewTrimGeom, this.landableTrimMat, LANDABLE_TRIM, false);
      wTrim.position.set(-halfW + trimT * 0.5, trimH * 0.5, 0);

      steppingStonesGroup.add(pGroup);

      // Register bounding box for WorldCollider floor shells
      this.steppingStoneBounds.push({
        minX: cfg.x - halfW,
        minY: cfg.y - slabH,
        minZ: cfg.z - halfD,
        maxX: cfg.x + halfW,
        maxY: cfg.y,
        maxZ: cfg.z + halfD,
      });
    }

    this.group.add(steppingStonesGroup);
  }

  /**
   * Returns bounding boxes of stepping stones for collision shells
   */
  public getSteppingStoneBounds(): Array<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }> {
    return this.steppingStoneBounds;
  }

  /**
   * Updates animations and ink shader line-boil time uniform
   */
  public update(dt: number): void {
    this.elapsed += dt;

    // Update uTime uniform on all ink materials for hand-drawn line-boil tremor
    for (const mat of this.materials) {
      if (mat.uniforms && mat.uniforms.uTime) {
        mat.uniforms.uTime.value = this.elapsed;
      }
    }

    // Subtle gentle pendulum sway on the suspended crane hook & girder
    if (this.craneHookGroup) {
      this.craneHookGroup.rotation.z = Math.sin(this.elapsed * 0.85) * 0.035;
      this.craneHookGroup.rotation.x = Math.cos(this.elapsed * 0.65) * 0.02;
    }
  }

  /**
   * Returns all solid collidable meshes (slabs, columns, stairs, bridge, girder, props)
   */
  public getCollidableMeshes(): THREE.Mesh[] {
    return this.collidableMeshes;
  }

  /**
   * Returns high-value web grapple points for Spider-Man web-swinging
   */
  public getGrapplePoints(): THREE.Vector3[] {
    return this.grapplePoints;
  }

  /**
   * Returns the root THREE.Group
   */
  public getGroup(): THREE.Group {
    return this.group;
  }
}

/**
 * Helper to pass geometry through without modification
 */
function hookBlockYGeom(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  return geom;
}

/**
 * Creates standard chamfered Jersey concrete barrier geometry
 */
function createJerseyBarrierGeometry(): THREE.BufferGeometry {
  // A clean standard trapezoid profile extruded along Z
  const shape = new THREE.Shape();
  const halfBottom = 0.35;
  const halfTop = 0.12;
  const height = 1.0;
  const breakHeight = 0.3;
  const halfBreak = 0.28;

  shape.moveTo(-halfBottom, 0);
  shape.lineTo(halfBottom, 0);
  shape.lineTo(halfBreak, breakHeight);
  shape.lineTo(halfTop, height);
  shape.lineTo(-halfTop, height);
  shape.lineTo(-halfBreak, breakHeight);
  shape.closePath();

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: 1,
    depth: 3.0,
    bevelEnabled: false
  };

  const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geom.center();
  return geom;
}
